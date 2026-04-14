function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Same edge-device heuristic as Meraki ingest (MX/MR/MS/CW/MV/MG/VMX/Z*). */
function isMerakiEdgeModel(model: unknown): boolean {
  if (typeof model !== "string") {
    return false;
  }
  const u = model.toUpperCase();
  return (
    u.startsWith("MX") ||
    u.startsWith("MR") ||
    u.startsWith("MS") ||
    u.startsWith("CW") ||
    u.startsWith("MV") ||
    u.startsWith("MG") ||
    u.startsWith("VMX") ||
    /^Z\d/.test(u)
  );
}

/** Accepts finite numbers or numeric strings (some APIs emit coordinates as strings). */
export function readFiniteCoord(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Best-effort lat/lng from a Meraki dashboard snapshot payload (`devices[]` with lat/lng).
 * Prefers edge gear (MX/MR/…) with coordinates, then any device with coordinates.
 */
export function merakiGeoFromSnapshotPayload(payload: unknown): { lat: number; lng: number } | null {
  if (!isRecord(payload)) {
    return null;
  }
  const devices = payload.devices;
  if (!Array.isArray(devices)) {
    return null;
  }
  for (const d of devices) {
    if (!isRecord(d)) {
      continue;
    }
    if (!isMerakiEdgeModel(d.model)) {
      continue;
    }
    const lat = readFiniteCoord(d.lat);
    const lng = readFiniteCoord(d.lng);
    if (lat != null && lng != null) {
      return { lat, lng };
    }
  }
  for (const d of devices) {
    if (!isRecord(d)) {
      continue;
    }
    const lat = readFiniteCoord(d.lat);
    const lng = readFiniteCoord(d.lng);
    if (lat != null && lng != null) {
      return { lat, lng };
    }
  }
  return null;
}

export function resolveSiteCoordinates(input: {
  lat: number | null;
  lng: number | null;
  locationLatLngManual: boolean;
  merakiPayload: unknown | null;
}): { lat: number | null; lng: number | null } {
  if (input.locationLatLngManual) {
    return { lat: input.lat, lng: input.lng };
  }
  const m = merakiGeoFromSnapshotPayload(input.merakiPayload);
  if (m) {
    return m;
  }
  return { lat: input.lat, lng: input.lng };
}
