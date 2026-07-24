import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { setupRoutes } from "./routes/setup.js";
import { authRoutes } from "./routes/auth.js";
import { sessionHeartbeatRoutes } from "./routes/sessionHeartbeat.js";
import { sitesRoutes } from "./routes/sites.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { adminRoutes } from "./routes/admin.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { tagsRoutes } from "./routes/tags.js";
import { circuitsRoutes } from "./routes/circuits.js";
import { debugOutboundRoutes } from "./routes/debugOutbound.js";
import { debugProxyRoutes } from "./routes/debugProxy.js";
import { tlsRoutes } from "./routes/tls.js";
import { usersRoutes } from "./routes/users.js";
import { oidcRoutes } from "./routes/oidc.js";
import { replyIfPrismaSchemaMismatch } from "./lib/prismaErrors.js";
import { originGuard } from "./lib/originGuard.js";
import { prismaSessionStore } from "./lib/sessionStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const useHttps =
    config.HTTPS_ENABLED &&
    config.TLS_CERT_PATH &&
    config.TLS_KEY_PATH &&
    existsSync(config.TLS_CERT_PATH) &&
    existsSync(config.TLS_KEY_PATH);

  // When deployed behind a TLS-terminating proxy, trust X-Forwarded-* so req.protocol
  // reflects the client-facing scheme (required for secure cookie detection and for
  // rate limiting to key off the real client IP rather than the proxy's).
  const app = Fastify({
    logger: true,
    trustProxy: config.TRUST_PROXY,
    ...(useHttps
      ? {
          https: {
            key: readFileSync(config.TLS_KEY_PATH!),
            cert: readFileSync(config.TLS_CERT_PATH!),
          },
        }
      : {}),
  });

  await app.register(helmet, {
    contentSecurityPolicy:
      config.NODE_ENV === "production"
        ? {
            useDefaults: true,
            directives: {
              "img-src": ["'self'", "data:", "https://openweathermap.org"],
              "frame-src": ["'self'", "https://*.meraki.com", "https://meraki.com"],
            },
          }
        : false,
  });

  // Strict CORS allow list. Browser requests from origins outside this list fail preflight
  // and never reach route handlers, which — combined with `credentials: true` — blocks the
  // "reflected origin + cookies" cross-site read class entirely. Same-origin requests (the
  // SPA is served from the API host) don't need CORS at all and pass through transparently.
  const corsAllowList = config.ORIGIN_ALLOW_LIST;
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      // Non-browser clients (curl, server-side scripts) and same-origin SPA requests don't
      // set an Origin header; let those through so health checks and internal jobs work.
      if (!origin) {
        cb(null, true);
        return;
      }
      if (corsAllowList.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS: origin ${origin} not allowed`), false);
    },
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(cookie);
  // Production cookie hardening: require HTTPS explicitly (no "auto", which can be spoofed
  // when the reverse proxy's X-Forwarded-Proto isn't trusted), keep SameSite=Lax so the
  // OIDC top-level-redirect callback still attaches the session, and rely on the originGuard
  // hook below for mutating-request CSRF defense. Sessions persist in Postgres so they
  // survive restarts and scale across instances.
  //
  // `__Host-` prefix in production: the browser enforces that cookies named with this prefix
  // are `Secure`, scoped to `Path=/`, and have no `Domain` attribute — which is exactly our
  // shape. Effect: another app on a sibling subdomain cannot overwrite or read this cookie
  // via `document.cookie`, and the browser won't accept it over plain HTTP. Dev (HTTP) falls
  // back to the plain name because `__Host-` requires `Secure`. Deploying this change forces
  // a one-time re-login since the cookie name changed.
  const sessionCookieName =
    config.NODE_ENV === "production" && config.HTTPS_ENABLED ? "__Host-rsid" : "rsid";
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookieName: sessionCookieName,
    store: prismaSessionStore,
    cookie: {
      path: "/",
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  });

  // CSRF defense: reject POST/PUT/PATCH/DELETE whose Origin (or Referer) isn't in the allow
  // list. Runs after session middleware so we still have req.session for downstream handlers.
  app.addHook("preHandler", originGuard);

  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024 },
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(sessionHeartbeatRoutes);
  await app.register(oidcRoutes);
  await app.register(sitesRoutes);
  await app.register(credentialsRoutes);
  await app.register(adminRoutes);
  await app.register(usersRoutes);
  await app.register(dashboardRoutes);
  await app.register(tagsRoutes);
  await app.register(circuitsRoutes);
  await app.register(debugOutboundRoutes);
  await app.register(debugProxyRoutes);
  await app.register(tlsRoutes);

  const webDist = resolve(__dirname, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (replyIfPrismaSchemaMismatch(error, reply, request.log)) {
      return;
    }
    const statusCode = error.statusCode ?? 500;
    const isServerError = statusCode >= 500;
    if (isServerError) {
      // Log with request.id so the operator can grep the server log by the same correlation
      // id returned to the client. `err` is serialized by pino-std-serializers which includes
      // the stack trace — this is what you want when diagnosing a 500 from a bug report.
      request.log.error(
        { err: error, reqId: request.id, url: request.url, method: request.method },
        "unhandled error returned 500",
      );
    }
    if (reply.sent) {
      return;
    }
    // 4xx responses carry the explicit message set by the route handler (safe by design —
    // we author those strings). 5xx responses are by definition unexpected, so the message
    // can contain Prisma error text, file paths, stack fragments, or other internals that
    // assist an attacker doing reconnaissance. Replace with a generic string and surface the
    // real details only through the structured logger. Same reasoning for `validation` —
    // only emit it on 4xx so attackers can't harvest internal schema paths from 5xx.
    const body: {
      error: string;
      statusCode: number;
      requestId?: string;
      details?: unknown;
      devMessage?: string;
    } = {
      error: isServerError ? "Internal server error" : error.message,
      statusCode,
    };
    if (isServerError) {
      // Echo the request id so a user reporting "I got 500 at 10:42am" can be matched to a
      // specific log line. The id is a short, random Fastify-generated string — it carries
      // no PII and no internal topology, so it's safe to surface.
      body.requestId = request.id;
      // In local development, also include the real error message on 500s. This makes dev
      // debugging dramatically easier while preserving the production hardening posture —
      // production deploys run NODE_ENV=production and get only the generic message + id.
      if (config.NODE_ENV === "development" && error.message) {
        body.devMessage = error.message;
      }
    }
    if (!isServerError && error.validation) {
      body.details = error.validation;
    }
    void reply.status(statusCode).send(body);
  });

  return app;
}
