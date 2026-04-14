import type { FastifyInstance } from "fastify";
import { clearOutboundTraces, listOutboundTraces } from "../lib/outboundTrace.js";
import { requireDebugReader, requireOrgAdmin } from "../lib/rbac.js";

export async function debugOutboundRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/debug/outbound-traces",
    { preHandler: requireDebugReader },
    async () => ({
      traces: listOutboundTraces(),
    }),
  );

  app.post(
    "/api/debug/outbound-traces/clear",
    { preHandler: requireOrgAdmin },
    async () => {
      clearOutboundTraces();
      return { ok: true };
    },
  );
}
