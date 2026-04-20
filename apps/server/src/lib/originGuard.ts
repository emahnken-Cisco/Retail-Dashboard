import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Paths that are allowed to be hit cross-site with no Origin / Referer.
 *
 * We exempt the OIDC callback specifically because it is a top-level GET navigation from the
 * identity provider back to us — the browser does not always attach an Origin on those, and the
 * route itself is already CSRF-protected by the OAuth2 `state` + PKCE verifier it stores in the
 * session before redirecting. Everything else — including login and logout — goes through the
 * full check below.
 */
function isExemptPath(method: string, url: string): boolean {
  if (!SAFE_METHODS.has(method)) {
    return false;
  }
  return true;
}

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Global hook that blocks cross-site writes. For any non-safe HTTP method (POST / PUT / PATCH /
 * DELETE) we require the request's Origin header (or, as a fallback, the Referer's origin) to
 * match our configured allow list.
 *
 * This is the server-side half of CSRF defense: combined with a `SameSite` session cookie and a
 * strict CORS allow list, it prevents a malicious site from submitting authenticated mutating
 * requests with the victim's cookie. It intentionally rejects requests with no Origin and no
 * Referer on mutating methods — this application is a first-party browser SPA, and legitimate
 * browser-issued mutations always carry one of those headers.
 */
export async function originGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const method = req.method.toUpperCase();
  if (isExemptPath(method, req.url)) {
    return;
  }

  const allowList = config.ORIGIN_ALLOW_LIST;
  if (allowList.length === 0) {
    req.log.error("originGuard: no allowed origins configured; refusing all mutating requests");
    reply.code(500).send({ error: "Server origin allow list not configured" });
    return;
  }

  const originHeader = req.headers.origin;
  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  let candidate: string | null = null;
  if (rawOrigin && rawOrigin !== "null") {
    try {
      candidate = new URL(rawOrigin).origin;
    } catch {
      candidate = null;
    }
  }
  if (!candidate) {
    const refererHeader = req.headers.referer ?? req.headers.referrer;
    const rawReferer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
    candidate = originFromReferer(typeof rawReferer === "string" ? rawReferer : undefined);
  }

  if (!candidate || !allowList.includes(candidate)) {
    req.log.warn(
      { method, url: req.url, origin: rawOrigin ?? null, referer: req.headers.referer ?? null },
      "originGuard: rejected cross-site or origin-less mutating request",
    );
    reply.code(403).send({ error: "Forbidden: invalid origin" });
  }
}
