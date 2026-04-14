import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { decryptSecretForHttp } from "../lib/cryptoVault.js";
import { requireTagEditor } from "../lib/rbac.js";
import { getMerakiApiKey } from "../lib/merakiVault.js";
import {
  listOrganizations,
  listOrganizationInventoryDevices,
  getNetworkDevice,
  updateNetworkDevice,
} from "../lib/merakiClient.js";
import {
  listAccountGroups,
  listTags,
  createThousandEyesTag,
  assignThousandEyesTagToObjects,
} from "../lib/thousandEyesClient.js";

async function getTeToken(): Promise<string | null> {
  const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
  if (!row) {
    return null;
  }
  return decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "ThousandEyes token");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractTagIdFromCreateResponse(raw: Record<string, unknown>): string | null {
  const tag = isRecord(raw.tag) ? raw.tag : raw;
  return typeof tag.id === "string" ? tag.id : null;
}

export async function tagsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/dashboard/tags/te/account-groups",
    { preHandler: requireTagEditor },
    async (_req, reply) => {
      const token = await getTeToken();
      if (!token) {
        return reply.code(503).send({ error: "ThousandEyes token not configured" });
      }
      try {
        const accountGroups = await listAccountGroups(token);
        return { accountGroups };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg.slice(0, 800) });
      }
    },
  );

  app.get(
    "/api/dashboard/tags/te",
    { preHandler: requireTagEditor },
    async (req, reply) => {
      const token = await getTeToken();
      if (!token) {
        return reply.code(503).send({ error: "ThousandEyes token not configured" });
      }
      const q = req.query as { aid?: string; expand?: string };
      const expandAssignments = q.expand === "assignments";
      try {
        const tags = await listTags(token, { aid: q.aid, expandAssignments });
        return { tags };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg.slice(0, 800) });
      }
    },
  );

  app.get(
    "/api/dashboard/tags/meraki/organizations",
    { preHandler: requireTagEditor },
    async (_req, reply) => {
      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }
      try {
        const organizations = await listOrganizations(apiKey);
        return { organizations };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg.slice(0, 800) });
      }
    },
  );

  app.get(
    "/api/dashboard/tags/meraki/inventory",
    { preHandler: requireTagEditor },
    async (req, reply) => {
      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }
      const q = req.query as { organizationId?: string };
      if (!q.organizationId?.trim()) {
        return reply.code(400).send({ error: "organizationId required" });
      }
      try {
        const devicesRaw = await listOrganizationInventoryDevices(apiKey, q.organizationId.trim());
        const normalized = devicesRaw
          .filter((d) => d.serial && d.networkId)
          .map((d) => ({
            serial: String(d.serial),
            networkId: String(d.networkId),
            name: d.name != null ? String(d.name) : "",
            model: d.model != null ? String(d.model) : "",
            tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
          }));
        const tagIndex: Record<string, number> = {};
        for (const d of normalized) {
          for (const t of d.tags) {
            tagIndex[t] = (tagIndex[t] ?? 0) + 1;
          }
        }
        const uniqueTags = Object.entries(tagIndex)
          .map(([tag, deviceCount]) => ({ tag, deviceCount }))
          .sort((a, b) => a.tag.localeCompare(b.tag));
        const maxRows = 2000;
        return {
          devices: normalized.slice(0, maxRows),
          uniqueTags,
          total: normalized.length,
          truncated: normalized.length > maxRows,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg.slice(0, 800) });
      }
    },
  );

  /**
   * Adds one Dashboard tag string to each target device (merges with existing tags).
   * Meraki tags are plain strings; TE key/value is often mapped as `key:value`.
   */
  app.post(
    "/api/dashboard/tags/sync/te-to-meraki",
    { preHandler: requireTagEditor },
    async (req, reply) => {
      const body = req.body as {
        merakiTag?: string;
        targets?: Array<{ networkId: string; serial: string }>;
      };
      const merakiTag = String(body.merakiTag ?? "").trim();
      const targets = Array.isArray(body.targets) ? body.targets : [];
      if (!merakiTag) {
        return reply.code(400).send({ error: "merakiTag required" });
      }
      if (targets.length === 0) {
        return reply.code(400).send({ error: "targets required" });
      }
      if (targets.length > 80) {
        return reply.code(400).send({ error: "Max 80 devices per request" });
      }

      const apiKey = await getMerakiApiKey();
      if (!apiKey) {
        return reply.code(503).send({ error: "Meraki API key not configured" });
      }

      const results: Array<{ serial: string; networkId: string; ok: boolean; error?: string; skippedDuplicate?: boolean }> =
        [];
      for (const t of targets) {
        const serial = String(t.serial ?? "").trim();
        const networkId = String(t.networkId ?? "").trim();
        if (!serial || !networkId) {
          results.push({ serial, networkId, ok: false, error: "missing serial or networkId" });
          continue;
        }
        try {
          const dev = await getNetworkDevice(apiKey, networkId, serial);
          const existingRaw = dev.tags;
          const existing = Array.isArray(existingRaw) ? existingRaw.map(String) : [];
          const lower = new Set(existing.map((x) => x.toLowerCase()));
          if (lower.has(merakiTag.toLowerCase())) {
            results.push({ serial, networkId, ok: true, skippedDuplicate: true });
            continue;
          }
          const merged = [...existing, merakiTag];
          await updateNetworkDevice(apiKey, networkId, serial, { tags: merged });
          results.push({ serial, networkId, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ serial, networkId, ok: false, error: msg.slice(0, 220) });
        }
      }
      return { merakiTag, results };
    },
  );

  /**
   * Creates a TE static tag; optional assignments via POST /tags/{id}/assign.
   * Use `label` as `key:value` or set key/value explicitly.
   */
  app.post(
    "/api/dashboard/tags/sync/meraki-to-te",
    { preHandler: requireTagEditor },
    async (req, reply) => {
      const body = req.body as {
        aid?: string;
        label?: string;
        key?: string;
        value?: string;
        objectType?: string;
        assignments?: Array<{ id: string; type: string }>;
      };
      const objectType = String(body.objectType ?? "").trim();
      if (!objectType) {
        return reply.code(400).send({ error: "objectType required (e.g. v-agent, endpoint-agent, test)" });
      }

      let key = String(body.key ?? "").trim();
      let value = String(body.value ?? "").trim();
      const label = String(body.label ?? "").trim();
      if ((!key || !value) && label) {
        const idx = label.indexOf(":");
        if (idx > 0) {
          key = label.slice(0, idx).trim();
          value = label.slice(idx + 1).trim();
        } else {
          key = "meraki";
          value = label;
        }
      }
      if (!key || !value) {
        return reply.code(400).send({ error: "Provide key and value, or label (use key:value for pair)" });
      }

      const token = await getTeToken();
      if (!token) {
        return reply.code(503).send({ error: "ThousandEyes token not configured" });
      }

      const aid = body.aid?.trim();

      try {
        const raw = await createThousandEyesTag(
          token,
          {
            key,
            value,
            objectType,
            type: "static",
            description: "Created from Retail Dashboard (Meraki tag sync)",
          },
          aid,
        );
        const tagId = extractTagIdFromCreateResponse(raw);
        const assignments = Array.isArray(body.assignments) ? body.assignments : [];
        const cleanAssign = assignments
          .filter((a) => a && typeof a.id === "string" && typeof a.type === "string")
          .map((a) => ({ id: a.id.trim(), type: a.type.trim() }));
        let assignNote: string | null = null;
        if (tagId && cleanAssign.length > 0) {
          try {
            await assignThousandEyesTagToObjects(token, tagId, cleanAssign, aid);
          } catch (e) {
            assignNote = e instanceof Error ? e.message.slice(0, 400) : "assign failed";
          }
        }
        return { tagId, key, value, objectType, assignNote };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg.slice(0, 800) });
      }
    },
  );
}
