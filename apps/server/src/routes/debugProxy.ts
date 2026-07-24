import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDebugReader } from "../lib/rbac.js";
import { redactJson, redactText } from "../lib/secretRedaction.js";

/**
 * Server-side proxy for the API debug viewer. The browser used to fetch target `/api/*` endpoints
 * directly, which meant any secret in the response reached the browser (and the DevTools Network
 * tab) before any UI could mask it. Routing debug requests through here lets us re-issue the call
 * internally with the caller's own session (so RBAC is unchanged) and strip secrets from the body
 * BEFORE it is sent back — the raw key never leaves the server.
 */

const PROXY_PATH = "/api/debug/proxy";

const proxyBody = z.object({
  path: z.string().min(1).max(512),
  method: z.enum(["GET", "POST"]).default("GET"),
  // Raw JSON string forwarded verbatim to POST targets; validated by the target route's own schema.
  body: z.string().max(100_000).optional(),
});

/** Mirror of the client-side path allow-listing: only same-app `/api/` paths, no CRLF injection. */
function validateTargetPath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!withSlash.startsWith("/api/")) {
    return { ok: false, error: "Only paths under /api/ are allowed." };
  }
  if (/[\r\n]/.test(withSlash)) {
    return { ok: false, error: "Invalid path." };
  }
  // Prevent the proxy from calling itself (recursion / trace loops).
  const pathOnly = withSlash.split("?")[0];
  if (pathOnly === PROXY_PATH) {
    return { ok: false, error: "Cannot proxy the proxy endpoint." };
  }
  return { ok: true, path: withSlash };
}

export async function debugProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post(PROXY_PATH, { preHandler: requireDebugReader }, async (req, reply) => {
    const parsed = proxyBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid proxy request body" });
    }

    const check = validateTargetPath(parsed.data.path);
    if (!check.ok) {
      return reply.code(400).send({ error: check.error });
    }

    const method = parsed.data.method;

    // Forward the identity + CSRF context of the real caller to the internal request so that the
    // target route's session lookup and the global originGuard behave exactly as a direct call.
    const forwardedHeaders: Record<string, string> = {};
    const cookie = req.headers.cookie;
    if (typeof cookie === "string") {
      forwardedHeaders.cookie = cookie;
    }
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      forwardedHeaders.origin = origin;
    }
    const referer = req.headers.referer;
    if (typeof referer === "string") {
      forwardedHeaders.referer = referer;
    }
    if (method === "POST") {
      forwardedHeaders["content-type"] = "application/json";
    }

    const injected = await app.inject({
      method,
      url: check.path,
      headers: forwardedHeaders,
      ...(method === "POST" ? { payload: parsed.data.body ?? "{}" } : {}),
    });

    const status = injected.statusCode;
    const contentTypeHeader = injected.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0] ?? null
      : contentTypeHeader ?? null;

    const rawText = injected.body;
    let bodyJson: unknown | null = null;
    let bodyText = rawText;

    if (contentType?.includes("application/json")) {
      try {
        bodyJson = redactJson(JSON.parse(rawText) as unknown);
        // Keep bodyText consistent with the redacted JSON so neither surface leaks the key.
        bodyText = JSON.stringify(bodyJson, null, 2);
      } catch {
        // Not valid JSON despite the header — fall back to text scrubbing.
        bodyJson = null;
        bodyText = redactText(rawText);
      }
    } else {
      bodyText = redactText(rawText);
    }

    return reply.send({
      url: check.path,
      method,
      status,
      ok: status >= 200 && status < 300,
      contentType,
      bodyText,
      bodyJson,
    });
  });
}
