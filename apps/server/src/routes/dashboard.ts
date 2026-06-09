import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";
import { resolvedLocalContactFromSite } from "../lib/resolvedCircuitContact.js";
import { decryptSecretForHttp } from "../lib/cryptoVault.js";
import { buildEndpointAgentDashboardDetail } from "../lib/endpointAgentDetail.js";
import { replyIfPrismaSchemaMismatch } from "../lib/prismaErrors.js";
import {
  OPENWEATHER_QUOTA_EXCEEDED_TILE,
  getOpenWeatherQuotaSnapshot,
  tryConsumeOpenWeatherCall,
} from "../lib/openWeatherQuota.js";
import { tracedFetch } from "../lib/outboundTrace.js";
import { merakiGeoFromSnapshotPayload, resolveSiteCoordinates } from "../lib/siteCoordinates.js";
import { requireAuth } from "./auth.js";
import { getMerakiApiKey } from "../lib/merakiVault.js";
import {
  getApplianceDhcpSubnets,
  getDeviceCameraVideoLink,
  getDeviceLossAndLatencyHistory,
  getDeviceWirelessConnectionStats,
  getDeviceWirelessRadioSettings,
  getNetworkApplianceUplinksUsageHistory,
  getNetworkApplianceVlans,
  getNetworkChannelUtilizationHistory,
  getNetworkWirelessClientCountHistory,
  getNetworkWirelessSsids,
  type MerakiApplianceVlanRow,
  type MerakiNetworkChannelUtilizationRow,
} from "../lib/merakiClient.js";
import { fetchEnterpriseTestLatencyLossSeries } from "../lib/teEnterpriseTestMetrics.js";
import {
  getTeEnterpriseMetricsFromCache,
  setTeEnterpriseMetricsCache,
  teEnterpriseMetricsCacheKey,
  type TeEnterpriseMetricsCacheEntry,
} from "../lib/teEnterpriseTestMetricsCache.js";
import {
  dhcpScopeHealthCacheKey,
  getDhcpScopeHealthFromCache,
  setDhcpScopeHealthCache,
  type DhcpScopeEntry,
  type DhcpScopeHealthCacheEntry,
} from "../lib/dhcpScopeHealthCache.js";
import {
  getWirelessHealthFromCache,
  setWirelessHealthCache,
  wirelessHealthCacheKey,
  type WirelessApBandEntry,
  type WirelessApEntry,
  type WirelessBand,
  type WirelessChannelEntry,
  type WirelessHealthCacheEntry,
  type WirelessSsidEntry,
} from "../lib/wirelessHealthCache.js";

function isPayloadRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type SiteWeatherApiPayload = {
  summary: string;
  locationLabel: string;
  conditionMain: string;
  conditionDescription: string;
  iconCode: string | null;
  tempF: number;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
};

function buildSiteWeatherPayload(json: unknown, locationLabel: string): SiteWeatherApiPayload | null {
  if (!isPayloadRecord(json)) {
    return null;
  }
  const w0 = Array.isArray(json.weather) ? json.weather[0] : undefined;
  const weather = isPayloadRecord(w0) ? w0 : null;
  const descRaw = weather && typeof weather.description === "string" ? weather.description : "";
  const desc = descRaw ? descRaw.charAt(0).toUpperCase() + descRaw.slice(1) : "";
  const mainStr = weather && typeof weather.main === "string" ? weather.main : "";
  const iconCode = weather && typeof weather.icon === "string" ? weather.icon : null;
  const main = isPayloadRecord(json.main) ? json.main : null;
  const temp = main && typeof main.temp === "number" ? main.temp : null;
  const feelsRaw = main && typeof main.feels_like === "number" ? main.feels_like : null;
  const feels = feelsRaw ?? temp ?? 0;
  const hum = main && typeof main.humidity === "number" ? main.humidity : 0;
  const windObj = isPayloadRecord(json.wind) ? json.wind : null;
  const wind = windObj && typeof windObj.speed === "number" ? windObj.speed : 0;
  if (temp == null) {
    return null;
  }
  const parts: string[] = [];
  if (desc) {
    parts.push(desc);
  }
  parts.push(`${Math.round(temp)}°F`);
  if (feels != null) {
    parts.push(`feels like ${Math.round(feels)}°F`);
  }
  parts.push(`${Math.round(hum)}% humidity`);
  parts.push(`wind ${wind < 10 ? wind.toFixed(1) : Math.round(wind)} mph`);
  const place = locationLabel.trim() ? `${locationLabel.trim()}: ` : "";
  const summary = `${place}${parts.join(" · ")}.`;
  return {
    summary,
    locationLabel: locationLabel.trim(),
    conditionMain: mainStr || "Unknown",
    conditionDescription: desc || mainStr || "—",
    iconCode,
    tempF: temp,
    feelsLikeF: feels,
    humidity: hum,
    windMph: wind,
  };
}

/** Pick a broader place name than the Current Weather `name` (often a neighborhood). Counts as one OWM call. */
async function openWeatherReverseCityLabel(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<string | null> {
  const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&limit=5&appid=${encodeURIComponent(apiKey)}`;
  const res = await tracedFetch(url, undefined, {
    provider: "openweather",
    note: "Geocoding reverse (city label)",
  });
  const text = await res.text();
  let arr: unknown;
  try {
    arr = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return null;
  }
  const items = arr.filter(isPayloadRecord);
  if (items.length === 0) {
    return null;
  }
  const norm = (s: string) => s.trim().toLowerCase();

  const firstName = typeof items[0].name === "string" ? items[0].name.trim() : "";
  const weatherStyleLocal = norm(firstName);

  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    const n = typeof it.name === "string" ? it.name.trim() : "";
    if (!n || norm(n) === weatherStyleLocal) {
      continue;
    }
    const st = typeof it.state === "string" ? it.state.trim() : "";
    if (st) {
      return `${n}, ${st}`;
    }
    return n;
  }

  const last = items[items.length - 1];
  const ln = typeof last.name === "string" ? last.name.trim() : "";
  if (ln && norm(ln) !== weatherStyleLocal) {
    const st = typeof last.state === "string" ? last.state.trim() : "";
    return st ? `${ln}, ${st}` : ln;
  }
  return firstName || null;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/dashboard/google-maps-key",
    { preHandler: requireAuth },
    async (_req, reply) => {
      const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
      if (!settings?.googleMapsEnabled) {
        return reply.code(404).send({ error: "Google Maps lens disabled" });
      }
      const row = await prisma.credentialVault.findUnique({ where: { provider: "google_maps" } });
      if (!row) {
        return reply.code(404).send({ error: "Google Maps API key not configured" });
      }
      const apiKey = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "Google Maps API key");
      return { apiKey };
    },
  );

  const owmTileSlugs = new Set([
    "precipitation_new",
    "clouds_new",
    "wind_new",
    "temp_new",
    "pressure_new",
  ]);

  /**
   * Proxies map tiles through this server so every OpenWeather call counts toward the daily quota (Admin).
   */
  app.get(
    "/api/dashboard/weather/openweather-tile/:slug/:z/:x/:y",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { slug, z, x, y } = req.params as { slug: string; z: string; x: string; y: string };
      if (!owmTileSlugs.has(slug)) {
        return reply.code(400).send({ error: "Invalid layer slug" });
      }
      const zi = Number.parseInt(z, 10);
      const xi = Number.parseInt(x, 10);
      const yi = Number.parseInt(y, 10);
      if (!Number.isFinite(zi) || !Number.isFinite(xi) || !Number.isFinite(yi)) {
        return reply.code(400).send({ error: "Invalid tile coordinates" });
      }
      const row = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      if (!row) {
        return reply.code(404).send({ error: "OpenWeatherMap API key not configured" });
      }
      const quota = await tryConsumeOpenWeatherCall();
      if (!quota.allowed) {
        return reply
          .header("X-Retail-OpenWeather-Quota", "exceeded")
          .header("Cache-Control", "no-store")
          .type("image/png")
          .send(OPENWEATHER_QUOTA_EXCEEDED_TILE);
      }
      const apiKey = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "OpenWeatherMap API key").trim();
      const url = `https://tile.openweathermap.org/map/${slug}/${zi}/${xi}/${yi}.png?appid=${encodeURIComponent(apiKey)}`;
      try {
        const res = await tracedFetch(url, { redirect: "manual" }, { provider: "openweather", note: "map tile (proxy)" });
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "image/png";
        return reply
          .header("Cache-Control", "private, max-age=300")
          .status(res.ok ? 200 : res.status)
          .type(ct)
          .send(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "fetch failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  /**
   * Fetches one map tile server-side (counts toward daily quota) for diagnostics.
   */
  app.get(
    "/api/dashboard/weather/openweather-tiles-status",
    { preHandler: requireAuth },
    async (req, reply) => {
      const q = req.query as { slug?: string };
      const slug = typeof q.slug === "string" && owmTileSlugs.has(q.slug) ? q.slug : "precipitation_new";
      const row = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      if (!row) {
        return reply.code(404).send({ error: "OpenWeatherMap API key not configured" });
      }
      const quota = await tryConsumeOpenWeatherCall();
      if (!quota.allowed) {
        return {
          ok: false,
          httpStatus: 429,
          contentType: null,
          hint:
            quota.limit <= 0
              ? "OpenWeather is disabled (daily limit set to 0 in Admin)."
              : `Daily OpenWeather call limit reached for UTC ${quota.dayUtc} (${quota.usedAfter}/${quota.limit}). Map tiles and tests also count toward this limit. Increase tomorrow or raise the cap in Admin → OpenWeather.`,
          openweatherMessage: null,
          quotaExceeded: true,
        };
      }
      const apiKey = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "OpenWeatherMap API key").trim();
      const url = `https://tile.openweathermap.org/map/${slug}/2/1/1.png?appid=${encodeURIComponent(apiKey)}`;
      try {
        const res = await tracedFetch(url, { redirect: "manual" }, { provider: "openweather", note: "tile probe" });
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        const ok = res.ok && ct.includes("image");
        let openweatherMessage: string | null = null;
        if (!ok) {
          const bodyText = await res.text();
          if (bodyText) {
            try {
              const j = JSON.parse(bodyText) as { message?: string };
              openweatherMessage = j.message ?? bodyText.slice(0, 200);
            } catch {
              openweatherMessage = bodyText.slice(0, 200);
            }
          }
        }
        let hint: string | undefined;
        if (res.status === 401 || res.status === 403) {
          hint =
            "OpenWeather rejected this key (401/403). Common causes: (1) key not active yet — new keys can take up to ~2 hours; (2) accidental spaces when pasting — re-save the key after this fix; (3) wrong vendor — only keys from home.openweathermap.org work; (4) requesting a paid-only product — we use Weather maps 1.0 tiles only.";
        } else if (res.status === 404) {
          hint = "Tile not found — check layer name and that your subscription includes map tiles.";
        } else if (!ok && ct.includes("json")) {
          hint =
            "OpenWeather returned JSON instead of a map image. See openweatherMessage for details.";
        } else if (!ok) {
          hint = `Unexpected response (${res.status}). Check openweathermap.org account and FAQ for error 401.`;
        }
        return { ok, httpStatus: res.status, contentType: ct || null, hint, openweatherMessage };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "fetch failed";
        return { ok: false, httpStatus: 0, contentType: null, hint: msg, openweatherMessage: null };
      }
    },
  );

  /**
   * Lens and map UI flags for the main dashboard. Any authenticated user (including read-only roles)
   * needs this so the overview can load without `/api/admin/settings` (org-admin only).
   */
  app.get(
    "/api/dashboard/ui-config",
    { preHandler: requireAuth },
    async () => {
      const row = await getAdminSettings();
      const owmRow = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      return {
        lenses: row.lenses,
        googleMapsEnabled: row.googleMapsEnabled,
        openWeatherKeyConfigured: Boolean(owmRow),
      };
    },
  );

  app.get(
    "/api/dashboard/sites",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const sites = await prisma.site.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        });

        const siteIds = sites.map((s) => s.id);
        const allCircuits =
          siteIds.length > 0 ?
            await prisma.circuit.findMany({
              where: { siteId: { in: siteIds } },
              orderBy: [{ displayOrder: "asc" }, { providerName: "asc" }],
              select: {
                id: true,
                siteId: true,
                connectivityKind: true,
                providerName: true,
                carrierCircuitId: true,
                merakiInterface: true,
                merakiApplianceSerial: true,
                isSynchronous: true,
                customSpeedLabel: true,
                siteLocalContactSlot: true,
                notes: true,
                speedPreset: {
                  select: {
                    id: true,
                    label: true,
                    downloadMbps: true,
                    uploadMbps: true,
                  },
                },
              },
            })
          : [];
        type CircuitRow = (typeof allCircuits)[number];
        const circuitsBySite = new Map<string, CircuitRow[]>();
        for (const c of allCircuits) {
          const list = circuitsBySite.get(c.siteId) ?? [];
          list.push(c);
          circuitsBySite.set(c.siteId, list);
        }

        const enriched = await Promise.all(
          sites.map(async (site) => {
            const meraki = await prisma.metricSnapshot.findFirst({
              where: { siteId: site.id, source: "meraki" },
              orderBy: { capturedAt: "desc" },
            });
            const te = await prisma.metricSnapshot.findFirst({
              where: { siteId: site.id, source: "thousandeyes" },
              orderBy: { capturedAt: "desc" },
            });
            const rawCircuits = circuitsBySite.get(site.id) ?? [];
            const siteContactPick = {
              localContactPrimaryName: site.localContactPrimaryName,
              localContactPrimaryPhone: site.localContactPrimaryPhone,
              localContactPrimaryEmail: site.localContactPrimaryEmail,
              localContactSecondaryName: site.localContactSecondaryName,
              localContactSecondaryPhone: site.localContactSecondaryPhone,
              localContactSecondaryEmail: site.localContactSecondaryEmail,
            };
            const circuits = rawCircuits.map((c) => {
              const resolved = resolvedLocalContactFromSite(siteContactPick, c.siteLocalContactSlot);
              return {
                ...c,
                localContactName: resolved.localContactName,
                localContactPhone: resolved.localContactPhone,
                localContactEmail: resolved.localContactEmail,
              };
            });
            const merakiGeo = merakiGeoFromSnapshotPayload(meraki?.payload ?? null);
            const coords = resolveSiteCoordinates({
              lat: site.lat,
              lng: site.lng,
              locationLatLngManual: site.locationLatLngManual,
              merakiPayload: meraki?.payload ?? null,
            });
            return {
              ...site,
              lat: coords.lat,
              lng: coords.lng,
              merakiLat: merakiGeo?.lat ?? null,
              merakiLng: merakiGeo?.lng ?? null,
              latestMeraki: meraki
                ? { capturedAt: meraki.capturedAt.toISOString(), payload: meraki.payload }
                : null,
              latestThousandEyes: te
                ? { capturedAt: te.capturedAt.toISOString(), payload: te.payload }
                : null,
              circuits,
            };
          }),
        );

        return { sites: enriched };
      } catch (e) {
        if (replyIfPrismaSchemaMismatch(e, reply, req.log)) {
          return;
        }
        throw e;
      }
    },
  );

  /**
   * Current conditions at the store’s lat/lng. Uses 1 quota call when `Site.city` is set; otherwise 2 (weather + reverse geocode for a city-style label).
   */
  app.get(
    "/api/dashboard/sites/:siteId/weather",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      const merakiSnap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
        select: { payload: true },
      });
      const { lat: wxLat, lng: wxLng } = resolveSiteCoordinates({
        lat: site.lat,
        lng: site.lng,
        locationLatLngManual: site.locationLatLngManual,
        merakiPayload: merakiSnap?.payload ?? null,
      });
      if (wxLat == null || wxLng == null) {
        return reply.code(400).send({
          error: "Site has no coordinates",
          hint:
            site.locationLatLngManual ?
              "Manual coordinates are enabled: set latitude and longitude on the Locations tab, or turn off manual override to use Meraki device position from the latest ingest."
            : "No Meraki device position in the latest snapshot yet. Set manual coordinates on the Locations tab (recommended), or wait for Meraki ingest.",
        });
      }
      const row = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      if (!row) {
        return reply.code(404).send({
          error: "OpenWeatherMap API key not configured",
          hint: "Add a key under API keys.",
        });
      }
      const quota = await tryConsumeOpenWeatherCall();
      if (!quota.allowed) {
        return reply.code(429).send({
          error: "OpenWeather daily limit reached",
          quotaExceeded: true,
          hint:
            quota.limit <= 0
              ? "OpenWeather is disabled (daily limit 0 in Admin)."
              : `Limit ${quota.limit} calls per UTC day (${quota.dayUtc}); used ${quota.usedAfter}. Raise the cap in Admin or try tomorrow.`,
        });
      }
      const apiKey = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "OpenWeatherMap API key").trim();
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(String(wxLat))}&lon=${encodeURIComponent(String(wxLng))}&units=imperial&appid=${encodeURIComponent(apiKey)}`;
      try {
        const res = await tracedFetch(url, undefined, {
          provider: "openweather",
          note: "Current Weather 2.5 (site detail)",
        });
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          return reply.code(502).send({ error: "Invalid response from OpenWeather" });
        }
        if (!res.ok) {
          const msg =
            isPayloadRecord(body) && typeof body.message === "string"
              ? body.message
              : text.slice(0, 200);
          return reply.code(502).send({ error: "OpenWeather request failed", detail: msg });
        }

        const weatherLocalName =
          isPayloadRecord(body) && typeof body.name === "string" ? body.name.trim() : "";

        let locationLabel = site.city?.trim() ?? "";
        let usedReverse = false;
        if (!locationLabel) {
          const q2 = await tryConsumeOpenWeatherCall();
          if (q2.allowed) {
            try {
              const rev = await openWeatherReverseCityLabel(wxLat, wxLng, apiKey);
              if (rev) {
                locationLabel = rev;
                usedReverse = true;
              }
            } catch {
              /* fall through to weather name */
            }
          }
          if (!locationLabel) {
            locationLabel = weatherLocalName;
          }
        }

        const payload = buildSiteWeatherPayload(body, locationLabel);
        if (!payload) {
          return reply.code(502).send({ error: "Could not parse weather response" });
        }
        const snap = await getOpenWeatherQuotaSnapshot();
        return {
          summary: payload.summary,
          locationName: locationLabel || weatherLocalName || null,
          locationLabel: payload.locationLabel,
          conditionMain: payload.conditionMain,
          conditionDescription: payload.conditionDescription,
          iconCode: payload.iconCode,
          tempF: payload.tempF,
          feelsLikeF: payload.feelsLikeF,
          humidity: payload.humidity,
          windMph: payload.windMph,
          locationSource: site.city?.trim()
            ? "site"
            : usedReverse
              ? "geocode"
              : "weather_local",
          fetchedAt: new Date().toISOString(),
          quota: { dayUtc: snap.dayUtc, usedAfter: snap.callCount, limit: snap.limit },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "fetch failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  app.get(
    "/api/dashboard/history/:siteId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const q = req.query as { source?: string; days?: string };
      const source = q.source ?? "meraki";
      const days = Math.min(90, Math.max(1, parseInt(q.days ?? "14", 10) || 14));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const rows = await prisma.metricSnapshot.findMany({
        where: { siteId, source, capturedAt: { gte: since } },
        orderBy: { capturedAt: "asc" },
        take: 2000,
      });

      return {
        siteId,
        source,
        points: rows.map((r) => ({
          capturedAt: r.capturedAt.toISOString(),
          payload: r.payload,
        })),
      };
    },
  );

  app.get(
    "/api/dashboard/sites/:siteId/endpoint-agents/:agentId/detail",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId, agentId } = req.params as { siteId: string; agentId: string };
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "thousandeyes" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap) {
        return reply.code(404).send({ error: "No ThousandEyes snapshot for this site" });
      }
      const payload = snap.payload;
      if (!isPayloadRecord(payload)) {
        return reply.code(403).send({ error: "Invalid snapshot payload" });
      }
      const epRaw = payload.endpointAgents;
      const epList = Array.isArray(epRaw) ? epRaw : [];
      const allowed = epList.some(
        (row) => isPayloadRecord(row) && String(row.id ?? "") === agentId,
      );
      if (!allowed) {
        return reply
          .code(403)
          .send({ error: "Endpoint agent is not in the latest site snapshot (run TE ingest after linking)." });
      }

      const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
      if (!row) {
        return reply.code(503).send({ error: "ThousandEyes token not configured" });
      }
      const token = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "ThousandEyes token");
      try {
        const admin = await getAdminSettings();
        const detail = await buildEndpointAgentDashboardDetail(token, agentId, admin.thousandEyesAid);
        return detail;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        req.log.warn({ err: e, siteId, agentId }, "endpoint agent detail failed");
        return reply.code(502).send({ error: msg.slice(0, 600) });
      }
    },
  );

  /**
   * Proxies Meraki `GET /devices/{serial}/camera/videoLink` for MV cameras in the site's latest Meraki snapshot.
   * **Requirements:** Meraki API key with camera / MV read access (OAuth: `camera:config:read`), MV licensed in the org,
   * and a successful Meraki ingest after MV devices exist. `visionUrl` is usually best for embedding; direct `url` may
   * expire quickly and can be blocked by Meraki `X-Frame-Options` in some setups.
   */
  app.get(
    "/api/dashboard/sites/:siteId/meraki-cameras/:serial/video-link",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId, serial } = req.params as { siteId: string; serial: string };
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap) {
        return reply.code(404).send({ error: "No Meraki snapshot for this site" });
      }
      const payload = snap.payload;
      if (!isPayloadRecord(payload)) {
        return reply.code(403).send({ error: "Invalid snapshot payload" });
      }
      const devices = Array.isArray(payload.devices) ? payload.devices : [];
      const allowed = devices.some((d) => {
        if (!isPayloadRecord(d)) {
          return false;
        }
        const s = String(d.serial ?? "");
        const model = String(d.model ?? "").toUpperCase();
        return s === serial && model.startsWith("MV");
      });
      if (!allowed) {
        return reply
          .code(403)
          .send({ error: "Camera serial is not an MV in the latest site snapshot (run Meraki ingest)." });
      }

      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }
      try {
        const link = await getDeviceCameraVideoLink(apiKey, serial);
        const url = typeof link.url === "string" ? link.url : null;
        const visionUrl = typeof link.visionUrl === "string" ? link.visionUrl : null;
        return { url, visionUrl };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        req.log.warn({ err: e, siteId, serial }, "meraki camera video link failed");
        return reply.code(502).send({ error: msg.slice(0, 600) });
      }
    },
  );

  const UPLINK_LOSS_API = new Set(["wan1", "wan2", "wan3", "wan4", "cellular"]);

  function collectAllowedEnterpriseTestsFromTePayload(
    payload: unknown,
  ): Map<string, { type: string; testName: string }> {
    const m = new Map<string, { type: string; testName: string }>();
    if (!isPayloadRecord(payload)) {
      return m;
    }
    for (const key of ["httpTests", "agentToServerTests"] as const) {
      const arr = payload[key];
      if (!Array.isArray(arr)) {
        continue;
      }
      for (const t of arr) {
        if (!isPayloadRecord(t)) {
          continue;
        }
        const id = t.testId != null ? String(t.testId).trim() : "";
        if (!id) {
          continue;
        }
        m.set(id, {
          type: String(t.type ?? ""),
          testName: String(t.testName ?? ""),
        });
      }
    }
    return m;
  }

  function applianceSerialsFromMerakiSnapshotPayload(payload: unknown): Set<string> {
    const out = new Set<string>();
    if (!isPayloadRecord(payload)) {
      return out;
    }
    const wan = payload.wan;
    if (!isPayloadRecord(wan)) {
      return out;
    }
    const apps = wan.appliances;
    if (!Array.isArray(apps)) {
      return out;
    }
    for (const a of apps) {
      if (!isPayloadRecord(a)) {
        continue;
      }
      const ser = a.serial;
      if (ser != null && String(ser).trim() !== "") {
        out.add(String(ser).trim());
      }
    }
    return out;
  }

  /** Pull `{ serial, model, name }` for every wireless-capable device (MR / CW / wireless-MX) in the snapshot. */
  function wirelessDevicesFromMerakiSnapshotPayload(
    payload: unknown,
  ): Array<{ serial: string; model: string; name: string }> {
    const out: Array<{ serial: string; model: string; name: string }> = [];
    if (!isPayloadRecord(payload)) {
      return out;
    }
    const devices = payload.devices;
    if (!Array.isArray(devices)) {
      return out;
    }
    const seen = new Set<string>();
    for (const d of devices) {
      if (!isPayloadRecord(d)) {
        continue;
      }
      const model = typeof d.model === "string" ? d.model.trim() : "";
      // MR (Wave 1/2/Wi-Fi 6), CW (Catalyst Wi-Fi 6E), or wireless-capable MX (`MX<n>W`).
      const isWireless = /^MR\d/.test(model) || /^CW\d/.test(model) || /^MX\d+W(-|$)/.test(model);
      if (!isWireless) {
        continue;
      }
      const serial = typeof d.serial === "string" ? d.serial.trim() : "";
      if (!serial || seen.has(serial)) {
        continue;
      }
      seen.add(serial);
      out.push({
        serial,
        model,
        name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : serial,
      });
    }
    return out;
  }

  /**
   * Proxies Meraki uplink usage + loss/latency history for charting (last 12h by default).
   * Requires Meraki scopes: sdwan:telemetry:read (usage) and dashboard:general:telemetry:read (loss/latency).
   */
  app.get(
    "/api/dashboard/sites/:siteId/uplink-history",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const q = req.query as Record<string, string | undefined>;
      const serial = q.serial != null ? String(q.serial).trim() : "";
      const uplinkRaw = q.uplink != null ? String(q.uplink).trim().toLowerCase() : "";
      const targetIp = q.ip != null && String(q.ip).trim() !== "" ? String(q.ip).trim() : "8.8.8.8";
      const timespanSec = Math.min(
        31 * 24 * 3600,
        Math.max(300, Number.parseInt(String(q.timespan ?? "43200"), 10) || 43200),
      );
      /** Usage history allows 60,300,600,1800,3600,86400. Loss/latency allows only 60,600,3600,86400 (not 300). */
      const USAGE_RES = [60, 300, 600, 1800, 3600, 86400] as const;
      const LOSS_RES = [60, 600, 3600, 86400] as const;
      const resRaw = Number.parseInt(String(q.resolution ?? "300"), 10);
      const resolutionUsage = USAGE_RES.includes(resRaw as (typeof USAGE_RES)[number]) ? resRaw : 300;
      const resolutionLoss: (typeof LOSS_RES)[number] = LOSS_RES.includes(resRaw as (typeof LOSS_RES)[number])
        ? (resRaw as (typeof LOSS_RES)[number])
        : resolutionUsage === 300
          ? 600
          : resolutionUsage === 1800
            ? 3600
            : 600;

      if (!serial || !UPLINK_LOSS_API.has(uplinkRaw)) {
        return reply.code(400).send({ error: "serial and uplink (wan1|wan2|wan3|wan4|cellular) are required" });
      }
      const uplink = uplinkRaw as "wan1" | "wan2" | "wan3" | "wan4" | "cellular";

      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      if (!site.merakiNetworkId?.trim()) {
        return reply.code(400).send({ error: "Site has no Meraki network linked" });
      }

      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap?.payload) {
        return reply.code(404).send({ error: "No Meraki snapshot for this site" });
      }
      const allowedSerials = applianceSerialsFromMerakiSnapshotPayload(snap.payload);
      if (!allowedSerials.has(serial)) {
        return reply
          .code(403)
          .send({ error: "Appliance serial is not in the latest Meraki WAN snapshot for this location." });
      }

      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }

      const networkId = site.merakiNetworkId.trim();

      const [usageResult, lossResult] = await Promise.allSettled([
        getNetworkApplianceUplinksUsageHistory(apiKey, networkId, {
          timespan: timespanSec,
          resolution: resolutionUsage,
        }),
        getDeviceLossAndLatencyHistory(apiKey, serial, {
          timespan: timespanSec,
          resolution: resolutionLoss,
          uplink,
          ip: targetIp,
        }),
      ]);

      const errors: { usage?: string; lossLatency?: string } = {};
      let usageRows: Awaited<ReturnType<typeof getNetworkApplianceUplinksUsageHistory>> = [];
      if (usageResult.status === "fulfilled") {
        usageRows = usageResult.value;
      } else {
        const msg = usageResult.reason instanceof Error ? usageResult.reason.message : String(usageResult.reason);
        errors.usage = msg.slice(0, 500);
      }

      let lossRows: Awaited<ReturnType<typeof getDeviceLossAndLatencyHistory>> = [];
      if (lossResult.status === "fulfilled") {
        lossRows = lossResult.value;
      } else {
        const msg = lossResult.reason instanceof Error ? lossResult.reason.message : String(lossResult.reason);
        errors.lossLatency = msg.slice(0, 500);
      }

      function trafficMbpsForRow(row: (typeof usageRows)[0]): number | null {
        const by = row.byInterface;
        if (!Array.isArray(by)) {
          return null;
        }
        const hit = by.find((b) => String(b.interface).toLowerCase() === uplink);
        if (!hit) {
          return null;
        }
        const t0 = Date.parse(row.startTime);
        const t1 = Date.parse(row.endTime);
        const sec = Math.max(1, (t1 - t0) / 1000);
        const bytes = (Number(hit.sent) || 0) + (Number(hit.received) || 0);
        return (bytes * 8) / 1e6 / sec;
      }

      const trafficMbps = usageRows.map((row) => ({
        t: row.startTime,
        v: trafficMbpsForRow(row),
      }));

      const latencyMs = lossRows.map((row) => ({
        t: row.startTime,
        v: typeof row.latencyMs === "number" ? row.latencyMs : null,
      }));
      const lossPercent = lossRows.map((row) => ({
        t: row.startTime,
        v: typeof row.lossPercent === "number" ? row.lossPercent : null,
      }));
      const goodputKbps = lossRows.map((row) => ({
        t: row.startTime,
        v: typeof row.goodput === "number" ? row.goodput : null,
      }));

      /** Circuit outage events for carrier circuits mapped to this appliance + uplink (same window as charts). */
      const circuitRows = await prisma.circuit.findMany({
        where: {
          siteId,
          merakiInterface: { equals: uplink, mode: "insensitive" },
          OR: [{ merakiApplianceSerial: null }, { merakiApplianceSerial: "" }, { merakiApplianceSerial: serial }],
        },
        select: { id: true },
      });
      const circuitIds = circuitRows.map((c) => c.id);
      const now = new Date();
      const since = new Date(now.getTime() - timespanSec * 1000);
      let outageEvents: Array<{
        id: string;
        startedAt: string;
        endedAt: string | null;
        providerName: string;
        carrierCircuitId: string;
      }> = [];
      if (circuitIds.length > 0) {
        const evRows = await prisma.circuitOutageEvent.findMany({
          where: {
            circuitId: { in: circuitIds },
            startedAt: { lt: now },
            OR: [{ endedAt: null }, { endedAt: { gt: since } }],
          },
          orderBy: { startedAt: "asc" },
          include: {
            circuit: { select: { providerName: true, carrierCircuitId: true } },
          },
        });
        outageEvents = evRows.map((e) => ({
          id: e.id,
          startedAt: e.startedAt.toISOString(),
          endedAt: e.endedAt?.toISOString() ?? null,
          providerName: e.circuit.providerName,
          carrierCircuitId: e.circuit.carrierCircuitId,
        }));
      }

      return {
        serial,
        uplink,
        targetIp,
        timespanSeconds: timespanSec,
        resolutionSecondsUsage: resolutionUsage,
        resolutionSecondsLoss: resolutionLoss,
        trafficMbps,
        latencyMs,
        lossPercent,
        goodputKbps,
        outageEvents,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
      };
    },
  );

  /**
   * ThousandEyes enterprise test time series (latency / loss) for tests that appear in the site’s latest TE ingest
   * snapshot (HTTP + agent-to-server). Uses live TE API (`GET /v7/test-results/{testId}/…`), with a short in-memory
   * TTL cache to limit repeated pagination calls.
   */
  app.get(
    "/api/dashboard/sites/:siteId/thousandeyes-enterprise-test-metrics",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const q = req.query as Record<string, string | undefined>;
      const testId = q.testId != null ? String(q.testId).trim() : "";
      const timespanSec = Math.min(
        7 * 24 * 3600,
        Math.max(300, Number.parseInt(String(q.timespan ?? "43200"), 10) || 43200),
      );
      if (!testId) {
        return reply.code(400).send({ error: "testId is required" });
      }
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "thousandeyes" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap?.payload) {
        return reply.code(404).send({ error: "No ThousandEyes snapshot for this site" });
      }
      const allowed = collectAllowedEnterpriseTestsFromTePayload(snap.payload);
      const meta = allowed.get(testId);
      if (!meta) {
        return reply
          .code(403)
          .send({ error: "Test is not in the latest ThousandEyes snapshot for this location (run TE ingest)." });
      }
      const admin = await getAdminSettings();
      const teAid = admin.thousandEyesAid?.trim() || null;
      const cacheKey = teEnterpriseMetricsCacheKey(siteId, testId, timespanSec, teAid);
      const cached = getTeEnterpriseMetricsFromCache(cacheKey);
      if (cached) {
        void reply.header("X-TE-Enterprise-Metrics-Cache", "HIT");
        return cached;
      }
      const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
      if (!row) {
        return reply.code(503).send({ error: "ThousandEyes token not configured" });
      }
      const token = decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "ThousandEyes token");
      try {
        const series = await fetchEnterpriseTestLatencyLossSeries(token, testId, meta.type, timespanSec, {
          aid: teAid,
        });
        const body: TeEnterpriseMetricsCacheEntry = {
          testId,
          testName: meta.testName,
          testType: meta.type,
          timespanSeconds: timespanSec,
          teWindow: series.window,
          teResource: series.resource,
          latencyMs: series.latencyMs,
          lossPercent: series.lossPercent,
        };
        setTeEnterpriseMetricsCache(cacheKey, body);
        void reply.header("X-TE-Enterprise-Metrics-Cache", "MISS");
        return body;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        req.log.warn({ err: e, siteId, testId }, "thousandeyes enterprise test metrics failed");
        return reply.code(502).send({ error: msg.slice(0, 600) });
      }
    },
  );

  // ===========================================================================
  // DHCP scope health (per-VLAN usage + scope options) — sidecar API.
  // Pulls live from Meraki `/devices/{serial}/appliance/dhcp/subnets` and
  // `/networks/{id}/appliance/vlans`, joined per VLAN, with a 60s TTL cache.
  // ===========================================================================

  /** Normalize Meraki's free-form `dhcpHandling` string into the three labels the UI cards on. */
  function normalizeDhcpMode(raw: string | undefined): string {
    const v = (raw ?? "").toLowerCase();
    if (v.includes("relay")) {
      return "Relay DHCP";
    }
    if (v.includes("do not")) {
      return "Disabled";
    }
    return "Run DHCP server";
  }

  /**
   * Resolve the DNS server list Meraki will hand to DHCP clients on a VLAN.
   * The API field is overloaded across firmware versions:
   *   - Known preset keyword (`upstream_dns`, `google_dns`, `opendns`).
   *   - "custom" + a separate `dnsCustomNameservers` field (legacy).
   *   - The literal IP list, newline / comma / whitespace-separated (current).
   * We probe in that order and fall back to "upstream" only when nothing matched.
   */
  function resolveDhcpDns(vlan: MerakiApplianceVlanRow): string[] {
    const raw = (vlan.dnsNameservers ?? "").trim();
    const presetKey = raw.toLowerCase();

    if (presetKey === "google_dns" || presetKey === "google") {
      return ["8.8.8.8", "8.8.4.4"];
    }
    if (presetKey === "opendns") {
      return ["208.67.222.222", "208.67.220.220"];
    }
    if (presetKey === "upstream_dns" || presetKey === "upstream" || presetKey === "") {
      return ["upstream"];
    }

    // Legacy shape: dnsNameservers === "custom" + dnsCustomNameservers list.
    if (presetKey === "custom") {
      const cn = vlan.dnsCustomNameservers;
      const arr = Array.isArray(cn) ? cn : typeof cn === "string" ? cn.split(/[\s,]+/) : [];
      const list = arr.map((s) => String(s).trim()).filter(Boolean);
      return list.length > 0 ? list : ["—"];
    }

    // Current shape: dnsNameservers IS the literal IP list (one per line, or comma-separated).
    const ips = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return ips.length > 0 ? ips : ["upstream"];
  }

  /** Map a DHCP option code to its well-known short name for the UI pill. */
  function dhcpOptionLabel(code: number): string {
    switch (code) {
      case 15:
        return "domain-name";
      case 42:
        return "ntp-servers";
      case 43:
        return "vendor-specific";
      case 66:
        return "tftp-server";
      case 119:
        return "domain-search";
      case 121:
        return "classless-static-route";
      case 150:
        return "tftp-server-list";
      default:
        return `opt-${code}`;
    }
  }

  /**
   * Per-VLAN DHCP scope usage and configuration for the latest snapshot's MX appliance(s).
   * Aggregates `/devices/{serial}/appliance/dhcp/subnets` (usage) with `/networks/{id}/appliance/vlans`
   * (mode, lease, DNS, options) and returns a single payload the sidecar can render directly.
   */
  app.get(
    "/api/dashboard/sites/:siteId/dhcp-scope-health",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };

      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      if (!site.merakiNetworkId?.trim()) {
        return reply.code(400).send({ error: "Site has no Meraki network linked" });
      }

      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap?.payload) {
        return reply.code(404).send({ error: "No Meraki snapshot for this site" });
      }
      const applianceSerials = [...applianceSerialsFromMerakiSnapshotPayload(snap.payload)];
      if (applianceSerials.length === 0) {
        return reply
          .code(404)
          .send({ error: "Latest Meraki snapshot has no MX appliance to query DHCP scopes for." });
      }

      const cacheKey = dhcpScopeHealthCacheKey(siteId);
      const cached = getDhcpScopeHealthFromCache(cacheKey);
      if (cached) {
        void reply.header("X-DHCP-Scope-Health-Cache", "HIT");
        return cached;
      }

      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }
      const networkId = site.merakiNetworkId.trim();

      // Pull VLAN config once for the network, then walk every MX in the snapshot for
      // its per-subnet usage. We tolerate per-appliance subnet errors (firmware / model
      // variations can 404) and still return whatever we collected.
      const [vlansResult, ...subnetResults] = await Promise.allSettled([
        getNetworkApplianceVlans(apiKey, networkId),
        ...applianceSerials.map((s) => getApplianceDhcpSubnets(apiKey, s)),
      ]);

      const errors: string[] = [];
      const vlans: MerakiApplianceVlanRow[] =
        vlansResult.status === "fulfilled" ? vlansResult.value : [];
      if (vlansResult.status === "rejected") {
        const msg = vlansResult.reason instanceof Error ? vlansResult.reason.message : String(vlansResult.reason);
        errors.push(`vlans: ${msg.slice(0, 200)}`);
      }

      const usageByVlan = new Map<number, { used: number; capacity: number }>();
      subnetResults.forEach((res, idx) => {
        if (res.status === "rejected") {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          errors.push(`dhcp/subnets[${applianceSerials[idx]}]: ${msg.slice(0, 160)}`);
          return;
        }
        for (const row of res.value) {
          const used = Number.isFinite(row.usedCount) ? row.usedCount : 0;
          const free = Number.isFinite(row.freeCount) ? row.freeCount : 0;
          const capacity = used + free;
          // If a VLAN spans both MXes (warm-spare HA pair) usage can appear twice;
          // we sum so we don't underreport — the network is one logical scope.
          const prior = usageByVlan.get(row.vlanId);
          if (prior) {
            usageByVlan.set(row.vlanId, {
              used: prior.used + used,
              capacity: prior.capacity + capacity,
            });
          } else {
            usageByVlan.set(row.vlanId, { used, capacity });
          }
        }
      });

      const scopes: DhcpScopeEntry[] = vlans.map((v) => {
        const usage = usageByVlan.get(v.id) ?? { used: 0, capacity: 0 };
        const utilizationPct =
          usage.capacity > 0 ? Math.round((usage.used / usage.capacity) * 1000) / 10 : null;
        const fixed = isPayloadRecord(v.fixedIpAssignments)
          ? Object.keys(v.fixedIpAssignments).length
          : 0;
        const reserved = Array.isArray(v.reservedIpRanges) ? v.reservedIpRanges.length : 0;
        const dnsServers = resolveDhcpDns(v);
        const opts = Array.isArray(v.dhcpOptions) ? v.dhcpOptions : [];
        let domainName: string | null = null;
        const extraOptions: DhcpScopeEntry["extraOptions"] = [];
        for (const o of opts) {
          const code = Number(o.code);
          if (!Number.isFinite(code)) {
            continue;
          }
          if (code === 15 && typeof o.value === "string" && o.value.trim()) {
            domainName = o.value.trim();
            continue;
          }
          extraOptions.push({
            code,
            name: dhcpOptionLabel(code),
            value: typeof o.value === "string" ? o.value : String(o.value ?? ""),
          });
        }
        return {
          vlanId: v.id,
          name: typeof v.name === "string" && v.name.trim() ? v.name.trim() : `VLAN ${v.id}`,
          subnet: typeof v.subnet === "string" ? v.subnet : "—",
          applianceIp: typeof v.applianceIp === "string" ? v.applianceIp : "—",
          used: usage.used,
          capacity: usage.capacity,
          utilizationPct,
          mode: normalizeDhcpMode(v.dhcpHandling),
          leaseTime: typeof v.dhcpLeaseTime === "string" ? v.dhcpLeaseTime : null,
          dnsServers,
          domainName,
          fixedAssignments: fixed,
          reservedRanges: reserved,
          mandatoryDhcp: Boolean(v.mandatoryDhcp?.enabled),
          extraOptions,
        };
      });

      const totalUsed = scopes.reduce((acc, s) => acc + s.used, 0);
      const totalCapacity = scopes.reduce((acc, s) => acc + s.capacity, 0);
      const totalUtilizationPct =
        totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 1000) / 10 : null;

      const body: DhcpScopeHealthCacheEntry = {
        networkId,
        capturedAt: new Date().toISOString(),
        scopes,
        totalUsed,
        totalCapacity,
        totalUtilizationPct,
        ...(errors.length > 0 ? { note: errors.join(" | ").slice(0, 600) } : {}),
      };
      setDhcpScopeHealthCache(cacheKey, body);
      void reply.header("X-DHCP-Scope-Health-Cache", "MISS");
      return body;
    },
  );

  // ===========================================================================
  // Wireless health (per channel, per AP, per SSID) — sidecar API.
  // Aggregates radio settings + channel utilization + connection stats + usage
  // and client count, with a 60s TTL cache (this route can issue 15+ upstream
  // calls per site so the cache materially matters).
  // ===========================================================================

  function merakiRadioToBand(key: string): WirelessBand | null {
    if (key === "wifi0") return "2.4 GHz";
    if (key === "wifi1") return "5 GHz";
    if (key === "wifi2") return "6 GHz";
    return null;
  }

  /** Average a numeric field across a channel-utilization series, ignoring null/NaN. */
  function meanOrNull(values: Array<number | null | undefined>): number | null {
    let sum = 0;
    let n = 0;
    for (const v of values) {
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    if (n === 0) {
      return null;
    }
    return Math.round((sum / n) * 10) / 10;
  }

  function bandFromRadioSettings(
    settings: Awaited<ReturnType<typeof getDeviceWirelessRadioSettings>>,
    band: WirelessBand,
  ): { channel: number | null; channelWidthMhz: number | null; txPowerDbm: number | null } {
    const slot =
      band === "2.4 GHz" ? settings.twoFourGhzSettings :
      band === "5 GHz" ? settings.fiveGhzSettings :
      settings.sixGhzSettings;
    if (!slot) {
      return { channel: null, channelWidthMhz: null, txPowerDbm: null };
    }
    return {
      channel: typeof slot.channel === "number" ? slot.channel : null,
      channelWidthMhz: typeof slot.channelWidth === "number" ? slot.channelWidth : null,
      txPowerDbm: typeof slot.targetPower === "number" ? slot.targetPower : null,
    };
  }

  /** Extract an avg client RSSI in dBm from any of the response shapes Meraki has used over time. */
  function avgRssiFromConnectionStats(
    stats: Awaited<ReturnType<typeof getDeviceWirelessConnectionStats>>,
  ): number | null {
    const direct = stats?.signalQuality?.avgRssi;
    if (typeof direct === "number" && Number.isFinite(direct)) {
      return Math.round(direct * 10) / 10;
    }
    if (Array.isArray(stats?.byBand) && stats.byBand.length > 0) {
      const vals = stats.byBand
        .map((b) => (typeof b.avgRssi === "number" && Number.isFinite(b.avgRssi) ? b.avgRssi : null))
        .filter((v): v is number => v != null);
      if (vals.length > 0) {
        return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      }
    }
    return null;
  }

  app.get(
    "/api/dashboard/sites/:siteId/wireless-health",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const q = req.query as Record<string, string | undefined>;

      const timespanRaw = q.timespan != null ? Number.parseInt(String(q.timespan), 10) : 3600;
      const timespanSec =
        Number.isFinite(timespanRaw) && timespanRaw >= 300 && timespanRaw <= 86_400 ? timespanRaw : 3600;
      // Per Meraki API: `channelUtilizationHistory` only accepts 600/1200/3600/14400/86400,
      // while `clientCountHistory` accepts 300/600/.... Keep them separate so we don't 400.
      const channelUtilResolution = 600;
      const clientCountResolution = 300;

      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      if (!site.merakiNetworkId?.trim()) {
        return reply.code(400).send({ error: "Site has no Meraki network linked" });
      }

      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap?.payload) {
        return reply.code(404).send({ error: "No Meraki snapshot for this site" });
      }
      const wirelessDevices = wirelessDevicesFromMerakiSnapshotPayload(snap.payload);
      if (wirelessDevices.length === 0) {
        return reply
          .code(404)
          .send({ error: "Latest Meraki snapshot has no wireless devices (MR / CW / MX-W) to query." });
      }

      const cacheKey = wirelessHealthCacheKey(siteId, timespanSec);
      const cached = getWirelessHealthFromCache(cacheKey);
      if (cached) {
        void reply.header("X-Wireless-Health-Cache", "HIT");
        return cached;
      }

      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }
      const networkId = site.merakiNetworkId.trim();

      // Load configured model capacities once; missing models fall back to 40 (safe default).
      const capacityRows = await prisma.merakiModelClientCapacity.findMany();
      const capacityByModel = new Map<string, number>(
        capacityRows.map((r) => [r.model.toUpperCase(), r.capacity]),
      );
      const capacityFor = (model: string): number => capacityByModel.get(model.toUpperCase()) ?? 40;

      const errors: string[] = [];

      // ----- per-AP Meraki calls (parallel; per-AP errors are tolerated) -----
      const perAp = await Promise.all(
        wirelessDevices.map(async (dev) => {
          const [radioRes, utilRes, statsRes, clientRes] = await Promise.allSettled([
            getDeviceWirelessRadioSettings(apiKey, dev.serial),
            getNetworkChannelUtilizationHistory(apiKey, networkId, {
              timespan: timespanSec,
              resolution: channelUtilResolution,
              deviceSerial: dev.serial,
            }),
            getDeviceWirelessConnectionStats(apiKey, dev.serial, { timespan: timespanSec }),
            getNetworkWirelessClientCountHistory(apiKey, networkId, {
              timespan: timespanSec,
              resolution: clientCountResolution,
              deviceSerial: dev.serial,
            }),
          ]);

          if (radioRes.status === "rejected") {
            errors.push(`radio/${dev.serial}: ${String(radioRes.reason).slice(0, 120)}`);
          }
          if (utilRes.status === "rejected") {
            errors.push(`util/${dev.serial}: ${String(utilRes.reason).slice(0, 120)}`);
          }
          if (statsRes.status === "rejected") {
            errors.push(`stats/${dev.serial}: ${String(statsRes.reason).slice(0, 120)}`);
          }
          if (clientRes.status === "rejected") {
            errors.push(`clientCount/${dev.serial}: ${String(clientRes.reason).slice(0, 120)}`);
          }

          const radio =
            radioRes.status === "fulfilled"
              ? radioRes.value
              : ({ serial: dev.serial } as Awaited<ReturnType<typeof getDeviceWirelessRadioSettings>>);
          const util: MerakiNetworkChannelUtilizationRow[] =
            utilRes.status === "fulfilled" ? utilRes.value : [];
          const stats =
            statsRes.status === "fulfilled"
              ? statsRes.value
              : ({} as Awaited<ReturnType<typeof getDeviceWirelessConnectionStats>>);
          const counts = clientRes.status === "fulfilled" ? clientRes.value : [];

          // Average the channel-utilization series per band.
          const buildBand = (radioKey: "wifi0" | "wifi1" | "wifi2", band: WirelessBand): WirelessApBandEntry | null => {
            const rs = bandFromRadioSettings(radio, band);
            const totalSeries = util.map((u) => u[radioKey]?.utilization ?? null);
            const nonWifiSeries = util.map((u) => u[radioKey]?.utilizationNon80211 ?? null);
            const airtimePct = meanOrNull(totalSeries);
            const nonWifiPct = meanOrNull(nonWifiSeries);
            // Skip a band entirely if we have neither config nor utilization data —
            // avoids rendering empty "—" rows for radios the AP doesn't have (e.g. 6 GHz on MR36).
            if (rs.channel == null && airtimePct == null && nonWifiPct == null && rs.txPowerDbm == null) {
              return null;
            }
            return {
              band,
              channel: rs.channel,
              channelWidthMhz: rs.channelWidthMhz,
              airtimePct,
              nonWifiPct,
              txPowerDbm: rs.txPowerDbm,
            };
          };

          const bands: WirelessApBandEntry[] = [];
          for (const [k, b] of [
            ["wifi0", "2.4 GHz"],
            ["wifi1", "5 GHz"],
            ["wifi2", "6 GHz"],
          ] as const) {
            const entry = buildBand(k, b);
            if (entry) {
              bands.push(entry);
            }
          }

          // Average client count from the time series; round to nearest int.
          const clientAvg = meanOrNull(counts.map((c) => c.clientCount));
          const clientCount = clientAvg != null ? Math.round(clientAvg) : 0;

          const ap: WirelessApEntry = {
            name: dev.name,
            model: dev.model,
            serial: dev.serial,
            clientCount,
            clientCapacity: capacityFor(dev.model),
            avgClientRssiDbm: avgRssiFromConnectionStats(stats),
            bands,
          };
          return ap;
        }),
      );

      // ----- per-channel rollup across all APs -----
      const channelAgg = new Map<
        string,
        { band: WirelessBand; channel: number; apCount: number; airtimes: number[]; nonWifis: number[] }
      >();
      for (const ap of perAp) {
        for (const band of ap.bands) {
          if (band.channel == null) {
            continue;
          }
          const key = `${band.band}\x1e${band.channel}`;
          let bucket = channelAgg.get(key);
          if (!bucket) {
            bucket = { band: band.band, channel: band.channel, apCount: 0, airtimes: [], nonWifis: [] };
            channelAgg.set(key, bucket);
          }
          bucket.apCount += 1;
          if (band.airtimePct != null) {
            bucket.airtimes.push(band.airtimePct);
          }
          if (band.nonWifiPct != null) {
            bucket.nonWifis.push(band.nonWifiPct);
          }
        }
      }
      const channels: WirelessChannelEntry[] = [...channelAgg.values()]
        .map((c) => ({
          band: c.band,
          channel: c.channel,
          apsOnChannel: c.apCount,
          avgAirtimePct: meanOrNull(c.airtimes),
          avgNonWifiPct: meanOrNull(c.nonWifis),
        }))
        .sort((a, b) => (a.band === b.band ? a.channel - b.channel : a.band.localeCompare(b.band)));

      // ----- per-SSID config (single network-scoped call returns names + flags for all 15 slots) -----
      // The previous design iterated `wireless/usageHistory?ssid=N` and `clientCountHistory?ssid=N`
      // for slots 0..14, but Meraki requires `deviceSerial` on those endpoints (passing only `ssid`
      // returns 400 "Must specify a device or network client"), and the 15-slot fan-out burned
      // through the org's rate budget. We now fetch SSID configuration in one shot and surface
      // name / auth / IP mode / band selection. True per-SSID load shares require N_APs × N_SSIDs
      // calls and will land in a follow-up with proper rate-limit handling.
      let ssids: WirelessSsidEntry[] = [];
      try {
        const ssidConfigs = await getNetworkWirelessSsids(apiKey, networkId);
        ssids = ssidConfigs
          .filter((s) => s.enabled)
          .map((s) => ({
            number: s.number,
            name:
              typeof s.name === "string" && s.name.trim()
                ? s.name.trim()
                : `SSID ${s.number}`,
            enabled: true,
            authMode: typeof s.authMode === "string" ? s.authMode : null,
            wpaEncryptionMode:
              typeof s.wpaEncryptionMode === "string" ? s.wpaEncryptionMode : null,
            ipAssignmentMode:
              typeof s.ipAssignmentMode === "string" ? s.ipAssignmentMode : null,
            bandSelection: typeof s.bandSelection === "string" ? s.bandSelection : null,
            minBitrateMbps: typeof s.minBitrate === "number" ? s.minBitrate : null,
            visible: s.visible !== false,
          }))
          .sort((a, b) => a.number - b.number);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`ssids: ${msg.slice(0, 200)}`);
      }

      const body: WirelessHealthCacheEntry = {
        networkId,
        capturedAt: new Date().toISOString(),
        timespanSeconds: timespanSec,
        channels,
        aps: perAp,
        ssids,
        ...(errors.length > 0 ? { note: errors.join(" | ").slice(0, 800) } : {}),
      };
      setWirelessHealthCache(cacheKey, body);
      void reply.header("X-Wireless-Health-Cache", "MISS");
      return body;
    },
  );
}
