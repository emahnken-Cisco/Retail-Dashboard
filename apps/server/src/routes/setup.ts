import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/setup", async (req, reply) => {
    const count = await prisma.user.count();
    if (count > 0) {
      return reply.code(403).send({ error: "Setup already completed" });
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        role: UserRole.ORG_ADMIN,
      },
    });
    req.session.userId = user.id;
    return { ok: true, email: user.email };
  });

  app.get("/api/setup/status", async () => {
    const count = await prisma.user.count();
    return { needsSetup: count === 0 };
  });
}
