import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getOpenWeatherQuotaSnapshot } from "../lib/openWeatherQuota.js";
import { getAdminSettings } from "../lib/settings.js";
import { requireAuth } from "./auth.js";
import { requireOrgAdmin } from "../lib/rbac.js";
import { runMerakiIngest } from "../jobs/merakiIngest.js";
import { runThousandEyesIngest } from "../jobs/thousandEyesIngest.js";
import { runRetentionPurge } from "../jobs/retention.js";
import { validateExternalHttpsUrl } from "../lib/urlGuard.js";
import { config } from "../config.js";

const lensesSchema = z
  .object({
    showMeraki: z.boolean().optional(),
    showThousandEyes: z.boolean().optional(),
    showMap: z.boolean().optional(),
    cardColumns: z.number().int().min(1).max(6).optional(),
    /** Default state for map weather overlay (users can still toggle on the dashboard map). */
    mapWeatherDefaultOn: z.boolean().optional(),
    mapWeatherLayer: z
      .enum(["openweather_precipitation", "openweather_clouds", "openweather_wind", "openweather_temp"])
      .optional(),
    mapWeatherOpacity: z.number().min(0.2).max(0.95).optional(),
    /** Legend tick labels for temperature map overlay: F (default) or C (matches tile colormap). */
    mapWeatherTemperatureUnit: z.enum(["F", "C"]).optional(),
    /** Wind overlay legend: mph (default), ms (m/s), or kmh. */
    mapWeatherWindSpeedUnit: z.enum(["mph", "ms", "kmh"]).optional(),
    /** Precipitation overlay legend: in (default) or mm (matches tile scale). */
    mapWeatherPrecipitationUnit: z.enum(["mm", "in"]).optional(),
    /**
     * Default time window for the per-AP wireless connection-log sidecar.
     * Stored as a short slug so the UI and server can map it to a fixed
     * `timespan` query param against the Meraki events API. Users can
     * still override per-open from the sidecar's toggle.
     */
    wirelessConnLogDefaultWindow: z.enum(["1h", "12h", "24h", "7d"]).optional(),
    /**
     * RSSI threshold (dBm) at which a ThousandEyes Endpoint Agent's
     * Wi-Fi pill flips from green → amber on the dashboard endpoints
     * table. Stricter (lower / more-negative) values flag more endpoints
     * as borderline; defaults to -65 which matches common Cisco Wi-Fi
     * engineering guidance for healthy 5 GHz coverage.
     */
    wirelessImpactRssiAmberDbm: z.number().min(-100).max(-20).optional(),
    /**
     * RSSI threshold (dBm) at which the pill flips amber → red ("impacted").
     * Must be ≤ the amber threshold; the correlator swaps them safely if a
     * reversed pair sneaks through. Defaults to -75 dBm.
     */
    wirelessImpactRssiRedDbm: z.number().min(-100).max(-20).optional(),
  })
  .optional();

const settingsPatchSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  heartbeatIntervalSec: z.number().int().min(30).max(86400).optional(),
  pollIntervalMerakiSec: z.number().int().min(60).max(86400).optional(),
  pollIntervalTESec: z.number().int().min(60).max(86400).optional(),
  oidcEnabled: z.boolean().optional(),
  oidcIssuerUrl: z.string().url().nullable().optional(),
  oidcClientId: z.string().nullable().optional(),
  googleMapsEnabled: z.boolean().optional(),
  sessionIdleTimeoutMin: z.number().int().min(5).max(10080).optional(),
  /** 0 = disable server-side OpenWeather; each map tile/probe/test call counts as one. */
  openWeatherDailyLimit: z.number().int().min(0).max(2_000_000).optional(),
  /** ThousandEyes account group id — same TE scope as your Meraki org; empty clears to token default. */
  thousandEyesAid: z.union([z.string().max(64), z.null()]).optional(),
  lenses: lensesSchema,
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/settings",
    { preHandler: requireOrgAdmin },
    async () => {
      const row = await getAdminSettings();
      const owmRow = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      const quota = await getOpenWeatherQuotaSnapshot();
      return {
        retentionDays: row.retentionDays,
        heartbeatIntervalSec: row.heartbeatIntervalSec,
        pollIntervalMerakiSec: row.pollIntervalMerakiSec,
        pollIntervalTESec: row.pollIntervalTESec,
        oidcEnabled: row.oidcEnabled,
        oidcIssuerUrl: row.oidcIssuerUrl,
        oidcClientId: row.oidcClientId,
        googleMapsEnabled: row.googleMapsEnabled,
        tlsCertPath: row.tlsCertPath,
        tlsKeyPath: row.tlsKeyPath,
        sessionIdleTimeoutMin: row.sessionIdleTimeoutMin,
        lenses: row.lenses,
        openWeatherDailyLimit: row.openWeatherDailyLimit,
        thousandEyesAid: row.thousandEyesAid,
        openWeatherKeyConfigured: Boolean(owmRow),
        openWeatherQuotaDayUtc: quota.dayUtc,
        openWeatherCallsTodayUtc: quota.callCount,
        envOidcAvailable: Boolean(
          process.env.OIDC_ENABLED === "true" || process.env.OIDC_ENABLED === "1",
        ),
      };
    },
  );

  app.patch(
    "/api/admin/settings",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const parsed = settingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const current = await getAdminSettings();
      const lenses =
        parsed.data.lenses !== undefined
          ? { ...(current.lenses as Record<string, unknown>), ...parsed.data.lenses }
          : undefined;

      const data: Prisma.AdminSettingsUpdateInput = {};
      if (parsed.data.retentionDays !== undefined) data.retentionDays = parsed.data.retentionDays;
      if (parsed.data.heartbeatIntervalSec !== undefined) {
        data.heartbeatIntervalSec = parsed.data.heartbeatIntervalSec;
      }
      if (parsed.data.pollIntervalMerakiSec !== undefined) {
        data.pollIntervalMerakiSec = parsed.data.pollIntervalMerakiSec;
      }
      if (parsed.data.pollIntervalTESec !== undefined) {
        data.pollIntervalTESec = parsed.data.pollIntervalTESec;
      }
      if (parsed.data.oidcEnabled !== undefined) data.oidcEnabled = parsed.data.oidcEnabled;
      if (parsed.data.oidcIssuerUrl !== undefined) {
        // Reject issuer URLs that could be used for SSRF (private ranges, http://, creds in
        // the authority, disallowed origin). A second, redundant check also runs at
        // login/callback time — catching it here gives admins instant feedback instead of
        // a broken SSO flow later, and keeps known-bad values from being persisted.
        if (parsed.data.oidcIssuerUrl !== null) {
          const issuerCheck = validateExternalHttpsUrl(parsed.data.oidcIssuerUrl, {
            allowList: config.OIDC_ISSUER_ALLOW_LIST,
          });
          if (!issuerCheck.ok) {
            return reply
              .code(400)
              .send({ error: `Invalid OIDC issuer URL: ${issuerCheck.reason}` });
          }
        }
        data.oidcIssuerUrl = parsed.data.oidcIssuerUrl;
      }
      if (parsed.data.oidcClientId !== undefined) {
        data.oidcClientId = parsed.data.oidcClientId;
      }
      if (parsed.data.googleMapsEnabled !== undefined) {
        data.googleMapsEnabled = parsed.data.googleMapsEnabled;
      }
      if (parsed.data.sessionIdleTimeoutMin !== undefined) {
        data.sessionIdleTimeoutMin = parsed.data.sessionIdleTimeoutMin;
      }
      if (parsed.data.openWeatherDailyLimit !== undefined) {
        data.openWeatherDailyLimit = parsed.data.openWeatherDailyLimit;
      }
      if (parsed.data.thousandEyesAid !== undefined) {
        const raw = parsed.data.thousandEyesAid;
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        data.thousandEyesAid = trimmed.length > 0 ? trimmed : null;
      }
      if (lenses !== undefined) data.lenses = lenses;

      const row = await prisma.adminSettings.update({
        where: { id: "singleton" },
        data,
      });
      return row;
    },
  );

  app.post(
    "/api/admin/tasks/resync",
    { preHandler: requireOrgAdmin },
    async () => {
      await runMerakiIngest();
      await runThousandEyesIngest();
      return { ok: true };
    },
  );

  app.post(
    "/api/admin/tasks/retention",
    { preHandler: requireOrgAdmin },
    async () => {
      const r = await runRetentionPurge();
      return { ok: true, deleted: r.deleted };
    },
  );

  app.get(
    "/api/admin/ingest-runs",
    { preHandler: requireOrgAdmin },
    async () => {
      const runs = await prisma.ingestRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 50,
      });
      return {
        runs: runs.map((r) => ({
          id: r.id,
          jobType: r.jobType,
          status: r.status,
          errorSummary: r.errorSummary,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  // -------------------------------------------------------------------------
  // Wireless AP "healthy design" client capacity, per Meraki model.
  // Read: any authenticated user (the wireless health route needs it too).
  // Write: ORG_ADMIN only; capacity change is recorded as a structured log
  // entry (the repo has no audit-log model — this is the agreed v1 trail).
  // -------------------------------------------------------------------------

  app.get(
    "/api/admin/wireless/model-capacity",
    { preHandler: requireAuth },
    async () => {
      const rows = await prisma.merakiModelClientCapacity.findMany({
        orderBy: { model: "asc" },
      });
      return {
        models: rows.map((r) => ({
          model: r.model,
          capacity: r.capacity,
          note: r.note,
          updatedById: r.updatedById,
          updatedByEmail: r.updatedByEmail,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  const modelCapacityUpdateSchema = z.object({
    capacity: z.number().int().min(1).max(2000),
    note: z.string().max(280).nullable().optional(),
  });

  app.put(
    "/api/admin/wireless/model-capacity/:model",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const { model: rawModel } = req.params as { model: string };
      const model = rawModel?.trim().toUpperCase() ?? "";
      // Allow letters, digits, and dash so future Catalyst SKUs (e.g. CW9176D1) work.
      // Reject anything else so an attacker can't smuggle a path traversal as the PK.
      if (!model || !/^[A-Z0-9-]{2,32}$/.test(model)) {
        return reply.code(400).send({ error: "Invalid model name" });
      }

      const parsed = modelCapacityUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const userId = req.session?.userId as string | undefined;
      if (!userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const editor = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!editor) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const note = parsed.data.note === undefined ? undefined : parsed.data.note;
      const row = await prisma.merakiModelClientCapacity.upsert({
        where: { model },
        update: {
          capacity: parsed.data.capacity,
          ...(note !== undefined ? { note } : {}),
          updatedById: userId,
          updatedByEmail: editor.email,
        },
        create: {
          model,
          capacity: parsed.data.capacity,
          note: note ?? null,
          updatedById: userId,
          updatedByEmail: editor.email,
        },
      });

      req.log.info(
        {
          audit: "wireless.modelCapacity.updated",
          model: row.model,
          capacity: row.capacity,
          updatedById: row.updatedById,
          updatedByEmail: row.updatedByEmail,
        },
        "wireless model client capacity updated",
      );

      return {
        model: row.model,
        capacity: row.capacity,
        note: row.note,
        updatedById: row.updatedById,
        updatedByEmail: row.updatedByEmail,
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  /**
   * Delete a model capacity row. Used when an AP model is retired from the
   * fleet (e.g. MR33 EOL'd). The wireless sidecar falls back to a default
   * capacity of 40 for any model not in this table, so deletion is non-fatal
   * but the gauge tone becomes less accurate for that model.
   *
   * Gated to ORG_ADMIN; emits an audit log entry; rejects malformed model
   * names with the same allow-list as PUT to prevent path traversal via the
   * primary key.
   */
  app.delete(
    "/api/admin/wireless/model-capacity/:model",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const { model: rawModel } = req.params as { model: string };
      const model = rawModel?.trim().toUpperCase() ?? "";
      if (!model || !/^[A-Z0-9-]{2,32}$/.test(model)) {
        return reply.code(400).send({ error: "Invalid model name" });
      }

      const userId = req.session?.userId as string | undefined;
      if (!userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const editor = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!editor) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      // Confirm existence so we can emit a useful 404 instead of swallowing.
      const existing = await prisma.merakiModelClientCapacity.findUnique({ where: { model } });
      if (!existing) {
        return reply.code(404).send({ error: `Model ${model} not found` });
      }

      await prisma.merakiModelClientCapacity.delete({ where: { model } });

      req.log.info(
        {
          audit: "wireless.modelCapacity.deleted",
          model,
          priorCapacity: existing.capacity,
          actorId: userId,
          actorEmail: editor.email,
        },
        "wireless model client capacity deleted",
      );

      return reply.code(204).send();
    },
  );
}
