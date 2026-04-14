import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encryptSecret, maskLast4 } from "../lib/cryptoVault.js";
import { requireOrgAdmin } from "../lib/rbac.js";
import { listOrganizations } from "../lib/merakiClient.js";
import { getAdminSettings } from "../lib/settings.js";
import { listEnterpriseAgents, teFetch } from "../lib/thousandEyesClient.js";
import { decryptSecret } from "../lib/cryptoVault.js";
import { tryConsumeOpenWeatherCall } from "../lib/openWeatherQuota.js";
import { tracedFetch } from "../lib/outboundTrace.js";

const providers = z.enum(["meraki", "thousandeyes", "google_maps", "openweathermap"]);

const putBody = z.object({
  secret: z.string().min(1),
});

export async function credentialsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/credentials",
    { preHandler: requireOrgAdmin },
    async () => {
      const rows = await prisma.credentialVault.findMany();
      return {
        credentials: rows.map((r) => ({
          provider: r.provider,
          last4: r.last4,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.put(
    "/api/credentials/:provider",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      const prov = providers.safeParse((req.params as { provider: string }).provider);
      if (!prov.success) {
        return reply.code(400).send({ error: "Invalid provider" });
      }
      const parsed = putBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body" });
      }
      const trimmed = parsed.data.secret.trim();
      if (!trimmed) {
        return reply.code(400).send({ error: "Secret is empty after trimming whitespace" });
      }
      const { ciphertext, iv, authTag } = encryptSecret(trimmed);
      const last4store = trimmed.length >= 4 ? trimmed.slice(-4) : null;

      await prisma.credentialVault.upsert({
        where: { provider: prov.data },
        create: {
          provider: prov.data,
          encryptedValue: ciphertext,
          iv,
          authTag,
          last4: last4store,
        },
        update: {
          encryptedValue: ciphertext,
          iv,
          authTag,
          last4: last4store,
        },
      });

      return { ok: true, provider: prov.data, masked: maskLast4(trimmed) };
    },
  );

  app.post(
    "/api/integrations/meraki/test",
    { preHandler: requireOrgAdmin },
    async (_req, reply) => {
      const row = await prisma.credentialVault.findUnique({ where: { provider: "meraki" } });
      if (!row) {
        return reply.code(400).send({ error: "Meraki API key not configured" });
      }
      try {
        const key = decryptSecret(row.encryptedValue, row.iv, row.authTag);
        const orgs = await listOrganizations(key);
        return { ok: true, organizationCount: orgs.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return reply.code(502).send({ ok: false, error: msg });
      }
    },
  );

  app.post(
    "/api/integrations/thousandeyes/test",
    { preHandler: requireOrgAdmin },
    async (_req, reply) => {
      const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
      if (!row) {
        return reply.code(400).send({ error: "ThousandEyes token not configured" });
      }
      try {
        const token = decryptSecret(row.encryptedValue, row.iv, row.authTag);
        const admin = await getAdminSettings();
        const teAid = admin.thousandEyesAid?.trim() || null;
        const agents = await listEnterpriseAgents(token, { aid: teAid });
        await teFetch<unknown>(token, "/tests");
        return { ok: true, enterpriseAgentCount: agents.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return reply.code(502).send({ ok: false, error: msg });
      }
    },
  );

  app.post(
    "/api/integrations/openweathermap/test",
    { preHandler: requireOrgAdmin },
    async (_req, reply) => {
      const row = await prisma.credentialVault.findUnique({ where: { provider: "openweathermap" } });
      if (!row) {
        return reply.code(400).send({ error: "OpenWeatherMap API key not configured" });
      }
      const apiKey = decryptSecret(row.encryptedValue, row.iv, row.authTag).trim();
      const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=45&lon=-93&appid=${encodeURIComponent(apiKey)}`;
      let weatherStatus = 0;
      let weatherMessage = "";
      const qWeather = await tryConsumeOpenWeatherCall();
      if (!qWeather.allowed) {
        weatherMessage = `Daily OpenWeather limit reached (${qWeather.usedAfter}/${qWeather.limit} UTC ${qWeather.dayUtc}).`;
      } else {
        try {
          const wRes = await tracedFetch(weatherUrl, undefined, {
            provider: "openweather",
            note: "Current Weather 2.5 (test)",
          });
          weatherStatus = wRes.status;
          const wText = await wRes.text();
          try {
            const wJson = JSON.parse(wText) as { message?: string; cod?: number | string };
            weatherMessage = wJson.message ?? wText.slice(0, 180);
          } catch {
            weatherMessage = wText.slice(0, 180);
          }
        } catch (e) {
          weatherMessage = e instanceof Error ? e.message : "weather request failed";
        }
      }

      const tileUrl = `https://tile.openweathermap.org/map/precipitation_new/2/1/1.png?appid=${encodeURIComponent(apiKey)}`;
      let tileStatus = 0;
      let tileOk = false;
      let tileMessage = "";
      const qTile = await tryConsumeOpenWeatherCall();
      if (!qTile.allowed) {
        tileMessage = `Daily OpenWeather limit reached (${qTile.usedAfter}/${qTile.limit} UTC ${qTile.dayUtc}).`;
      } else {
        try {
          const tRes = await tracedFetch(tileUrl, undefined, {
            provider: "openweather",
            note: "Map tile (test)",
          });
          tileStatus = tRes.status;
          const tCt = (tRes.headers.get("content-type") ?? "").toLowerCase();
          tileOk = tRes.ok && tCt.includes("image");
          if (!tileOk) {
            const tText = await tRes.text();
            try {
              const tJson = JSON.parse(tText) as { message?: string };
              tileMessage = tJson.message ?? tText.slice(0, 180);
            } catch {
              tileMessage = tText.slice(0, 180);
            }
          }
        } catch (e) {
          tileMessage = e instanceof Error ? e.message : "tile request failed";
        }
      }

      return {
        ok: weatherStatus === 200 && tileOk,
        currentWeatherHttp: weatherStatus,
        currentWeatherDetail: weatherMessage,
        mapTilesHttp: tileStatus,
        mapTilesOk: tileOk,
        mapTilesDetail: tileMessage,
      };
    },
  );
}
