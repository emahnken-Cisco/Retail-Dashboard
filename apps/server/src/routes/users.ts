import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireOrgAdmin } from "../lib/rbac.js";
import { passwordSchema } from "../lib/passwordPolicy.js";

const roleSchema = z.enum(["ORG_ADMIN", "LOCATION_CIRCUIT", "USER"]);

const createBody = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: roleSchema,
});

const patchBody = z.object({
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  password: passwordSchema.optional(),
});

/**
 * Guard against operations that would leave the system without any ORG_ADMIN user, which
 * would be an unrecoverable lockout: there's no other path back to admin privileges short
 * of DB surgery. Pass the ID of the user about to be deleted or demoted; returns the
 * user-facing reason when the operation must be refused.
 */
async function assertNotRemovingLastOrgAdmin(targetUserId: string): Promise<string | null> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true },
  });
  if (!target || target.role !== UserRole.ORG_ADMIN) {
    return null;
  }
  const adminCount = await prisma.user.count({ where: { role: UserRole.ORG_ADMIN } });
  if (adminCount <= 1) {
    return "Cannot remove the last organization admin. Create another admin first.";
  }
  return null;
}

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
      // Block role changes that would leave the system with zero ORG_ADMINs — that path has
      // no supported recovery and is especially risky when the admin doing the PATCH is
      // demoting themselves (or has been socially-engineered into doing so).
      if (data.role !== undefined && data.role !== UserRole.ORG_ADMIN) {
        const reason = await assertNotRemovingLastOrgAdmin(id);
        if (reason) {
          return reply.code(400).send({ error: reason });
        }
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
      const reason = await assertNotRemovingLastOrgAdmin(id);
      if (reason) {
        return reply.code(400).send({ error: reason });
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
