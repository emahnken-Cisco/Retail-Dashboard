import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import type { UserRole } from "@prisma/client";
import { config } from "../config.js";
import { getAdminSettings } from "../lib/settings.js";
import {
  checkLoginAttempt,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "../lib/loginThrottle.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/public/auth-options", async () => {
    const settings = await getAdminSettings();
    const oidcEnabled = Boolean(config.OIDC_ENABLED && settings.oidcEnabled);
    return {
      oidcAvailable: oidcEnabled,
      oidcLoginPath: oidcEnabled ? "/api/auth/oidc/login" : null,
    };
  });

  app.post(
    "/api/auth/login",
    {
      // Tight per-IP rate limit on the credential-checking endpoint. The global 200/min
      // limit is fine for a user hitting dashboards but would leave a single attacker with
      // a 200/min credential-stuffing budget on login — this shrinks that to 10/min/IP.
      // Combined with the per-account throttle below, a coordinated credential-stuffing
      // attack has to pay real time costs whether it concentrates on one IP or spreads.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
      if (config.OIDC_ENABLED && settings?.oidcEnabled) {
        return reply.code(400).send({ error: "Use SSO to sign in" });
      }
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid credentials" });
      }

      const email = parsed.data.email.toLowerCase();

      // Per-account throttle: once a single email accumulates too many recent failures we
      // lock it for the remainder of the window. We check BEFORE the bcrypt compare so an
      // attacker can't use response-time side channels to distinguish "account exists" from
      // "account is locked" — both paths take the same short-circuit.
      const throttle = checkLoginAttempt(email);
      if (!throttle.allowed) {
        reply.header("Retry-After", String(throttle.retryAfterSec));
        return reply.code(429).send({ error: "Too many attempts, try again later" });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) {
        recordFailedLogin(email);
        return reply.code(401).send({ error: "Invalid username or password" });
      }
      let ok: boolean;
      try {
        ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      } catch {
        req.log.warn({ userId: user.id }, "bcrypt.compare failed (invalid stored hash?)");
        recordFailedLogin(email);
        return reply.code(401).send({ error: "Invalid username or password" });
      }
      if (!ok) {
        recordFailedLogin(email);
        return reply.code(401).send({ error: "Invalid username or password" });
      }
      recordSuccessfulLogin(email);
      // Regenerate the session ID before binding it to the authenticated user. This prevents
      // session-fixation attacks where an attacker who planted a known `rsid` cookie on the
      // victim's browser (via subdomain XSS, shared LAN, etc.) would otherwise inherit the
      // victim's authenticated session after the victim logs in.
      await req.session.regenerate();
      req.session.userId = user.id;
      return { ok: true, email: user.email };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    await req.session.destroy();
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.session.userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user) {
      await req.session.destroy();
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return { email: user.email, id: user.id, role: user.role as UserRole };
  });
}
