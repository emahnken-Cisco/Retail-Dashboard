import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { merakiGeoFromSnapshotPayload } from "../lib/siteCoordinates.js";
import { replyIfPrismaSchemaMismatch } from "../lib/prismaErrors.js";
import { requireAuth } from "./auth.js";
import { requireSiteEditor } from "../lib/rbac.js";
import { discoverSiteSuggestions } from "../lib/siteDiscovery.js";

const siteBody = z.object({
  name: z.string().min(1),
  merakiNetworkId: z.string().nullable().optional(),
  thousandEyesTag: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  /** When true, lat/lng override Meraki-derived position for map and weather. */
  locationLatLngManual: z.boolean().optional(),
  city: z.string().max(120).nullable().optional(),
  displayOrder: z.number().int().optional(),
  expectWan2Healthy: z.boolean().optional(),
  expectCellularHealthy: z.boolean().optional(),
  localContactPrimaryName: z.string().max(200).nullable().optional(),
  localContactPrimaryPhone: z.string().max(80).nullable().optional(),
  localContactPrimaryEmail: z.union([z.string().email().max(200), z.literal(""), z.null()]).optional(),
  localContactSecondaryName: z.string().max(200).nullable().optional(),
  localContactSecondaryPhone: z.string().max(80).nullable().optional(),
  localContactSecondaryEmail: z.union([z.string().email().max(200), z.literal(""), z.null()]).optional(),
});

const bulkImportBody = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        merakiNetworkId: z.string().nullable().optional(),
        thousandEyesTag: z.string().nullable().optional(),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        city: z.string().max(120).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export async function sitesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/sites/discover",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const q = req.query as { includeAllEnterprise?: string };
      const includeAllEnterprise =
        q.includeAllEnterprise === "1" ||
        q.includeAllEnterprise === "true" ||
        q.includeAllEnterprise === "yes";
      try {
        const { suggestions, warnings } = await discoverSiteSuggestions({ includeAllEnterprise });
        return { suggestions, warnings };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Discovery failed";
        return reply.code(502).send({ error: msg });
      }
    },
  );

  app.post(
    "/api/sites/import-bulk",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const parsed = bulkImportBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const existing = await prisma.site.findMany({
        select: { merakiNetworkId: true, thousandEyesTag: true },
      });
      const netIds = new Set(existing.map((s) => s.merakiNetworkId).filter(Boolean) as string[]);
      const tags = new Set(existing.map((s) => s.thousandEyesTag).filter(Boolean) as string[]);

      let created = 0;
      let skipped = 0;
      for (const item of parsed.data.items) {
        const mid = item.merakiNetworkId ?? null;
        const tg = item.thousandEyesTag ?? null;
        if (mid && netIds.has(mid)) {
          skipped += 1;
          continue;
        }
        if (tg && tags.has(tg)) {
          skipped += 1;
          continue;
        }
        await prisma.site.create({
          data: {
            name: item.name,
            merakiNetworkId: mid,
            thousandEyesTag: tg,
            lat: item.lat ?? null,
            lng: item.lng ?? null,
            city: item.city?.trim() ? item.city.trim() : null,
            displayOrder: 0,
          expectWan2Healthy: false,
          expectCellularHealthy: false,
          locationLatLngManual: false,
        },
      });
        if (mid) {
          netIds.add(mid);
        }
        if (tg) {
          tags.add(tg);
        }
        created += 1;
      }
      return { ok: true, created, skipped };
    },
  );

  app.get(
    "/api/sites",
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const sites = await prisma.site.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
        const enriched = await Promise.all(
          sites.map(async (site) => {
            const meraki = await prisma.metricSnapshot.findFirst({
              where: { siteId: site.id, source: "meraki" },
              orderBy: { capturedAt: "desc" },
              select: { payload: true },
            });
            const geo = merakiGeoFromSnapshotPayload(meraki?.payload ?? null);
            return {
              ...site,
              merakiLat: geo?.lat ?? null,
              merakiLng: geo?.lng ?? null,
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

  app.post(
    "/api/sites",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const parsed = siteBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const site = await prisma.site.create({
        data: {
          name: parsed.data.name,
          merakiNetworkId: parsed.data.merakiNetworkId ?? null,
          thousandEyesTag: parsed.data.thousandEyesTag ?? null,
          lat: parsed.data.lat ?? null,
          lng: parsed.data.lng ?? null,
          city: parsed.data.city?.trim() ? parsed.data.city.trim() : null,
          displayOrder: parsed.data.displayOrder ?? 0,
          expectWan2Healthy: parsed.data.expectWan2Healthy ?? false,
          expectCellularHealthy: parsed.data.expectCellularHealthy ?? false,
          locationLatLngManual: parsed.data.locationLatLngManual ?? false,
        },
      });
      return site;
    },
  );

  app.patch(
    "/api/sites/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = siteBody.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const patchData = { ...parsed.data };
      if (patchData.city !== undefined) {
        patchData.city = patchData.city?.trim() ? patchData.city.trim() : null;
      }
      const trimOrNull = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
      if (patchData.localContactPrimaryName !== undefined) {
        patchData.localContactPrimaryName = trimOrNull(patchData.localContactPrimaryName);
      }
      if (patchData.localContactPrimaryPhone !== undefined) {
        patchData.localContactPrimaryPhone = trimOrNull(patchData.localContactPrimaryPhone);
      }
      if (patchData.localContactPrimaryEmail !== undefined) {
        patchData.localContactPrimaryEmail =
          patchData.localContactPrimaryEmail === "" || !patchData.localContactPrimaryEmail ?
            null
          : patchData.localContactPrimaryEmail.trim();
      }
      if (patchData.localContactSecondaryName !== undefined) {
        patchData.localContactSecondaryName = trimOrNull(patchData.localContactSecondaryName);
      }
      if (patchData.localContactSecondaryPhone !== undefined) {
        patchData.localContactSecondaryPhone = trimOrNull(patchData.localContactSecondaryPhone);
      }
      if (patchData.localContactSecondaryEmail !== undefined) {
        patchData.localContactSecondaryEmail =
          patchData.localContactSecondaryEmail === "" || !patchData.localContactSecondaryEmail ?
            null
          : patchData.localContactSecondaryEmail.trim();
      }
      try {
        const site = await prisma.site.update({
          where: { id },
          data: patchData,
        });
        return site;
      } catch (e) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: unknown }).code)
            : "";
        if (code === "P2025") {
          return reply.code(404).send({ error: "Not found" });
        }
        const msg = e instanceof Error ? e.message : "Update failed";
        req.log.warn({ err: e }, "site PATCH failed");
        const hint =
          /expectWan2Healthy|expectCellularHealthy|column/i.test(msg) && /does not exist|Unknown arg/i.test(msg)
            ? " Run database migrations (circuit expectation columns)."
            : "";
        return reply.code(500).send({ error: `${msg.slice(0, 400)}${hint}` });
      }
    },
  );

  app.delete(
    "/api/sites/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await prisma.site.delete({ where: { id } });
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
