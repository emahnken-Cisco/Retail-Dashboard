import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CircuitConnectivityKind } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "./auth.js";
import { requireSiteEditor } from "../lib/rbac.js";
import { resolvedLocalContactFromSite } from "../lib/resolvedCircuitContact.js";
import { CIRCUIT_EVENT_KIND_PUBLIC_IP_CHANGE } from "../lib/circuitEventRecorder.js";
import { isPrismaSchemaMismatchError } from "../lib/prismaErrors.js";

const connectivityEnum = z.enum(["DIA", "BROADBAND", "SATELLITE", "CELLULAR_4G_5G"]);

const speedPresetBody = z.object({
  label: z.string().min(1).max(200),
  downloadMbps: z.number().int().positive().max(1_000_000),
  uploadMbps: z.number().int().positive().max(1_000_000).nullable().optional(),
  kinds: z.array(connectivityEnum).optional(),
  sortOrder: z.number().int().optional(),
});

const siteLocalContactSlotEnum = z.enum(["PRIMARY", "SECONDARY"]);

const circuitBody = z.object({
  siteId: z.string().min(1),
  connectivityKind: connectivityEnum,
  providerName: z.string().min(1).max(200),
  carrierCircuitId: z.string().min(1).max(200),
  speedPresetId: z.string().nullable().optional(),
  customSpeedLabel: z.string().max(200).nullable().optional(),
  isSynchronous: z.boolean().optional(),
  /** Store-level contact (configure on Stores tab). */
  siteLocalContactSlot: z.union([siteLocalContactSlotEnum, z.null()]).optional(),
  merakiInterface: z.string().min(1).max(40),
  merakiApplianceSerial: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  displayOrder: z.number().int().optional(),
});

const siteSelectForCircuit = {
  id: true,
  name: true,
  merakiNetworkId: true,
  localContactPrimaryName: true,
  localContactPrimaryPhone: true,
  localContactPrimaryEmail: true,
  localContactSecondaryName: true,
  localContactSecondaryPhone: true,
  localContactSecondaryEmail: true,
} as const;

function jsonCircuitRow<T extends { site: Record<string, unknown>; siteLocalContactSlot: unknown }>(row: T) {
  const site = row.site as Parameters<typeof resolvedLocalContactFromSite>[0];
  const slot = row.siteLocalContactSlot as "PRIMARY" | "SECONDARY" | null;
  const resolved = resolvedLocalContactFromSite(site, slot);
  return {
    ...row,
    localContactName: resolved.localContactName,
    localContactPhone: resolved.localContactPhone,
    localContactEmail: resolved.localContactEmail,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Default speed presets when library is empty (Mbps; upload null = symmetric). */
const DEFAULT_SPEED_PRESETS: Array<{
  label: string;
  downloadMbps: number;
  uploadMbps: number | null;
  kinds: CircuitConnectivityKind[];
  sortOrder: number;
}> = [
  { label: "10/10 Mbps (DIA)", downloadMbps: 10, uploadMbps: null, kinds: ["DIA"], sortOrder: 10 },
  { label: "50/50 Mbps (DIA)", downloadMbps: 50, uploadMbps: null, kinds: ["DIA"], sortOrder: 20 },
  { label: "100/100 Mbps (DIA)", downloadMbps: 100, uploadMbps: null, kinds: ["DIA"], sortOrder: 30 },
  { label: "500/500 Mbps (DIA)", downloadMbps: 500, uploadMbps: null, kinds: ["DIA"], sortOrder: 40 },
  { label: "1 Gbps symmetric (DIA)", downloadMbps: 1000, uploadMbps: null, kinds: ["DIA"], sortOrder: 50 },
  { label: "940/880 Mbps (GPON-style)", downloadMbps: 940, uploadMbps: 880, kinds: ["BROADBAND", "DIA"], sortOrder: 60 },
  { label: "500/100 Mbps", downloadMbps: 500, uploadMbps: 100, kinds: ["BROADBAND"], sortOrder: 70 },
  { label: "300/50 Mbps", downloadMbps: 300, uploadMbps: 50, kinds: ["BROADBAND"], sortOrder: 80 },
  { label: "100/20 Mbps", downloadMbps: 100, uploadMbps: 20, kinds: ["BROADBAND"], sortOrder: 90 },
  { label: "50/10 Mbps", downloadMbps: 50, uploadMbps: 10, kinds: ["BROADBAND", "CELLULAR_4G_5G"], sortOrder: 100 },
  { label: "200/25 Mbps (satellite)", downloadMbps: 200, uploadMbps: 25, kinds: ["SATELLITE"], sortOrder: 110 },
  { label: "100/15 Mbps (satellite)", downloadMbps: 100, uploadMbps: 15, kinds: ["SATELLITE"], sortOrder: 120 },
  { label: "50/10 Mbps (satellite)", downloadMbps: 50, uploadMbps: 10, kinds: ["SATELLITE"], sortOrder: 130 },
  { label: "100/20 Mbps (cellular)", downloadMbps: 100, uploadMbps: 20, kinds: ["CELLULAR_4G_5G"], sortOrder: 140 },
  { label: "50/5 Mbps (cellular)", downloadMbps: 50, uploadMbps: 5, kinds: ["CELLULAR_4G_5G"], sortOrder: 150 },
];

export async function circuitsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/circuits/speed-presets",
    { preHandler: requireAuth },
    async (req, reply) => {
      const q = req.query as { kind?: string };
      const all = await prisma.circuitSpeedPreset.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
      if (!q.kind?.trim()) {
        return { presets: all };
      }
      const parsed = connectivityEnum.safeParse(q.kind.trim());
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid kind filter" });
      }
      const k = parsed.data;
      const presets = all.filter((p) => p.kinds.length === 0 || p.kinds.includes(k));
      return { presets };
    },
  );

  app.post(
    "/api/circuits/speed-presets",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const parsed = speedPresetBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const row = await prisma.circuitSpeedPreset.create({
        data: {
          label: parsed.data.label.trim(),
          downloadMbps: parsed.data.downloadMbps,
          uploadMbps: parsed.data.uploadMbps ?? null,
          kinds: parsed.data.kinds ?? [],
          sortOrder: parsed.data.sortOrder ?? 0,
        },
      });
      return row;
    },
  );

  app.post(
    "/api/circuits/speed-presets/seed-defaults",
    { preHandler: requireSiteEditor },
    async () => {
      const n = await prisma.circuitSpeedPreset.count();
      if (n > 0) {
        return { inserted: 0, message: "Speed library already has entries; delete items first if you want a clean seed." };
      }
      await prisma.circuitSpeedPreset.createMany({
        data: DEFAULT_SPEED_PRESETS.map((p) => ({
          label: p.label,
          downloadMbps: p.downloadMbps,
          uploadMbps: p.uploadMbps,
          kinds: p.kinds,
          sortOrder: p.sortOrder,
        })),
      });
      return { inserted: DEFAULT_SPEED_PRESETS.length };
    },
  );

  app.patch(
    "/api/circuits/speed-presets/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = speedPresetBody.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const d = parsed.data;
      try {
        const row = await prisma.circuitSpeedPreset.update({
          where: { id },
          data: {
            ...(d.label !== undefined ? { label: d.label.trim() } : {}),
            ...(d.downloadMbps !== undefined ? { downloadMbps: d.downloadMbps } : {}),
            ...(d.uploadMbps !== undefined ? { uploadMbps: d.uploadMbps } : {}),
            ...(d.kinds !== undefined ? { kinds: d.kinds } : {}),
            ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
          },
        });
        return row;
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );

  app.delete(
    "/api/circuits/speed-presets/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await prisma.circuitSpeedPreset.delete({ where: { id } });
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/api/circuits",
    { preHandler: requireAuth },
    async (req, reply) => {
      const q = req.query as { siteId?: string };
      const where = q.siteId?.trim() ? { siteId: q.siteId.trim() } : {};
      const rows = await prisma.circuit.findMany({
        where,
        include: { site: { select: siteSelectForCircuit }, speedPreset: true },
        orderBy: [{ site: { displayOrder: "asc" } }, { displayOrder: "asc" }, { providerName: "asc" }],
      });
      return { circuits: rows.map((r) => jsonCircuitRow(r)) };
    },
  );

  app.get(
    "/api/circuits/sites/:siteId/meraki-interfaces",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string };
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }
      const snap = await prisma.metricSnapshot.findFirst({
        where: { siteId, source: "meraki" },
        orderBy: { capturedAt: "desc" },
      });
      if (!snap) {
        return { capturedAt: null, suggestions: [] as Array<{ applianceSerial: string; interface: string; status: string }> };
      }
      const payload = snap.payload;
      const suggestions: Array<{ applianceSerial: string; interface: string; status: string }> = [];
      if (isRecord(payload) && isRecord(payload.wan) && Array.isArray(payload.wan.appliances)) {
        for (const a of payload.wan.appliances) {
          if (!isRecord(a)) {
            continue;
          }
          const serial = String(a.serial ?? "");
          const uplinks = Array.isArray(a.uplinks) ? a.uplinks : [];
          for (const u of uplinks) {
            if (!isRecord(u)) {
              continue;
            }
            suggestions.push({
              applianceSerial: serial,
              interface: String(u.interface ?? ""),
              status: String(u.status ?? "—"),
            });
          }
        }
      }
      return { capturedAt: snap.capturedAt.toISOString(), suggestions };
    },
  );

  app.get(
    "/api/circuits/reports/outage-summary",
    { preHandler: requireAuth },
    async (req, reply) => {
      const q = req.query as { days?: string };
      const days = Math.min(365, Math.max(1, parseInt(q.days ?? "30", 10) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const events = await prisma.circuitOutageEvent.findMany({
        where: { startedAt: { gte: since } },
        include: {
          circuit: {
            include: { site: { select: { id: true, name: true } } },
          },
        },
        orderBy: { startedAt: "desc" },
        take: 500,
      });

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last24hGroups = await prisma.circuitOutageEvent.groupBy({
        by: ["circuitId"],
        where: { startedAt: { gte: since24h } },
        _count: { _all: true },
      });
      const outageStartsLast24hByCircuit = new Map<string, number>(
        last24hGroups.map((g) => [g.circuitId, g._count._all]),
      );

      type Agg = { key: string; outageStarts: number; openEnded: number };
      const byProvider = new Map<string, Agg>();
      const byKind = new Map<string, Agg>();
      const byCircuit = new Map<string, Agg & { providerName: string; locationName: string; connectivityKind: string }>();

      for (const e of events) {
        const c = e.circuit;
        const p = c.providerName.trim() || "—";
        const k = c.connectivityKind;
        const ck = `${c.id}`;

        const bump = (m: Map<string, Agg>, key: string) => {
          const cur = m.get(key) ?? { key, outageStarts: 0, openEnded: 0 };
          cur.outageStarts += 1;
          if (e.endedAt == null) {
            cur.openEnded += 1;
          }
          m.set(key, cur);
        };

        bump(byProvider, p);
        bump(byKind, k);

        const ex =
          byCircuit.get(ck) ?? {
            key: ck,
            outageStarts: 0,
            openEnded: 0,
            providerName: c.providerName,
            locationName: c.site.name,
            connectivityKind: c.connectivityKind,
          };
        ex.outageStarts += 1;
        if (e.endedAt == null) {
          ex.openEnded += 1;
        }
        byCircuit.set(ck, ex);
      }

      const topCircuits = Array.from(byCircuit.values())
        .map((row) => ({
          ...row,
          circuitId: row.key,
          outageStartsLast24h: outageStartsLast24hByCircuit.get(row.key) ?? 0,
        }))
        .sort((a, b) => b.outageStarts - a.outageStarts)
        .slice(0, 25);

      const now = new Date();
      return {
        days,
        since: since.toISOString(),
        last24HoursSince: since24h.toISOString(),
        totals: {
          outageEvents: events.length,
          uniqueCircuitsAffected: byCircuit.size,
          outageStartsLast24h: last24hGroups.reduce((acc, g) => acc + g._count._all, 0),
        },
        byProvider: Array.from(byProvider.values()).sort((a, b) => b.outageStarts - a.outageStarts),
        byConnectivityKind: Array.from(byKind.values()).sort((a, b) => b.outageStarts - a.outageStarts),
        topCircuitsByOutageCount: topCircuits,
        recentEvents: events.slice(0, 50).map((e) => {
          const endMs = e.endedAt ? e.endedAt.getTime() : now.getTime();
          const durationSeconds = Math.max(0, Math.floor((endMs - e.startedAt.getTime()) / 1000));
          return {
            id: e.id,
            circuitId: e.circuitId,
            startedAt: e.startedAt.toISOString(),
            endedAt: e.endedAt?.toISOString() ?? null,
            durationSeconds,
            ongoing: e.endedAt == null,
            statusObserved: e.statusObserved,
            clearedToStatus: e.clearedToStatus,
            locationName: e.circuit.site.name,
            providerName: e.circuit.providerName,
            carrierCircuitId: e.circuit.carrierCircuitId,
            connectivityKind: e.circuit.connectivityKind,
            merakiInterface: e.circuit.merakiInterface,
          };
        }),
      };
    },
  );

  app.get(
    "/api/circuits/circuit-events",
    { preHandler: requireAuth },
    async (req, reply) => {
      const q = req.query as { days?: string; circuitId?: string; kind?: string };
      const days = Math.min(365, Math.max(1, parseInt(q.days ?? "30", 10) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const circuitId = q.circuitId?.trim() || undefined;
      const kind = q.kind?.trim() || undefined;

      const base = {
        days,
        since: since.toISOString(),
        kindFilter: kind ?? null,
        circuitIdFilter: circuitId ?? null,
      };

      try {
        const rows = await prisma.circuitEvent.findMany({
          where: {
            detectedAt: { gte: since },
            ...(circuitId ? { circuitId } : {}),
            ...(kind ? { kind } : {}),
          },
          orderBy: { detectedAt: "desc" },
          take: 500,
          include: {
            circuit: {
              select: {
                id: true,
                providerName: true,
                carrierCircuitId: true,
                merakiInterface: true,
                connectivityKind: true,
                site: { select: { id: true, name: true } },
              },
            },
            relatedOutageEvent: {
              select: { id: true, startedAt: true, endedAt: true },
            },
          },
        });

        return {
          ...base,
          events: rows.map((e) => ({
            id: e.id,
            detectedAt: e.detectedAt.toISOString(),
            kind: e.kind,
            kindLabel:
              e.kind === CIRCUIT_EVENT_KIND_PUBLIC_IP_CHANGE ? "Public IP change" : e.kind,
            previousValue: e.previousValue,
            newValue: e.newValue,
            note: e.note,
            source: e.source,
            circuitId: e.circuitId,
            locationName: e.circuit.site.name,
            providerName: e.circuit.providerName,
            carrierCircuitId: e.circuit.carrierCircuitId,
            merakiInterface: e.circuit.merakiInterface,
            connectivityKind: e.circuit.connectivityKind,
            relatedOutage:
              e.relatedOutageEvent ?
                {
                  id: e.relatedOutageEvent.id,
                  startedAt: e.relatedOutageEvent.startedAt.toISOString(),
                  endedAt: e.relatedOutageEvent.endedAt?.toISOString() ?? null,
                }
              : null,
          })),
        };
      } catch (err) {
        if (isPrismaSchemaMismatchError(err)) {
          req.log.warn({ err }, "circuit-events: schema not migrated; returning empty list");
          return {
            ...base,
            events: [],
            storageWarning:
              "Circuit events need the latest database migration (CircuitEvent table). From the project root run npm run db:migrate with DATABASE_URL set, then restart the server.",
          };
        }
        req.log.error({ err }, "circuit-events query failed");
        return reply.code(500).send({ error: "Failed to load circuit events" });
      }
    },
  );

  app.get(
    "/api/circuits/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = await prisma.circuit.findUnique({
        where: { id },
        include: { site: { select: siteSelectForCircuit }, speedPreset: true },
      });
      if (!row) {
        return reply.code(404).send({ error: "Not found" });
      }
      return jsonCircuitRow(row);
    },
  );

  app.post(
    "/api/circuits",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const parsed = circuitBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const b = parsed.data;
      const site = await prisma.site.findUnique({ where: { id: b.siteId } });
      if (!site) {
        return reply.code(400).send({ error: "Unknown siteId" });
      }
      if (b.speedPresetId) {
        const preset = await prisma.circuitSpeedPreset.findUnique({ where: { id: b.speedPresetId } });
        if (!preset) {
          return reply.code(400).send({ error: "Unknown speedPresetId" });
        }
      }
      const row = await prisma.circuit.create({
        data: {
          siteId: b.siteId,
          connectivityKind: b.connectivityKind,
          providerName: b.providerName.trim(),
          carrierCircuitId: b.carrierCircuitId.trim(),
          speedPresetId: b.speedPresetId ?? null,
          customSpeedLabel: b.customSpeedLabel?.trim() ? b.customSpeedLabel.trim() : null,
          isSynchronous: b.isSynchronous ?? true,
          siteLocalContactSlot: b.siteLocalContactSlot ?? null,
          merakiInterface: b.merakiInterface.trim(),
          merakiApplianceSerial: b.merakiApplianceSerial?.trim() ? b.merakiApplianceSerial.trim() : null,
          notes: b.notes?.trim() ? b.notes.trim() : null,
          displayOrder: b.displayOrder ?? 0,
        },
        include: { speedPreset: true, site: { select: siteSelectForCircuit } },
      });
      return jsonCircuitRow(row);
    },
  );

  app.patch(
    "/api/circuits/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = circuitBody.partial().omit({ siteId: true }).safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const b = parsed.data;
      if (b.speedPresetId) {
        const preset = await prisma.circuitSpeedPreset.findUnique({ where: { id: b.speedPresetId } });
        if (!preset) {
          return reply.code(400).send({ error: "Unknown speedPresetId" });
        }
      }
      const data: Record<string, unknown> = {};
      if (b.connectivityKind !== undefined) {
        data.connectivityKind = b.connectivityKind;
      }
      if (b.providerName !== undefined) {
        data.providerName = b.providerName.trim();
      }
      if (b.carrierCircuitId !== undefined) {
        data.carrierCircuitId = b.carrierCircuitId.trim();
      }
      if (b.speedPresetId !== undefined) {
        data.speedPresetId = b.speedPresetId;
      }
      if (b.customSpeedLabel !== undefined) {
        data.customSpeedLabel = b.customSpeedLabel?.trim() ? b.customSpeedLabel.trim() : null;
      }
      if (b.isSynchronous !== undefined) {
        data.isSynchronous = b.isSynchronous;
      }
      if (b.siteLocalContactSlot !== undefined) {
        data.siteLocalContactSlot = b.siteLocalContactSlot;
      }
      if (b.merakiInterface !== undefined) {
        data.merakiInterface = b.merakiInterface.trim();
      }
      if (b.merakiApplianceSerial !== undefined) {
        data.merakiApplianceSerial = b.merakiApplianceSerial?.trim() ? b.merakiApplianceSerial.trim() : null;
      }
      if (b.notes !== undefined) {
        data.notes = b.notes?.trim() ? b.notes.trim() : null;
      }
      if (b.displayOrder !== undefined) {
        data.displayOrder = b.displayOrder;
      }
      try {
        const row = await prisma.circuit.update({
          where: { id },
          data: data as never,
          include: { speedPreset: true, site: { select: siteSelectForCircuit } },
        });
        return jsonCircuitRow(row);
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );

  app.delete(
    "/api/circuits/:id",
    { preHandler: requireSiteEditor },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await prisma.circuit.delete({ where: { id } });
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
}
