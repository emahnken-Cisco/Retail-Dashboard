import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getOpenWeatherQuotaSnapshot } from "../lib/openWeatherQuota.js";
import { getAdminSettings } from "../lib/settings.js";
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
}
