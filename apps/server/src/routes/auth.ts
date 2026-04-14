import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import type { UserRole } from "@prisma/client";
import { config } from "../config.js";
import { getAdminSettings } from "../lib/settings.js";

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

  app.post("/api/auth/login", async (req, reply) => {
    const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
    if (config.OIDC_ENABLED && settings?.oidcEnabled) {
      return reply.code(400).send({ error: "Use SSO to sign in" });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid credentials" });
    }
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user?.passwordHash) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    let ok: boolean;
    try {
      ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    } catch {
      req.log.warn({ userId: user.id }, "bcrypt.compare failed (invalid stored hash?)");
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    if (!ok) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    req.session.userId = user.id;
    return { ok: true, email: user.email };
  });

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
