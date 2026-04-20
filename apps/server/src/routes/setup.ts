import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { passwordSchema } from "../lib/passwordPolicy.js";

const bodySchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});

/**
 * Arbitrary 64-bit identifier for the PostgreSQL transaction-scoped advisory lock that
 * serializes initial-setup attempts. Any constant unique to this operation will do; we pick
 * a fixed integer so cooperating processes land on the same lock without coordinating.
 */
const SETUP_ADVISORY_LOCK_KEY = 0x7265_7461_696c_0001n;

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/setup",
    {
      // Brute force protection: the setup endpoint is public pre-first-user but should only
      // ever be hit once in a system's lifetime. A tight cap prevents scanners from hammering
      // the endpoint looking for a narrow race window between deployment and first signup.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const email = parsed.data.email.toLowerCase();
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);

      // Atomic guard against a race between `user.count()` and `user.create()`. Without the
      // advisory lock two concurrent /api/setup calls could each see an empty user table,
      // both proceed, and both land an ORG_ADMIN row — handing an attacker who wins the race
      // against a legitimate operator full administrative access. `pg_advisory_xact_lock`
      // blocks the second caller until the first transaction commits or rolls back, and is
      // released automatically when the transaction ends.
      let user: { id: string; email: string };
      try {
        user = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`;
          const count = await tx.user.count();
          if (count > 0) {
            throw new Error("SETUP_COMPLETED");
          }
          return tx.user.create({
            data: {
              email,
              passwordHash,
              role: UserRole.ORG_ADMIN,
            },
            select: { id: true, email: true },
          });
        });
      } catch (err) {
        if (err instanceof Error && err.message === "SETUP_COMPLETED") {
          return reply.code(403).send({ error: "Setup already completed" });
        }
        throw err;
      }

      // Regenerate the session ID before binding it to the newly-created admin so the cookie
      // the client ends up with was never visible to any other context.
      await req.session.regenerate();
      req.session.userId = user.id;
      return { ok: true, email: user.email };
    },
  );

  app.get("/api/setup/status", async () => {
    const count = await prisma.user.count();
    return { needsSetup: count === 0 };
  });
}
