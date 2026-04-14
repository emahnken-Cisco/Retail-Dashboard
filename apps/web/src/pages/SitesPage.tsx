import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { canEditStores } from "../lib/roles.js";

/** Meraki interface value for circuits not tied to WAN1/WAN2 from this page. */
const CIRCUIT_UNASSIGNED_WAN = "unassigned";

type Site = {
  id: string;
  name: string;
  merakiNetworkId: string | null;
  thousandEyesTag: string | null;
  lat: number | null;
  lng: number | null;
  /** From latest Meraki snapshot (GET /api/sites enrichment). */
  merakiLat?: number | null;
  merakiLng?: number | null;
  locationLatLngManual?: boolean;
  city: string | null;
  displayOrder: number;
  expectWan2Healthy?: boolean;
  expectCellularHealthy?: boolean;
  localContactPrimaryName?: string | null;
  localContactPrimaryPhone?: string | null;
  localContactPrimaryEmail?: string | null;
  localContactSecondaryName?: string | null;
  localContactSecondaryPhone?: string | null;
  localContactSecondaryEmail?: string | null;
};

function SiteMapLocationControls({
  site,
  onRefresh,
  canEdit,
}: {
  site: Site;
  onRefresh: () => void;
  canEdit: boolean;
}) {
  const [manual, setManual] = useState(Boolean(site.locationLatLngManual));
  const [latIn, setLatIn] = useState(site.lat == null ? "" : String(site.lat));
  const [lngIn, setLngIn] = useState(site.lng == null ? "" : String(site.lng));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setManual(Boolean(site.locationLatLngManual));
    setLatIn(site.lat == null ? "" : String(site.lat));
    setLngIn(site.lng == null ? "" : String(site.lng));
    setMsg("");
  }, [site.id, site.locationLatLngManual, site.lat, site.lng]);

  async function patchManual(next: boolean) {
    if (!canEdit) {
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await api<Site>(`/api/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({ locationLatLngManual: next }),
      });
      setManual(next);
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveCoords(e?: FormEvent) {
    e?.preventDefault();
    if (!canEdit) {
      return;
    }
    setBusy(true);
    setMsg("");
    const lt = latIn.trim();
    const lg = lngIn.trim();
    if (manual && (lt === "" || lg === "")) {
      setMsg("Manual override requires both latitude and longitude.");
      setBusy(false);
      return;
    }
    const lat = lt === "" ? null : Number(lt);
    const lng = lg === "" ? null : Number(lg);
    if ((lt !== "" && !Number.isFinite(lat)) || (lg !== "" && !Number.isFinite(lng))) {
      setMsg("Enter valid numbers for latitude and longitude.");
      setBusy(false);
      return;
    }
    if (lat != null && (lat < -90 || lat > 90)) {
      setMsg("Latitude must be between -90 and 90.");
      setBusy(false);
      return;
    }
    if (lng != null && (lng < -180 || lng > 180)) {
      setMsg("Longitude must be between -180 and 180.");
      setBusy(false);
      return;
    }
    try {
      await api<Site>(`/api/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({ lat, lng }),
      });
      setMsg("Saved.");
      onRefresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(ev) => void saveCoords(ev)}
      style={{
        marginTop: "0.65rem",
        padding: "0.6rem 0.65rem",
        border: "1px solid var(--surface2)",
        borderRadius: 8,
        maxWidth: 480,
      }}
    >
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", marginBottom: "0.35rem" }}>
        Map & weather position
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--muted)", margin: "0 0 0.45rem", lineHeight: 1.45 }}>
        <strong>Meraki</strong> (latest ingest):{" "}
        {site.merakiLat != null && site.merakiLng != null ?
          <code>
            {site.merakiLat.toFixed(5)}, {site.merakiLng.toFixed(5)}
          </code>
        : <span>—</span>}
        . Turn on manual coordinates to use your own lat/long for the dashboard map and site weather (more precise
        than appliance GPS when needed).
      </p>
      <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.82rem", marginBottom: "0.45rem" }}>
        <input
          type="checkbox"
          checked={manual}
          disabled={busy || !canEdit}
          onChange={(e) => void patchManual(e.target.checked)}
        />
        Use manual latitude / longitude (overrides Meraki for map & weather)
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.45rem" }}>
        <div>
          <label className="label" style={{ fontSize: "0.68rem" }}>
            Latitude
          </label>
          <input
            className="input"
            style={{ fontSize: "0.82rem" }}
            value={latIn}
            onChange={(e) => setLatIn(e.target.value)}
            disabled={busy || !canEdit}
          />
        </div>
        <div>
          <label className="label" style={{ fontSize: "0.68rem" }}>
            Longitude
          </label>
          <input
            className="input"
            style={{ fontSize: "0.82rem" }}
            value={lngIn}
            onChange={(e) => setLngIn(e.target.value)}
            disabled={busy || !canEdit}
          />
        </div>
      </div>
      <button
        type="submit"
        className="btn secondary"
        style={{ fontSize: "0.78rem" }}
        disabled={busy || !canEdit}
      >
        Save coordinates
      </button>
      {msg ? (
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.72rem",
            color: msg === "Saved." ? "var(--accent)" : "var(--danger)",
          }}
        >
          {msg}
        </p>
      ) : null}
    </form>
  );
}

type DiscoverySuggestion = {
  suggestionKey: string;
  name: string;
  merakiNetworkId: string | null;
  merakiOrganizationName: string | null;
  merakiNetworkName: string | null;
  thousandEyesAgentId: number;
  thousandEyesTag: string;
  lat: number | null;
  lng: number | null;
  matchScore: number;
  thousandEyes: Record<string, unknown>;
  meraki: {
    network: { networkId: string; networkName: string; organizationName: string } | null;
    lat: number | null;
    lng: number | null;
    devicesSample: unknown[];
  };
};

type LocationCircuitRow = {
  id: string;
  siteId: string;
  connectivityKind: string;
  providerName: string;
  carrierCircuitId: string;
  customSpeedLabel: string | null;
  merakiInterface: string;
  merakiApplianceSerial: string | null;
  siteLocalContactSlot?: "PRIMARY" | "SECONDARY" | null;
  localContactName: string | null;
  localContactPhone: string | null;
  localContactEmail: string | null;
  speedPreset: {
    label: string;
    downloadMbps: number;
    uploadMbps: number | null;
  } | null;
};

function circuitSpeedLabel(c: LocationCircuitRow): string {
  if (c.customSpeedLabel?.trim()) {
    return c.customSpeedLabel.trim();
  }
  if (c.speedPreset) {
    const p = c.speedPreset;
    if (p.uploadMbps == null) {
      return `${p.label} (${p.downloadMbps}/${p.downloadMbps} Mbps)`;
    }
    return `${p.label} (${p.downloadMbps}/${p.uploadMbps} Mbps)`;
  }
  return "—";
}

function kindShort(k: string): string {
  switch (k) {
    case "DIA":
      return "DIA";
    case "BROADBAND":
      return "BB";
    case "SATELLITE":
      return "Sat";
    case "CELLULAR_4G_5G":
      return "4G/5G";
    default:
      return k;
  }
}

function circuitIdOnWan(locationCircuits: LocationCircuitRow[], wan: "wan1" | "wan2"): string {
  const iface = wan.toLowerCase();
  const hit = locationCircuits.find((c) => c.merakiInterface.toLowerCase() === iface);
  return hit?.id ?? "";
}

export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState("");
  const [merakiNetworkId, setMerakiNetworkId] = useState("");
  const [thousandEyesTag, setThousandEyesTag] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [city, setCity] = useState("");
  const [expectWan2New, setExpectWan2New] = useState(false);
  const [expectCellularNew, setExpectCellularNew] = useState(false);

  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [discoverWarnings, setDiscoverWarnings] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [includeAllEnterprise, setIncludeAllEnterprise] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [circuitPatchError, setCircuitPatchError] = useState("");
  const [locationCircuits, setLocationCircuits] = useState<LocationCircuitRow[]>([]);
  const [wanBindingBusySiteId, setWanBindingBusySiteId] = useState<string | null>(null);
  const [wanBindingError, setWanBindingError] = useState("");

  const { user } = useAuth();
  const canEdit = canEditStores(user?.role);

  const load = useCallback(async () => {
    const [rSites, rCirc] = await Promise.all([
      api<{ sites: Site[] }>("/api/sites"),
      api<{ circuits: LocationCircuitRow[] }>("/api/circuits"),
    ]);
    setSites(rSites.sites);
    setLocationCircuits(rCirc.circuits ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadCircuitsOnly = useCallback(async () => {
    try {
      const r = await api<{ circuits: LocationCircuitRow[] }>("/api/circuits");
      setLocationCircuits(r.circuits ?? []);
    } catch {
      await load();
    }
  }, [load]);

  async function patchSiteLocalContacts(
    id: string,
    patch: Partial<{
      localContactPrimaryName: string | null;
      localContactPrimaryPhone: string | null;
      localContactPrimaryEmail: string | null;
      localContactSecondaryName: string | null;
      localContactSecondaryPhone: string | null;
      localContactSecondaryEmail: string | null;
    }>,
  ) {
    if (!canEdit) {
      return;
    }
    try {
      const updated = await api<Site>(`/api/sites/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSites((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      await reloadCircuitsOnly();
    } catch {
      await load();
    }
  }

  async function applyWanBinding(siteId: string, wan: "wan1" | "wan2", selectedCircuitId: string | null) {
    if (!canEdit) {
      return;
    }
    const iface = wan.toLowerCase();
    const siteCircuits = locationCircuits.filter((c) => c.siteId === siteId);
    const toClear = siteCircuits.filter((c) => c.merakiInterface.toLowerCase() === iface);
    setWanBindingError("");
    setWanBindingBusySiteId(siteId);
    try {
      await Promise.all(
        toClear.map((c) =>
          api(`/api/circuits/${encodeURIComponent(c.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ merakiInterface: CIRCUIT_UNASSIGNED_WAN }),
          }),
        ),
      );
      if (selectedCircuitId) {
        let serial: string | null = null;
        try {
          const hints = await api<{
            suggestions: Array<{ applianceSerial: string; interface: string; status: string }>;
          }>(`/api/circuits/sites/${encodeURIComponent(siteId)}/meraki-interfaces`);
          const m = hints.suggestions.find((x) => x.interface.toLowerCase() === iface);
          serial = m?.applianceSerial?.trim() || hints.suggestions[0]?.applianceSerial?.trim() || null;
        } catch {
          serial = null;
        }
        await api(`/api/circuits/${encodeURIComponent(selectedCircuitId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            merakiInterface: iface,
            merakiApplianceSerial: serial,
          }),
        });
      }
      await reloadCircuitsOnly();
    } catch (e) {
      setWanBindingError(e instanceof Error ? e.message : "Could not update WAN mapping");
      await reloadCircuitsOnly();
    } finally {
      setWanBindingBusySiteId(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) {
      return;
    }
    await api("/api/sites", {
      method: "POST",
      body: JSON.stringify({
        name,
        merakiNetworkId: merakiNetworkId || null,
        thousandEyesTag: thousandEyesTag || null,
        lat: lat === "" ? null : Number(lat),
        lng: lng === "" ? null : Number(lng),
        city: city.trim() || null,
        expectWan2Healthy: expectWan2New,
        expectCellularHealthy: expectCellularNew,
      }),
    });
    setName("");
    setMerakiNetworkId("");
    setThousandEyesTag("");
    setLat("");
    setLng("");
    setCity("");
    setExpectWan2New(false);
    setExpectCellularNew(false);
    await load();
  }

  async function remove(id: string) {
    if (!canEdit) {
      return;
    }
    if (!confirm("Delete this location?")) return;
    await api(`/api/sites/${id}`, { method: "DELETE" });
    await load();
  }

  async function patchCity(id: string, value: string) {
    if (!canEdit) {
      return;
    }
    try {
      const updated = await api<Site>(`/api/sites/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ city: value.trim() || null }),
      });
      setSites((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    } catch {
      await load();
    }
  }

  async function patchCircuitExpectation(
    id: string,
    key: "expectWan2Healthy" | "expectCellularHealthy",
    value: boolean,
  ) {
    if (!canEdit) {
      return;
    }
    setCircuitPatchError("");
    setSites((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
    try {
      const updated = await api<Site>(`/api/sites/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      setSites((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save circuit expectation";
      setCircuitPatchError(msg);
      await load();
    }
  }

  async function runDiscover() {
    setDiscoverError("");
    setImportMsg("");
    setDiscoverLoading(true);
    try {
      const q = includeAllEnterprise ? "?includeAllEnterprise=1" : "";
      const r = await api<{ suggestions: DiscoverySuggestion[]; warnings: string[] }>(
        `/api/sites/discover${q}`,
      );
      setSuggestions(r.suggestions);
      setDiscoverWarnings(r.warnings ?? []);
      setSelectedKeys(new Set(r.suggestions.map((s) => s.suggestionKey)));
    } catch (e) {
      setSuggestions([]);
      setDiscoverWarnings([]);
      setSelectedKeys(new Set());
      setDiscoverError(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscoverLoading(false);
    }
  }

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function importSelected() {
    setImportMsg("");
    const pick = suggestions.filter((s) => selectedKeys.has(s.suggestionKey));
    if (pick.length === 0) {
      setImportMsg("Select at least one row.");
      return;
    }
    const items = pick.map((s) => ({
      name: s.name,
      merakiNetworkId: s.merakiNetworkId,
      thousandEyesTag: s.thousandEyesTag,
      lat: s.lat,
      lng: s.lng,
    }));
    const r = await api<{ created: number; skipped: number }>("/api/sites/import-bulk", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    setImportMsg(`Imported ${r.created} location(s). Skipped ${r.skipped} duplicate(s).`);
    setSuggestions([]);
    setSelectedKeys(new Set());
    await load();
  }

  return (
    <div>
      <h1>Locations</h1>
      {!canEdit ? (
        <p className="card" style={{ marginTop: "0.75rem", padding: "0.65rem 1rem", fontSize: "0.9rem" }}>
          <strong>Read-only access.</strong> You can view locations and circuit summaries; ask an organization admin to
          change data or your role.
        </p>
      ) : null}
      <p style={{ color: "var(--muted)" }}>
        Link each retail location to a Meraki <strong>network ID</strong> and optional ThousandEyes tag
        (matched against enterprise agent names). Optional <strong>City</strong> (e.g. <code>Gilbert, AZ</code>) is
        used as the weather label on the location detail card; leave blank to use OpenWeather geocoding (extra API call).
        Set <strong>manual coordinates</strong> per location when you need a more precise map pin or weather point than
        Meraki device GPS. Turn on <strong>Expect WAN2</strong> and/or <strong>Expect cellular</strong> so the map shows{" "}
        <strong>orange</strong> when an expected circuit is not <code>active</code>/<code>ready</code> but the site
        still has traffic. WAN1 is always required whenever either expectation is on (secondary = WAN1+cellular only,
        tertiary = WAN1+WAN2+cellular). <strong>Local contacts</strong> (primary and optional secondary) are stored
        per location; circuits on the <Link to="/circuits">Circuits</Link> tab reference one of them or none. Use{" "}
        <strong>Circuit summary</strong> below each location to map carrier circuits to <strong>WAN1</strong> and{" "}
        <strong>WAN2</strong>.
      </p>

      {canEdit ? (
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Discover from ThousandEyes + Meraki</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
          Pulls <strong>enterprise</strong> agents that look Meraki-related (name/location contains “Meraki”, MX/MR
          patterns, etc.), matches them to Meraki networks by name, and enriches coordinates from MX/MR/CW devices
          when possible. Requires API keys on the <strong>API keys</strong> page.
        </p>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={includeAllEnterprise}
            onChange={(e) => setIncludeAllEnterprise(e.target.checked)}
          />
          Include <strong>all</strong> enterprise agents (not only Meraki-labeled heuristics)
        </label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={discoverLoading} onClick={() => void runDiscover()}>
            {discoverLoading ? "Discovering…" : "Run discovery"}
          </button>
          {suggestions.length > 0 ? (
            <button type="button" className="btn secondary" onClick={() => void importSelected()}>
              Import selected ({selectedKeys.size})
            </button>
          ) : null}
        </div>
        {discoverWarnings.map((w) => (
          <p key={w} style={{ color: "var(--warn)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            {w}
          </p>
        ))}
        {discoverError ? <p style={{ color: "var(--danger)", marginTop: "0.5rem" }}>{discoverError}</p> : null}
        {importMsg ? <p style={{ color: "var(--accent)", marginTop: "0.5rem" }}>{importMsg}</p> : null}

        {suggestions.length > 0 ? (
          <div style={{ marginTop: "1rem", overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--surface2)" }}>
                  <th style={{ padding: "0.35rem" }} />
                  <th style={{ padding: "0.35rem" }}>Location name</th>
                  <th style={{ padding: "0.35rem" }}>TE agent</th>
                  <th style={{ padding: "0.35rem" }}>Meraki network</th>
                  <th style={{ padding: "0.35rem" }}>Match</th>
                  <th style={{ padding: "0.35rem" }}>Lat / Lng</th>
                  <th style={{ padding: "0.35rem" }} />
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <Fragment key={s.suggestionKey}>
                    <tr style={{ borderBottom: "1px solid var(--surface2)" }}>
                      <td style={{ padding: "0.35rem" }}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(s.suggestionKey)}
                          onChange={() => toggleKey(s.suggestionKey)}
                        />
                      </td>
                      <td style={{ padding: "0.35rem" }}>{s.name}</td>
                      <td style={{ padding: "0.35rem" }}>
                        #{s.thousandEyesAgentId}
                        <br />
                        <span style={{ color: "var(--muted)" }}>{s.thousandEyesTag.slice(0, 48)}</span>
                      </td>
                      <td style={{ padding: "0.35rem" }}>
                        {s.merakiNetworkName ? (
                          <>
                            {s.merakiNetworkName}
                            <br />
                            <span style={{ color: "var(--muted)" }}>{s.merakiOrganizationName}</span>
                          </>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>No confident match</span>
                        )}
                      </td>
                      <td style={{ padding: "0.35rem" }}>{(s.matchScore * 100).toFixed(0)}%</td>
                      <td style={{ padding: "0.35rem" }}>
                        {s.lat != null && s.lng != null ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : "—"}
                      </td>
                      <td style={{ padding: "0.35rem" }}>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.45rem" }}
                          onClick={() =>
                            setExpandedKey((k) => (k === s.suggestionKey ? null : s.suggestionKey))
                          }
                        >
                          {expandedKey === s.suggestionKey ? "Hide" : "Raw"} API
                        </button>
                      </td>
                    </tr>
                    {expandedKey === s.suggestionKey ? (
                      <tr>
                        <td colSpan={7} style={{ padding: "0.5rem", background: "var(--bg)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                            <div>
                              <strong style={{ color: "var(--muted)" }}>ThousandEyes agent</strong>
                              <pre
                                style={{
                                  fontSize: "0.65rem",
                                  overflow: "auto",
                                  maxHeight: 220,
                                  margin: "0.35rem 0 0",
                                }}
                              >
                                {JSON.stringify(s.thousandEyes, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <strong style={{ color: "var(--muted)" }}>Meraki (matched network + devices)</strong>
                              <pre
                                style={{
                                  fontSize: "0.65rem",
                                  overflow: "auto",
                                  maxHeight: 220,
                                  margin: "0.35rem 0 0",
                                }}
                              >
                                {JSON.stringify(s.meraki, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      ) : null}

      {canEdit ? (
      <form className="card" onSubmit={add} style={{ marginTop: "1.5rem", maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Add location manually</h2>
        <div className="form-group">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="label">Meraki network ID</label>
          <input className="input" value={merakiNetworkId} onChange={(e) => setMerakiNetworkId(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">ThousandEyes tag (substring match on agent name)</label>
          <input className="input" value={thousandEyesTag} onChange={(e) => setThousandEyesTag(e.target.value)} />
        </div>
        <div className="form-group" style={{ display: "flex", gap: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label className="label">Latitude</label>
            <input className="input" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">Longitude</label>
            <input className="input" value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="label">City (weather label, optional)</label>
          <input
            className="input"
            placeholder="e.g. Gilbert, AZ"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.5rem" }}>
          <input
            type="checkbox"
            checked={expectWan2New}
            onChange={(e) => setExpectWan2New(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: "0.9rem" }}>
            <strong>Expect WAN2</strong> — require WAN1 and WAN2 both <code>active</code> or <code>ready</code>.
          </span>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={expectCellularNew}
            onChange={(e) => setExpectCellularNew(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: "0.9rem" }}>
            <strong>Expect cellular</strong> — require WAN1 and cellular both <code>active</code> or{" "}
            <code>ready</code> (use alone for cellular-as-secondary, or with WAN2 for tertiary backup).
          </span>
        </label>
        <button type="submit" className="btn">
          Add
        </button>
      </form>
      ) : null}

      <h2 style={{ marginTop: "2rem" }}>Existing</h2>
      {circuitPatchError ? (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          {circuitPatchError}
        </p>
      ) : null}
      {wanBindingError ? (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem", marginBottom: "0.75rem" }} role="alert">
          {wanBindingError}
        </p>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {sites.map((s) => (
          <li key={s.id} className="card" style={{ marginBottom: "0.75rem" }}>
            <strong>{s.name}</strong>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Meraki: {s.merakiNetworkId ?? "—"} · TE tag: {s.thousandEyesTag ?? "—"}
            </div>
            <SiteMapLocationControls site={s} onRefresh={() => void load()} canEdit={canEdit} />
            <div className="form-group" style={{ marginTop: "0.5rem", maxWidth: 360 }}>
              <label className="label" style={{ fontSize: "0.75rem" }}>
                City (weather label)
              </label>
              <input
                className="input"
                style={{ fontSize: "0.85rem" }}
                placeholder="e.g. Gilbert, AZ"
                defaultValue={s.city ?? ""}
                key={s.id + (s.city ?? "")}
                readOnly={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v.trim() === (s.city ?? "").trim()) {
                    return;
                  }
                  void patchCity(s.id, v);
                }}
              />
            </div>

            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                Location local contacts (shared by circuits)
              </div>
              <p style={{ fontSize: "0.72rem", color: "var(--muted)", margin: "0 0 0.5rem", lineHeight: 1.45 }}>
                Primary and secondary people or vendor numbers at this location. Circuits choose one on the Circuits
                tab.
              </p>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--muted)" }}>
                Primary
              </div>
              <div className="form-group" style={{ marginBottom: "0.35rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-pname`}>
                  Name
                </label>
                <input
                  id={`s-${s.id}-pname`}
                  className="input"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactPrimaryName ?? ""}
                  key={`${s.id}-pn-${s.localContactPrimaryName ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v === (s.localContactPrimaryName ?? "").trim() || (v == null && !s.localContactPrimaryName)) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactPrimaryName: v });
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: "0.35rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-pphone`}>
                  Phone
                </label>
                <input
                  id={`s-${s.id}-pphone`}
                  className="input"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactPrimaryPhone ?? ""}
                  key={`${s.id}-pp-${s.localContactPrimaryPhone ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v === (s.localContactPrimaryPhone ?? "").trim() || (v == null && !s.localContactPrimaryPhone)) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactPrimaryPhone: v });
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: "0.5rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-pemail`}>
                  Email
                </label>
                <input
                  id={`s-${s.id}-pemail`}
                  className="input"
                  type="email"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactPrimaryEmail ?? ""}
                  key={`${s.id}-pe-${s.localContactPrimaryEmail ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v === (s.localContactPrimaryEmail ?? "").trim() || (v == null && !s.localContactPrimaryEmail)) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactPrimaryEmail: v });
                  }}
                />
              </div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--muted)" }}>
                Secondary
              </div>
              <div className="form-group" style={{ marginBottom: "0.35rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-sname`}>
                  Name
                </label>
                <input
                  id={`s-${s.id}-sname`}
                  className="input"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactSecondaryName ?? ""}
                  key={`${s.id}-sn-${s.localContactSecondaryName ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (
                      v === (s.localContactSecondaryName ?? "").trim() ||
                      (v == null && !s.localContactSecondaryName)
                    ) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactSecondaryName: v });
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: "0.35rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-sphone`}>
                  Phone
                </label>
                <input
                  id={`s-${s.id}-sphone`}
                  className="input"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactSecondaryPhone ?? ""}
                  key={`${s.id}-sp-${s.localContactSecondaryPhone ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (
                      v === (s.localContactSecondaryPhone ?? "").trim() ||
                      (v == null && !s.localContactSecondaryPhone)
                    ) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactSecondaryPhone: v });
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: "0.35rem", maxWidth: 400 }}>
                <label className="label" style={{ fontSize: "0.7rem" }} htmlFor={`s-${s.id}-semail`}>
                  Email
                </label>
                <input
                  id={`s-${s.id}-semail`}
                  className="input"
                  type="email"
                  style={{ fontSize: "0.85rem" }}
                  readOnly={!canEdit}
                  defaultValue={s.localContactSecondaryEmail ?? ""}
                  key={`${s.id}-se-${s.localContactSecondaryEmail ?? ""}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (
                      v === (s.localContactSecondaryEmail ?? "").trim() ||
                      (v == null && !s.localContactSecondaryEmail)
                    ) {
                      return;
                    }
                    void patchSiteLocalContacts(s.id, { localContactSecondaryEmail: v });
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(s.expectWan2Healthy ?? false)}
                  disabled={!canEdit}
                  onChange={(e) => void patchCircuitExpectation(s.id, "expectWan2Healthy", e.target.checked)}
                />
                Expect WAN2 (WAN1 + WAN2 healthy)
              </label>
              <label
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(s.expectCellularHealthy ?? false)}
                  disabled={!canEdit}
                  onChange={(e) => void patchCircuitExpectation(s.id, "expectCellularHealthy", e.target.checked)}
                />
                Expect cellular (WAN1 + cellular healthy)
              </label>
            </div>

            {(() => {
              const siteC = locationCircuits.filter((c) => c.siteId === s.id);
              const busy = wanBindingBusySiteId === s.id;
              const wan1Val = circuitIdOnWan(siteC, "wan1");
              const wan2Val = circuitIdOnWan(siteC, "wan2");
              const circuitOptions = siteC.map((c) => ({
                id: c.id,
                label: `${c.providerName} — ${c.carrierCircuitId} (${circuitSpeedLabel(c)})`,
              }));
              return (
                <div
                  style={{
                    marginTop: "0.85rem",
                    paddingTop: "0.75rem",
                    borderTop: "1px solid var(--surface2)",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                    Circuit summary
                  </div>
                  {siteC.length === 0 ? (
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.5rem", lineHeight: 1.45 }}>
                      No circuits for this location yet. Add circuits on the{" "}
                      <Link to="/circuits">Circuits</Link> tab, then map them to WAN1/WAN2 here.
                    </p>
                  ) : (
                    <ul
                      style={{
                        margin: "0 0 0.65rem",
                        paddingLeft: "1.1rem",
                        fontSize: "0.78rem",
                        lineHeight: 1.45,
                        color: "var(--muted)",
                      }}
                    >
                      {siteC.map((c) => (
                        <li key={c.id} style={{ marginBottom: "0.25rem" }}>
                          <strong style={{ color: "var(--fg)" }}>{c.providerName}</strong> ·{" "}
                          {circuitSpeedLabel(c)} · <code>{c.merakiInterface}</code> · {kindShort(c.connectivityKind)}
                          {c.carrierCircuitId ? (
                            <span style={{ color: "var(--muted)" }}> · ID {c.carrierCircuitId}</span>
                          ) : null}
                          {c.siteLocalContactSlot ?
                            <span style={{ color: "var(--muted)" }}>
                              {" "}
                              · Contact ({c.siteLocalContactSlot === "PRIMARY" ? "primary" : "secondary"}):{" "}
                              {[c.localContactName, c.localContactPhone, c.localContactEmail].filter(Boolean).join(
                                " · ",
                              ) || "— (fill under Location local contacts above)"}
                            </span>
                          : [c.localContactName, c.localContactPhone, c.localContactEmail].filter(Boolean).length > 0 ? (
                            <span style={{ color: "var(--muted)" }}>
                              {" "}
                              · Contact:{" "}
                              {[c.localContactName, c.localContactPhone, c.localContactEmail].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div
                    style={{
                      display: "grid",
                      gap: "0.5rem",
                      maxWidth: 420,
                      marginBottom: "0.35rem",
                    }}
                  >
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: "0.75rem" }} htmlFor={`wan1-bind-${s.id}`}>
                        WAN 1 → circuit
                      </label>
                      <select
                        id={`wan1-bind-${s.id}`}
                        className="input"
                        style={{ fontSize: "0.85rem" }}
                        disabled={busy || siteC.length === 0 || !canEdit}
                        value={wan1Val}
                        onChange={(e) => {
                          const v = e.target.value;
                          void applyWanBinding(s.id, "wan1", v.trim() ? v : null);
                        }}
                      >
                        <option value="">— None —</option>
                        {circuitOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: "0.75rem" }} htmlFor={`wan2-bind-${s.id}`}>
                        WAN 2 → circuit
                      </label>
                      <select
                        id={`wan2-bind-${s.id}`}
                        className="input"
                        style={{ fontSize: "0.85rem" }}
                        disabled={busy || siteC.length === 0 || !canEdit}
                        value={wan2Val}
                        onChange={(e) => {
                          const v = e.target.value;
                          void applyWanBinding(s.id, "wan2", v.trim() ? v : null);
                        }}
                      >
                        <option value="">— None —</option>
                        {circuitOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.72rem", color: "var(--muted)", margin: 0, lineHeight: 1.45, maxWidth: "32rem" }}>
                    If the circuit you need is not in the list, add or import it on the{" "}
                    <Link to="/circuits">Circuits</Link> tab, then return here to associate WAN1/WAN2. Clearing a
                    selection sets that circuit&apos;s Meraki interface to <code>unassigned</code> (monitoring uses{" "}
                    <code>wan1</code> / <code>wan2</code>).
                  </p>
                </div>
              );
            })()}

            {canEdit ? (
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: "0.5rem" }}
              onClick={() => void remove(s.id)}
            >
              Delete
            </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
