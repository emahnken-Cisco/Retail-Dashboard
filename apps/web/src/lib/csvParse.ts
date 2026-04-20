/**
 * RFC 4180 CSV parser.
 *
 * Supports:
 *  - Double-quote escaping (`""` inside a quoted field emits a literal quote).
 *  - Newlines inside quoted fields (the `notes` column on an exported inventory row can legally
 *    contain embedded `\n` — splitting on line breaks before honoring quotes produced phantom
 *    rows that failed validation with "all required fields missing").
 *  - Both LF and CRLF line terminators.
 *  - Leading BOM (UTF-8 `\uFEFF`) is stripped so the first header cell matches its key.
 *
 * Empty rows (whitespace-only) are dropped so a trailing newline does not produce a blank record.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\r") {
      if (src[i + 1] === "\n") {
        i++;
      }
      row.push(cur);
      cur = "";
      if (row.some((v) => v !== "")) {
        rows.push(row);
      }
      row = [];
    } else if (c === "\n") {
      row.push(cur);
      cur = "";
      if (row.some((v) => v !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      cur += c;
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    if (row.some((v) => v !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

/** Back-compat helper — parses a single logical CSV line (no embedded newlines). */
export function parseCsvLine(line: string): string[] {
  const rows = parseCsv(line);
  return rows[0] ?? [""];
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

const HEADER_MAP: Record<string, keyof ParsedCircuitImportRow> = {
  site_name: "siteName",
  site_id: "siteId",
  meraki_network_id: "merakiNetworkId",
  connectivity_kind: "connectivityKind",
  provider_name: "providerName",
  carrier_circuit_id: "carrierCircuitId",
  meraki_interface: "merakiInterface",
  speed_preset_id: "speedPresetId",
  custom_speed_label: "customSpeedLabel",
  is_synchronous: "isSynchronous",
  site_local_contact_slot: "siteLocalContactSlot",
  meraki_appliance_serial: "merakiApplianceSerial",
  notes: "notes",
  display_order: "displayOrder",
  local_contact_primary_name: "localContactPrimaryName",
  local_contact_primary_phone: "localContactPrimaryPhone",
  local_contact_primary_email: "localContactPrimaryEmail",
  local_contact_secondary_name: "localContactSecondaryName",
  local_contact_secondary_phone: "localContactSecondaryPhone",
  local_contact_secondary_email: "localContactSecondaryEmail",
};

export type CircuitImportApiRow = {
  idempotencyKey: string;
  siteId?: string;
  siteName?: string;
  merakiNetworkId?: string;
  connectivityKind: string;
  providerName: string;
  carrierCircuitId: string;
  merakiInterface: string;
  speedPresetId?: string;
  customSpeedLabel?: string;
  isSynchronous?: boolean;
  siteLocalContactSlot?: "PRIMARY" | "SECONDARY";
  merakiApplianceSerial?: string;
  notes?: string;
  displayOrder?: number;
  localContactPrimaryName?: string;
  localContactPrimaryPhone?: string;
  localContactPrimaryEmail?: string;
  localContactSecondaryName?: string;
  localContactSecondaryPhone?: string;
  localContactSecondaryEmail?: string;
};

export type ParsedCircuitImportRow = {
  siteName?: string;
  siteId?: string;
  merakiNetworkId?: string;
  connectivityKind?: string;
  providerName?: string;
  carrierCircuitId?: string;
  merakiInterface?: string;
  speedPresetId?: string;
  customSpeedLabel?: string;
  isSynchronous?: boolean;
  siteLocalContactSlot?: string | null;
  merakiApplianceSerial?: string;
  notes?: string;
  displayOrder?: number;
  localContactPrimaryName?: string;
  localContactPrimaryPhone?: string;
  localContactPrimaryEmail?: string;
  localContactSecondaryName?: string;
  localContactSecondaryPhone?: string;
  localContactSecondaryEmail?: string;
};

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const s = raw.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") {
    return true;
  }
  if (s === "false" || s === "0" || s === "no") {
    return false;
  }
  return undefined;
}

function parseIntMaybe(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Build API-ready circuit import rows with fresh idempotency keys. */
export function circuitRowsFromCsv(text: string): { rows: CircuitImportApiRow[]; errors: string[] } {
  const errors: string[] = [];
  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { rows: [], errors: ["CSV must include a header row and at least one data row."] };
  }
  const headerCells = grid[0].map(normHeader);
  const colIndex = new Map<string, number>();
  headerCells.forEach((h, i) => {
    colIndex.set(h, i);
  });

  const rows: CircuitImportApiRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line.some((c) => c.trim() !== "")) {
      continue;
    }
    const obj: ParsedCircuitImportRow = {};
    for (const [csvKey, prop] of Object.entries(HEADER_MAP)) {
      const idx = colIndex.get(csvKey);
      if (idx === undefined) {
        continue;
      }
      const cell = line[idx]?.trim() ?? "";
      if (prop === "isSynchronous") {
        obj.isSynchronous = parseBool(cell);
      } else if (prop === "displayOrder") {
        obj.displayOrder = parseIntMaybe(cell);
      } else if (prop === "siteLocalContactSlot") {
        if (!cell) {
          obj.siteLocalContactSlot = null;
        } else {
          const u = cell.toUpperCase();
          if (u === "PRIMARY" || u === "SECONDARY") {
            obj.siteLocalContactSlot = u;
          } else {
            errors.push(`Row ${r + 1}: site_local_contact_slot must be PRIMARY, SECONDARY, or empty`);
            obj.siteLocalContactSlot = undefined;
          }
        }
      } else {
        (obj as Record<string, unknown>)[prop] = cell === "" ? undefined : cell;
      }
    }
    const idempotencyKey = crypto.randomUUID();
    rows.push({
      idempotencyKey,
      siteId: obj.siteId,
      siteName: obj.siteName,
      merakiNetworkId: obj.merakiNetworkId,
      connectivityKind: obj.connectivityKind ?? "",
      providerName: obj.providerName ?? "",
      carrierCircuitId: obj.carrierCircuitId ?? "",
      merakiInterface: obj.merakiInterface ?? "",
      speedPresetId: obj.speedPresetId,
      customSpeedLabel: obj.customSpeedLabel,
      isSynchronous: obj.isSynchronous,
      siteLocalContactSlot:
        obj.siteLocalContactSlot === "PRIMARY" || obj.siteLocalContactSlot === "SECONDARY" ?
          obj.siteLocalContactSlot
        : undefined,
      merakiApplianceSerial: obj.merakiApplianceSerial,
      notes: obj.notes,
      displayOrder: obj.displayOrder,
      localContactPrimaryName: obj.localContactPrimaryName,
      localContactPrimaryPhone: obj.localContactPrimaryPhone,
      localContactPrimaryEmail: obj.localContactPrimaryEmail,
      localContactSecondaryName: obj.localContactSecondaryName,
      localContactSecondaryPhone: obj.localContactSecondaryPhone,
      localContactSecondaryEmail: obj.localContactSecondaryEmail,
    });
  }

  return { rows, errors };
}
