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
import { tlsRoutes } from "./routes/tls.js";
import { usersRoutes } from "./routes/users.js";
import { oidcRoutes } from "./routes/oidc.js";
import { replyIfPrismaSchemaMismatch } from "./lib/prismaErrors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const useHttps =
    config.HTTPS_ENABLED &&
    config.TLS_CERT_PATH &&
    config.TLS_KEY_PATH &&
    existsSync(config.TLS_CERT_PATH) &&
    existsSync(config.TLS_KEY_PATH);

  const app = Fastify({
    logger: true,
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

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookieName: "rsid",
    cookie: {
      path: "/",
      httpOnly: true,
      secure: config.NODE_ENV === "production" ? "auto" : false,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  });

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
    if (statusCode >= 500) {
      request.log.error({ err: error }, error.message);
    }
    if (reply.sent) {
      return;
    }
    const body: { error: string; statusCode: number; details?: unknown } = {
      error: error.message,
      statusCode,
    };
    if (error.validation) {
      body.details = error.validation;
    }
    void reply.status(statusCode).send(body);
  });

  return app;
}
