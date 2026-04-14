import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "./auth.js";

export async function sessionHeartbeatRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/session/ping",
    { preHandler: requireAuth },
    async (req) => {
      const s = req.session as { touch?: () => void };
      if (typeof s.touch === "function") {
        s.touch();
      }
      return { ok: true, at: new Date().toISOString() };
    },
  );

  app.get("/api/session/config", async (_req, reply) => {
    const row =
      (await prisma.adminSettings.findUnique({ where: { id: "singleton" } })) ??
      (await prisma.adminSettings.create({ data: { id: "singleton" } }));
    return {
      heartbeatIntervalSec: row.heartbeatIntervalSec,
      sessionIdleTimeoutMin: row.sessionIdleTimeoutMin,
    };
  });
}
