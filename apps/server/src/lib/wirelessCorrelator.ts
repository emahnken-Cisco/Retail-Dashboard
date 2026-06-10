/**
 * Pure helpers that correlate ThousandEyes Endpoint Agents to Meraki MR access
 * points using the device's wireless MAC. Used by the TE ingest job to attach
 * a "Wi-Fi" tone + matched AP to each endpoint row, and by the endpoint detail
 * route to surface the same data on demand.
 *
 * No I/O — the caller supplies already-fetched endpoint rows, the Meraki
 * wireless-client list for the site's network, and (optionally) a recent
 * event list for the matched client MAC. Keeping the math pure makes it easy
 * to unit test and to call from both the ingest job and the live endpoint
 * route without duplicating logic.
 *
 * Threshold defaults follow common Cisco Wi-Fi engineering guidance:
 *   * RSSI ≥ -65 dBm  → healthy
 *   * RSSI -65..-75   → borderline (amber)
 *   * RSSI < -75 dBm  → poor (red)
 * Both thresholds are configurable via the admin lenses (see admin.ts).
 *
 * `severityTone` is also nudged red on the presence of authentication /
 * DHCP / disassoc failures in the recent event window (broad signal — the
 * user opted in to "config_later" filtering, so any wireless event in
 * `BAD_EVENT_TYPES` counts).
 */

import type {
  MerakiNetworkEvent,
  MerakiNetworkWirelessClient,
  MerakiWirelessSsidStatusByDevice,
} from "./merakiClient.js";

/** Tone tokens render directly to the table pill + sidecar badge in the web app. */
export type WirelessCorrelationTone = "green" | "amber" | "red" | "neutral";

/**
 * Which join produced the matched MR — used by the UI to label the source
 * of the correlation. Helpful on Android / managed-MAC fleets where the
 * client MAC isn't available from TE and only BSSID matching can resolve
 * the AP.
 */
export type WirelessMatchMethod = "client-mac" | "bssid" | "none";

/**
 * Slim representation of a TE Endpoint Agent's current network interface
 * as the ingest job will hand it to the correlator. Fields are optional
 * because TE does not guarantee any of them on a given platform / build.
 */
export type EndpointWirelessSnapshot = {
  /** Unique TE Endpoint Agent id (UUID). */
  agentId: string;
  /** "Wireless" | "Wired" | "Unknown" — derived from `hardwareType`. */
  connectionType: "Wireless" | "Wired" | "Unknown";
  /** Wireless adapter MAC, lower-case with no separators if available. */
  wirelessMac: string | null;
  ssid: string | null;
  bssid: string | null;
  rssiDbm: number | null;
  signalQualityDb: number | null;
  channel: number | null;
  /** Channel width in MHz (20/40/80/160) when reported. */
  channelWidthMhz: number | null;
  /** "5 GHz" | "2.4 GHz" | "6 GHz" when bridgeable from `frequency`. */
  band: string | null;
};

/** Reasons surfaced in the UI when a tone is amber/red/neutral. */
export type WirelessCorrelationReason =
  | "wired"
  | "no-wireless-data"
  | "no-meraki-match"
  | "weak-rssi"
  | "poor-rssi"
  | "recent-failures"
  | "healthy";

export type WirelessEndpointCorrelation = {
  agentId: string;
  tone: WirelessCorrelationTone;
  reason: WirelessCorrelationReason;
  connectionType: EndpointWirelessSnapshot["connectionType"];
  ssid: string | null;
  bssid: string | null;
  rssiDbm: number | null;
  signalQualityDb: number | null;
  channel: number | null;
  channelWidthMhz: number | null;
  band: string | null;
  wirelessMac: string | null;
  /** Matched Meraki MR. Populated by either client-MAC or BSSID join. */
  matchedMeraki: {
    serial: string;
    name: string | null;
    ssid: string | null;
    /** Free-form last-seen ISO timestamp from Meraki when present. */
    lastSeen: string | null;
  } | null;
  /** Tells the UI which join produced `matchedMeraki` (drives the "via BSSID" note). */
  matchMethod: WirelessMatchMethod;
  /** Optional rollup of recent disassoc/auth-fail/dhcp-fail events. */
  recentFailureCount: number;
};

export type RssiThresholds = {
  amberDbm: number;
  redDbm: number;
};

export const DEFAULT_RSSI_THRESHOLDS: RssiThresholds = {
  amberDbm: -65,
  redDbm: -75,
};

/**
 * Wireless event categories the correlator treats as "bad" for tone bumping.
 * Picked from Meraki's documented event types for product=wireless. Anything
 * not in this set is informational (assoc/roam OK, etc.).
 */
const BAD_EVENT_TYPES = new Set<string>([
  "disassociation",
  "deauthentication",
  "wpa_auth_fail",
  "wpa_deauth",
  "8021x_eap_failure",
  "8021x_eap_timeout",
  "8021x_failure",
  "dhcp_no_lease",
  "dhcp_no_offers",
  "dns_failure",
  "association_failure",
]);

/** Strip MAC separators and lower-case for safe comparison. Returns "" if invalid. */
export function normalizeMac(input: unknown): string {
  if (typeof input !== "string") return "";
  const cleaned = input.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  // Real MACs are exactly 12 hex chars. Treat anything else as "no MAC" so
  // we never produce false positive correlations from partial strings.
  return cleaned.length === 12 ? cleaned : "";
}

/** Sanitize thresholds to a safe range so a bad lens value can never reverse the gradient. */
export function clampRssiThresholds(t: Partial<RssiThresholds> | null | undefined): RssiThresholds {
  const amber = numberOrDefault(t?.amberDbm, DEFAULT_RSSI_THRESHOLDS.amberDbm);
  const red = numberOrDefault(t?.redDbm, DEFAULT_RSSI_THRESHOLDS.redDbm);
  const clampedAmber = Math.max(-100, Math.min(-20, amber));
  const clampedRed = Math.max(-100, Math.min(-20, red));
  // Red must be ≤ amber (stricter); if reversed, swap.
  if (clampedRed > clampedAmber) {
    return { amberDbm: clampedRed, redDbm: clampedAmber };
  }
  return { amberDbm: clampedAmber, redDbm: clampedRed };
}

function numberOrDefault(v: unknown, dflt: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return dflt;
}

/**
 * Pull a slim wireless snapshot out of a raw TE endpoint agent payload
 * (the `networkInterfaceProfiles[]` array, in particular).
 *
 * Defensive — TE's schema is inconsistent across platforms:
 *   * Some builds put the interface MAC directly on the profile
 *     (`macAddress`); others nest it under `interfaceProfile.macAddress`.
 *   * RSSI may surface as `rssi` (Windows agents historically) or
 *     `signalStrength` (newer Android / macOS / Linux agents).
 *   * `hardwareType` is sometimes missing on Android — we then infer
 *     "wireless" from the presence of a populated `wirelessProfile.ssid`
 *     or `bssid`.
 * Returns partial / mostly-null records gracefully when TE omits fields.
 */
export function snapshotEndpointWireless(rawAgent: unknown): EndpointWirelessSnapshot {
  const fallback: EndpointWirelessSnapshot = {
    agentId: "",
    connectionType: "Unknown",
    wirelessMac: null,
    ssid: null,
    bssid: null,
    rssiDbm: null,
    signalQualityDb: null,
    channel: null,
    channelWidthMhz: null,
    band: null,
  };
  if (!isRecord(rawAgent)) return fallback;
  const agentId = String(rawAgent.id ?? "");
  const profiles = Array.isArray(rawAgent.networkInterfaceProfiles)
    ? rawAgent.networkInterfaceProfiles
    : [];

  // Pass 1: prefer an explicit wireless interface (hardwareType === "wireless").
  // Pass 2: fall back to "looks wireless" — a profile whose wirelessProfile
  //         carries a populated ssid/bssid. This catches Android / some Linux
  //         agent builds that omit hardwareType.
  // Pass 3: pick up a wired profile so we can label wired endpoints honestly.
  let chosenWireless: Record<string, unknown> | null = null;
  let chosenWired: Record<string, unknown> | null = null;
  for (const raw of profiles) {
    if (!isRecord(raw)) continue;
    const hw = String(raw.hardwareType ?? "").toLowerCase();
    if (hw === "wireless" && chosenWireless == null) {
      chosenWireless = raw;
    } else if (hw === "ethernet" && chosenWired == null) {
      chosenWired = raw;
    }
  }
  if (!chosenWireless) {
    for (const raw of profiles) {
      if (!isRecord(raw)) continue;
      const wp = isRecord(raw.wirelessProfile) ? raw.wirelessProfile : null;
      if (wp && (toStringIfPresent(wp.ssid) || toStringIfPresent(wp.bssid))) {
        chosenWireless = raw;
        break;
      }
    }
  }

  if (chosenWireless) {
    const wp = isRecord(chosenWireless.wirelessProfile) ? chosenWireless.wirelessProfile : null;
    const ifp = isRecord(chosenWireless.interfaceProfile) ? chosenWireless.interfaceProfile : null;
    // MAC: try every TE field name we've seen in the wild, top-level first
    // then nested. `normalizeMac` returns "" for partial / invalid strings
    // so the first thing that yields 12 hex chars wins.
    const mac =
      normalizeMac(chosenWireless.macAddress) ||
      normalizeMac(chosenWireless.physicalAddress) ||
      normalizeMac(chosenWireless.hardwareAddress) ||
      normalizeMac(chosenWireless.mac) ||
      (ifp ? normalizeMac(ifp.macAddress) : "") ||
      (ifp ? normalizeMac(ifp.physicalAddress) : "") ||
      (ifp ? normalizeMac(ifp.hardwareAddress) : "") ||
      (ifp ? normalizeMac(ifp.mac) : "");
    const freq = wp ? readFiniteNumber(wp.frequency ?? wp.frequencyMhz) : null;
    // RSSI: prefer the modern `signalStrength` field; fall back to legacy `rssi`.
    const rssi = wp
      ? readFiniteNumber(wp.signalStrength ?? wp.rssi ?? wp.signalStrengthDbm)
      : null;
    const snr = wp
      ? readFiniteNumber(wp.signalToNoiseRatio ?? wp.snr ?? wp.signalQuality)
      : null;
    return {
      agentId,
      connectionType: "Wireless",
      wirelessMac: mac ? mac : null,
      ssid: wp ? toStringIfPresent(wp.ssid) : null,
      bssid: wp && wp.bssid != null ? String(wp.bssid).toLowerCase() : null,
      rssiDbm: rssi,
      signalQualityDb: snr,
      channel: wp ? readFiniteNumber(wp.channel) : null,
      channelWidthMhz: wp ? readFiniteNumber(wp.channelWidth) : null,
      band: bandFromFrequency(freq),
    };
  }

  if (chosenWired) {
    return { ...fallback, agentId, connectionType: "Wired" };
  }

  return { ...fallback, agentId };
}

function toStringIfPresent(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function bandFromFrequency(freqMhz: number | null): string | null {
  if (freqMhz == null) return null;
  if (freqMhz >= 5925) return "6 GHz";
  if (freqMhz >= 4900) return "5 GHz";
  if (freqMhz >= 2400) return "2.4 GHz";
  return null;
}

function readFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compact AP entry used by the BSSID join (subset of MerakiInventoryDevice). */
export type WirelessApRef = {
  serial: string;
  name: string | null;
  ssid: string | null;
  band: string | null;
};

/**
 * Build an index `bssid → AP ref` from Meraki's org-wide
 * `/wireless/ssids/statuses/byDevice` listing.
 *
 * Each AP broadcasts multiple BSSIDs (one per SSID per band) — we surface
 * the SSID name + band per BSSID so the UI can show "matched to MR-LAB-AP-03
 * on Lan-Solo (5 GHz)" rather than just the serial. BSSIDs are normalized
 * lowercase with colons preserved so they round-trip with TE's report.
 */
export function indexBssidsByApRef(
  rows: ReadonlyArray<MerakiWirelessSsidStatusByDevice>,
): Map<string, WirelessApRef> {
  const out = new Map<string, WirelessApRef>();
  for (const row of rows) {
    const serial = typeof row.serial === "string" ? row.serial : null;
    if (!serial) continue;
    const apName = inferApNameFromRow(row);
    const bss = Array.isArray(row.basicServiceSets) ? row.basicServiceSets : [];
    for (const b of bss) {
      const bssidRaw = typeof b?.bssid === "string" ? b.bssid : "";
      const bssid = normalizeBssidForIndex(bssidRaw);
      if (!bssid) continue;
      // Prefer entries that are actively broadcasting / visible — those are
      // the ones a client would actually be associated to.
      const existing = out.get(bssid);
      const isLive = b.broadcasting !== false && b.visible !== false;
      if (!existing || isLive) {
        out.set(bssid, {
          serial,
          name: apName,
          ssid: typeof b.ssid?.name === "string" ? b.ssid.name : null,
          band: typeof b.radio?.band === "string" ? b.radio.band : null,
        });
      }
    }
  }
  return out;
}

function inferApNameFromRow(row: MerakiWirelessSsidStatusByDevice): string | null {
  // `byDevice` doesn't return the device name today (only serial + network),
  // so the caller patches in a name via `enrichApRefsFromMerakiDevices` once
  // it has the Meraki device list. Returning null here keeps the
  // index pure on the byDevice payload alone.
  void row;
  return null;
}

/**
 * Enrich a BSSID→AP index with friendly device names from the Meraki devices
 * snapshot (which already carries `serial → name`). Mutates and returns the
 * passed-in map for ergonomic chaining.
 */
export function enrichApRefsWithNames(
  index: Map<string, WirelessApRef>,
  serialToName: ReadonlyMap<string, string | null>,
): Map<string, WirelessApRef> {
  for (const [bssid, ref] of index) {
    const name = serialToName.get(ref.serial);
    if (name != null && ref.name == null) {
      index.set(bssid, { ...ref, name });
    }
  }
  return index;
}

/**
 * Normalize a BSSID for index comparisons: lower-case, colons preserved.
 * Returns "" if not a valid 12-hex-char MAC after stripping separators.
 */
export function normalizeBssidForIndex(input: unknown): string {
  if (typeof input !== "string") return "";
  const cleaned = input.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (cleaned.length !== 12) return "";
  return cleaned.match(/.{1,2}/g)!.join(":");
}

/**
 * Build an index `wirelessMac → MerakiNetworkWirelessClient` for O(1) joins
 * against many endpoint snapshots. Skips clients without a usable MAC.
 */
export function indexWirelessClientsByMac(
  clients: ReadonlyArray<MerakiNetworkWirelessClient>,
): Map<string, MerakiNetworkWirelessClient> {
  const m = new Map<string, MerakiNetworkWirelessClient>();
  for (const c of clients) {
    const mac = normalizeMac(c.mac);
    if (!mac) continue;
    // If duplicate MACs appear (rare — same device across two SSIDs in window),
    // keep the most-recently-seen entry so the matched MR reflects the latest
    // association.
    const existing = m.get(mac);
    if (!existing) {
      m.set(mac, c);
      continue;
    }
    if (compareIsoTimestamps(c.lastSeen, existing.lastSeen) > 0) {
      m.set(mac, c);
    }
  }
  return m;
}

function compareIsoTimestamps(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ? Date.parse(a) : NaN;
  const bv = b ? Date.parse(b) : NaN;
  if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
  if (Number.isNaN(av)) return -1;
  if (Number.isNaN(bv)) return 1;
  return av - bv;
}

/**
 * Compute the correlation tone + summary for a single endpoint snapshot.
 *
 * Matching strategy (in order):
 *   1. Client-MAC join against Meraki's wireless-client list (works on
 *      Windows / managed laptops where TE reports the agent's own MAC)
 *   2. BSSID join against Meraki's broadcasting-BSSID listing (works on
 *      Android / iOS / privacy-OS endpoints where TE only reports BSSID)
 *
 * `recentEvents` is optional — when omitted, the tone is driven by RSSI
 * alone (no event-derived bumps). Caller decides whether to spend the
 * additional Meraki API call to fetch events per matched client.
 */
export function correlateEndpoint(
  snapshot: EndpointWirelessSnapshot,
  clientsByMac: Map<string, MerakiNetworkWirelessClient>,
  thresholds: RssiThresholds = DEFAULT_RSSI_THRESHOLDS,
  recentEvents?: ReadonlyArray<MerakiNetworkEvent>,
  bssidIndex?: Map<string, WirelessApRef>,
): WirelessEndpointCorrelation {
  const base: WirelessEndpointCorrelation = {
    agentId: snapshot.agentId,
    tone: "neutral",
    reason: "no-wireless-data",
    connectionType: snapshot.connectionType,
    ssid: snapshot.ssid,
    bssid: snapshot.bssid,
    rssiDbm: snapshot.rssiDbm,
    signalQualityDb: snapshot.signalQualityDb,
    channel: snapshot.channel,
    channelWidthMhz: snapshot.channelWidthMhz,
    band: snapshot.band,
    wirelessMac: snapshot.wirelessMac,
    matchedMeraki: null,
    matchMethod: "none",
    recentFailureCount: 0,
  };

  if (snapshot.connectionType === "Wired") {
    return { ...base, reason: "wired" };
  }
  if (snapshot.connectionType !== "Wireless") {
    // Truly no wireless data (no SSID, no BSSID, no MAC).
    return base;
  }

  // ---- Attempt 1: client-MAC join -----------------------------------------
  let matched: WirelessEndpointCorrelation["matchedMeraki"] = null;
  let matchMethod: WirelessMatchMethod = "none";
  let resolvedSsid: string | null = snapshot.ssid ?? null;

  if (snapshot.wirelessMac) {
    const merakiClient = clientsByMac.get(snapshot.wirelessMac);
    if (merakiClient?.recentDeviceSerial) {
      matched = {
        serial: merakiClient.recentDeviceSerial,
        name: merakiClient.recentDeviceName ?? null,
        ssid: merakiClient.ssid ?? snapshot.ssid ?? null,
        lastSeen: merakiClient.lastSeen ?? null,
      };
      matchMethod = "client-mac";
      resolvedSsid = merakiClient.ssid ?? snapshot.ssid ?? null;
    }
  }

  // ---- Attempt 2: BSSID join (fallback) -----------------------------------
  if (!matched && snapshot.bssid && bssidIndex) {
    const bssidKey = normalizeBssidForIndex(snapshot.bssid);
    const apRef = bssidKey ? bssidIndex.get(bssidKey) : undefined;
    if (apRef) {
      matched = {
        serial: apRef.serial,
        name: apRef.name,
        ssid: apRef.ssid ?? snapshot.ssid ?? null,
        lastSeen: null,
      };
      matchMethod = "bssid";
      resolvedSsid = apRef.ssid ?? snapshot.ssid ?? null;
    }
  }

  if (!matched) {
    // If we had no MAC and no BSSID at all, surface "no Wi-Fi data" so the
    // user sees the right cause. Otherwise we did have Wi-Fi data but
    // nothing matched at this site.
    const reason: WirelessCorrelationReason =
      !snapshot.wirelessMac && !snapshot.bssid ? "no-wireless-data" : "no-meraki-match";
    return { ...base, reason };
  }

  let failureCount = 0;
  if (recentEvents && recentEvents.length > 0) {
    for (const ev of recentEvents) {
      const typ = String(ev.type ?? "").toLowerCase();
      if (BAD_EVENT_TYPES.has(typ)) failureCount += 1;
    }
  }

  let tone: WirelessCorrelationTone = "green";
  let reason: WirelessCorrelationReason = "healthy";

  const rssi = snapshot.rssiDbm;
  if (rssi != null && rssi < thresholds.redDbm) {
    tone = "red";
    reason = "poor-rssi";
  } else if (rssi != null && rssi < thresholds.amberDbm) {
    tone = "amber";
    reason = "weak-rssi";
  }
  // Failures escalate but never weaken an already-red tone.
  if (failureCount > 0 && tone !== "red") {
    tone = failureCount >= 3 ? "red" : "amber";
    reason = "recent-failures";
  }

  return {
    ...base,
    tone,
    reason,
    matchedMeraki: matched,
    matchMethod,
    recentFailureCount: failureCount,
    ssid: resolvedSsid,
  };
}
