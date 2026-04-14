import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireOrgAdmin } from "../lib/rbac.js";

const roleSchema = z.enum(["ORG_ADMIN", "LOCATION_CIRCUIT", "USER"]);

const createBody = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  role: roleSchema,
});

const patchBody = z.object({
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  password: z.string().min(10).optional(),
});

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/users",
    { preHandler: requireOrgAdmin },
    async () => {
      const row = await prisma.user.findMany({
        orderBy: { email: "asc" },
        select: { id: true, email: true, role: true, createdAt: true },
      });
      return {
        users: row.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/api/admin/users",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const email = parsed.data.email.toLowerCase();
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) {
        return reply.code(409).send({ error: "A user with this email already exists" });
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: parsed.data.role as UserRole,
        },
        select: { id: true, email: true, role: true, createdAt: true },
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
      };
    },
  );

  app.patch(
    "/api/admin/users/:id",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = patchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      const data: { email?: string; role?: UserRole; passwordHash?: string } = {};
      if (parsed.data.email !== undefined) {
        data.email = parsed.data.email.toLowerCase();
      }
      if (parsed.data.role !== undefined) {
        data.role = parsed.data.role as UserRole;
      }
      if (parsed.data.password !== undefined) {
        data.passwordHash = await bcrypt.hash(parsed.data.password, 12);
      }
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: "No changes" });
      }
      try {
        const user = await prisma.user.update({
          where: { id },
          data,
          select: { id: true, email: true, role: true, createdAt: true },
        });
        return {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt.toISOString(),
          },
        };
      } catch (e) {
        const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
        if (code === "P2002") {
          return reply.code(409).send({ error: "Email already in use" });
        }
        throw e;
      }
    },
  );

  app.delete(
    "/api/admin/users/:id",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sessionId = req.session?.userId as string | undefined;
      if (sessionId === id) {
        return reply.code(400).send({ error: "You cannot delete your own account" });
      }
      try {
        await prisma.user.delete({ where: { id } });
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
