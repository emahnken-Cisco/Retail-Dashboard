import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { CircuitBulkImport } from "../components/CircuitBulkImport.js";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { canEditStores } from "../lib/roles.js";

type Site = {
  id: string;
  name: string;
  localContactPrimaryName?: string | null;
  localContactPrimaryPhone?: string | null;
  localContactPrimaryEmail?: string | null;
  localContactSecondaryName?: string | null;
  localContactSecondaryPhone?: string | null;
  localContactSecondaryEmail?: string | null;
};

type ConnectivityKind = "DIA" | "BROADBAND" | "SATELLITE" | "CELLULAR_4G_5G";

const KIND_LABELS: Record<ConnectivityKind, string> = {
  DIA: "Direct Internet Access (DIA)",
  BROADBAND: "Broadband",
  SATELLITE: "Satellite (e.g. Starlink)",
  CELLULAR_4G_5G: "4G / 5G cellular",
};

type SpeedPreset = {
  id: string;
  label: string;
  downloadMbps: number;
  uploadMbps: number | null;
  kinds: ConnectivityKind[];
  sortOrder: number;
};

type CircuitRow = {
  id: string;
  siteId: string;
  connectivityKind: ConnectivityKind;
  providerName: string;
  carrierCircuitId: string;
  speedPresetId: string | null;
  customSpeedLabel: string | null;
  isSynchronous: boolean;
  siteLocalContactSlot: "PRIMARY" | "SECONDARY" | null;
  localContactName: string | null;
  localContactPhone: string | null;
  localContactEmail: string | null;
  merakiInterface: string;
  merakiApplianceSerial: string | null;
  notes: string | null;
  displayOrder: number;
  site: Site & { merakiNetworkId: string | null };
  speedPreset: SpeedPreset | null;
};

function contactLines(site: Site | undefined, slot: "PRIMARY" | "SECONDARY"): string[] {
  if (!site) {
    return [];
  }
  if (slot === "PRIMARY") {
    return [site.localContactPrimaryName, site.localContactPrimaryPhone, site.localContactPrimaryEmail].filter(
      (x): x is string => Boolean(x?.trim()),
    ) as string[];
  }
  return [site.localContactSecondaryName, site.localContactSecondaryPhone, site.localContactSecondaryEmail].filter(
    (x): x is string => Boolean(x?.trim()),
  ) as string[];
}

function speedLabel(c: CircuitRow): string {
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

export function CircuitsPage() {
  const { user } = useAuth();
  const canEdit = canEditStores(user?.role);

  const [sites, setSites] = useState<Site[]>([]);
  const [presets, setPresets] = useState<SpeedPreset[]>([]);
  const [circuits, setCircuits] = useState<CircuitRow[]>([]);
  const [filterSiteId, setFilterSiteId] = useState("");
  const [presetKindFilter, setPresetKindFilter] = useState<ConnectivityKind | "">("");
  const [err, setErr] = useState("");

  const [ifaceSuggestions, setIfaceSuggestions] = useState<
    Array<{ applianceSerial: string; interface: string; status: string }>
  >([]);
  const [ifaceCapturedAt, setIfaceCapturedAt] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState("");
  const [formKind, setFormKind] = useState<ConnectivityKind>("DIA");
  const [formProvider, setFormProvider] = useState("");
  const [formCircuitId, setFormCircuitId] = useState("");
  const [formPresetId, setFormPresetId] = useState("");
  const [formCustomSpeed, setFormCustomSpeed] = useState("");
  const [formSync, setFormSync] = useState(true);
  /** Empty = none; circuits share location contacts from the Locations tab. */
  const [formContactSlot, setFormContactSlot] = useState<"" | "PRIMARY" | "SECONDARY">("");
  const [formIface, setFormIface] = useState("wan1");
  const [formApplianceSerial, setFormApplianceSerial] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetDown, setNewPresetDown] = useState("");
  const [newPresetUp, setNewPresetUp] = useState("");
  const [newPresetKinds, setNewPresetKinds] = useState<ConnectivityKind[]>([]);

  const loadSites = useCallback(async () => {
    const r = await api<{ sites: Site[] }>("/api/sites");
    setSites(r.sites);
    if (r.sites.length > 0) {
      setFormSiteId((prev) => prev || r.sites[0].id);
    }
  }, []);

  const loadPresets = useCallback(async () => {
    const q = presetKindFilter ? `?kind=${encodeURIComponent(presetKindFilter)}` : "";
    const r = await api<{ presets: SpeedPreset[] }>(`/api/circuits/speed-presets${q}`);
    setPresets(r.presets ?? []);
  }, [presetKindFilter]);

  const loadCircuits = useCallback(async () => {
    const q = filterSiteId.trim() ? `?siteId=${encodeURIComponent(filterSiteId.trim())}` : "";
    const r = await api<{ circuits: CircuitRow[] }>(`/api/circuits${q}`);
    setCircuits(r.circuits ?? []);
  }, [filterSiteId]);

  const loadIfaceHints = useCallback(async (siteId: string) => {
    if (!siteId.trim()) {
      setIfaceSuggestions([]);
      setIfaceCapturedAt(null);
      return;
    }
    try {
      const r = await api<{
        capturedAt: string | null;
        suggestions: Array<{ applianceSerial: string; interface: string; status: string }>;
      }>(`/api/circuits/sites/${encodeURIComponent(siteId)}/meraki-interfaces`);
      setIfaceCapturedAt(r.capturedAt);
      setIfaceSuggestions(r.suggestions ?? []);
    } catch {
      setIfaceSuggestions([]);
      setIfaceCapturedAt(null);
    }
  }, []);

  useEffect(() => {
    void loadSites().catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, [loadSites]);

  useEffect(() => {
    setErr("");
    void loadPresets().catch((e) => setErr(e instanceof Error ? e.message : "Presets failed"));
  }, [loadPresets]);

  useEffect(() => {
    void loadCircuits().catch((e) => setErr(e instanceof Error ? e.message : "Circuits failed"));
  }, [loadCircuits]);

  useEffect(() => {
    void loadIfaceHints(formSiteId);
  }, [formSiteId, loadIfaceHints]);

  const presetsForFormKind = useMemo(() => {
    return presets.filter((p) => p.kinds.length === 0 || p.kinds.includes(formKind));
  }, [presets, formKind]);

  const formSite = useMemo(() => sites.find((s) => s.id === formSiteId), [sites, formSiteId]);

  async function seedPresets() {
    setErr("");
    try {
      const r = await api<{ inserted: number; message?: string }>("/api/circuits/speed-presets/seed-defaults", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (r.message) {
        setErr(r.message);
      }
      await loadPresets();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Seed failed");
    }
  }

  function resetForm() {
    setEditingId(null);
    setFormProvider("");
    setFormCircuitId("");
    setFormPresetId("");
    setFormCustomSpeed("");
    setFormSync(true);
    setFormContactSlot("");
    setFormIface("wan1");
    setFormApplianceSerial("");
    setFormNotes("");
  }

  function startEdit(c: CircuitRow) {
    setEditingId(c.id);
    setFormSiteId(c.siteId);
    setFormKind(c.connectivityKind);
    setFormProvider(c.providerName);
    setFormCircuitId(c.carrierCircuitId);
    setFormPresetId(c.speedPresetId ?? "");
    setFormCustomSpeed(c.customSpeedLabel ?? "");
    setFormSync(c.isSynchronous);
    setFormContactSlot(c.siteLocalContactSlot ?? "");
    setFormIface(c.merakiInterface);
    setFormApplianceSerial(c.merakiApplianceSerial ?? "");
    setFormNotes(c.notes ?? "");
  }

  async function submitCircuit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const body = {
      siteId: formSiteId,
      connectivityKind: formKind,
      providerName: formProvider.trim(),
      carrierCircuitId: formCircuitId.trim(),
      speedPresetId: formPresetId.trim() || null,
      customSpeedLabel: formCustomSpeed.trim() || null,
      isSynchronous: formSync,
      siteLocalContactSlot: formContactSlot || null,
      merakiInterface: formIface.trim(),
      merakiApplianceSerial: formApplianceSerial.trim() || null,
      notes: formNotes.trim() || null,
    };
    try {
      if (editingId) {
        const { siteId: _s, ...patchBody } = body;
        await api(`/api/circuits/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        });
      } else {
        await api("/api/circuits", { method: "POST", body: JSON.stringify(body) });
      }
      resetForm();
      await loadCircuits();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
    }
  }

  async function deleteCircuit(id: string) {
    if (!confirm("Delete this circuit?")) return;
    setErr("");
    try {
      await api(`/api/circuits/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editingId === id) {
        resetForm();
      }
      await loadCircuits();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Delete failed");
    }
  }

  async function addPreset(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const down = Number.parseInt(newPresetDown, 10);
    if (!newPresetLabel.trim() || !Number.isFinite(down) || down <= 0) {
      setErr("Preset label and valid download Mbps are required.");
      return;
    }
    const upRaw = newPresetUp.trim();
    let up: number | null = null;
    if (upRaw !== "") {
      const parsedUp = Number.parseInt(upRaw, 10);
      if (!Number.isFinite(parsedUp) || parsedUp <= 0) {
        setErr("Upload Mbps must be a positive integer or empty for symmetric.");
        return;
      }
      up = parsedUp;
    }
    try {
      await api("/api/circuits/speed-presets", {
        method: "POST",
        body: JSON.stringify({
          label: newPresetLabel.trim(),
          downloadMbps: down,
          uploadMbps: up,
          kinds: newPresetKinds.length > 0 ? newPresetKinds : [],
        }),
      });
      setNewPresetLabel("");
      setNewPresetDown("");
      setNewPresetUp("");
      setNewPresetKinds([]);
      await loadPresets();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Add preset failed");
    }
  }

  async function deletePreset(id: string) {
    if (!confirm("Remove this speed preset? Circuits using it will keep working but lose the preset link.")) return;
    setErr("");
    try {
      await api(`/api/circuits/speed-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadPresets();
      await loadCircuits();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Delete preset failed");
    }
  }

  const th: CSSProperties = {
    textAlign: "left",
    padding: "0.4rem 0.45rem",
    borderBottom: "1px solid var(--surface2)",
    color: "var(--muted)",
    fontSize: "0.75rem",
    fontWeight: 600,
  };
  const td: CSSProperties = { padding: "0.35rem 0.45rem", borderTop: "1px solid var(--surface2)", fontSize: "0.8rem" };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Circuit management</h1>
      {!canEdit ? (
        <p className="card" style={{ marginTop: "0.75rem", padding: "0.65rem 1rem", fontSize: "0.9rem" }}>
          <strong>Read-only access.</strong> You can view circuits and the speed library; ask an organization admin to
          change data or your role.
        </p>
      ) : null}
      <p style={{ color: "var(--muted)", maxWidth: "54rem", lineHeight: 1.55 }}>
        Define carrier circuits per location, map them to Meraki uplink interfaces (<code>wan1</code>,{" "}
        <code>wan2</code>, <code>cellular</code>, …), and maintain a reusable speed library by connectivity type.
        Local contacts are stored once per location on the <Link to="/sites">Locations</Link> tab (primary and optional
        secondary); each circuit can reference one of them or none. Outage statistics are on the{" "}
        <Link to="/reporting">Reporting</Link> tab.
      </p>

      {err ? (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem" }} role="alert">
          {err}
        </p>
      ) : null}

      {canEdit ? (
        <CircuitBulkImport exportSiteId={filterSiteId || undefined} onCommitted={() => void loadCircuits()} />
      ) : null}

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Circuits</h2>
        <label className="label" htmlFor="filter-site">
          Filter by location
        </label>
        <select
          id="filter-site"
          className="input"
          style={{ maxWidth: "20rem", marginBottom: "0.75rem" }}
          value={filterSiteId}
          onChange={(e) => setFilterSiteId(e.target.value)}
        >
          <option value="">All locations</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Location</th>
                <th style={th}>Type</th>
                <th style={th}>Provider</th>
                <th style={th}>Circuit ID</th>
                <th style={th}>Speed</th>
                <th style={th}>Sync</th>
                <th style={th}>Meraki</th>
                <th style={th}>Local contact</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {circuits.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...td, color: "var(--muted)" }}>
                    No circuits yet.
                  </td>
                </tr>
              ) : null}
              {circuits.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.site.name}</td>
                  <td style={td}>{KIND_LABELS[c.connectivityKind] ?? c.connectivityKind}</td>
                  <td style={td}>{c.providerName}</td>
                  <td style={td}>{c.carrierCircuitId}</td>
                  <td style={td}>{speedLabel(c)}</td>
                  <td style={td}>{c.isSynchronous ? "Yes" : "No"}</td>
                  <td style={td}>
                    <code>{c.merakiInterface}</code>
                    {c.merakiApplianceSerial ? (
                      <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                        {" "}
                        ({c.merakiApplianceSerial.slice(-8)})
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...td, fontSize: "0.75rem" }}>
                    {c.siteLocalContactSlot ?
                      <span style={{ color: "var(--muted)", fontSize: "0.65rem", display: "block", marginBottom: 2 }}>
                        {c.siteLocalContactSlot === "PRIMARY" ? "Primary" : "Secondary"} (location)
                      </span>
                    : null}
                    {[c.localContactName, c.localContactPhone, c.localContactEmail].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td style={td}>
                    {canEdit ? (
                      <>
                        <button type="button" className="btn secondary" onClick={() => startEdit(c)}>
                          Edit
                        </button>{" "}
                        <button type="button" className="btn secondary" onClick={() => void deleteCircuit(c.id)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gap: "1.25rem",
          marginTop: "1.25rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))",
        }}
      >
        {canEdit ? (
        <section className="card" style={{ minWidth: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{editingId ? "Edit circuit" : "Add circuit"}</h2>
          <form onSubmit={(e) => void submitCircuit(e)}>
            <label className="label" htmlFor="c-site">
              Location
            </label>
            <select
              id="c-site"
              className="input"
              required
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formSiteId}
              onChange={(e) => setFormSiteId(e.target.value)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="c-kind">
              Connectivity type
            </label>
            <select
              id="c-kind"
              className="input"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formKind}
              onChange={(e) => setFormKind(e.target.value as ConnectivityKind)}
            >
              {(Object.keys(KIND_LABELS) as ConnectivityKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="c-provider">
              Provider name
            </label>
            <input
              id="c-provider"
              className="input"
              required
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formProvider}
              onChange={(e) => setFormProvider(e.target.value)}
            />

            <label className="label" htmlFor="c-cid">
              Circuit ID (carrier)
            </label>
            <input
              id="c-cid"
              className="input"
              required
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formCircuitId}
              onChange={(e) => setFormCircuitId(e.target.value)}
            />

            <label className="label" htmlFor="c-preset">
              Speed preset
            </label>
            <select
              id="c-preset"
              className="input"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formPresetId}
              onChange={(e) => setFormPresetId(e.target.value)}
            >
              <option value="">— None —</option>
              {presetsForFormKind.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="c-custom-speed">
              Custom speed label (optional)
            </label>
            <input
              id="c-custom-speed"
              className="input"
              placeholder="e.g. 35/5 Mbps"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formCustomSpeed}
              onChange={(e) => setFormCustomSpeed(e.target.value)}
            />

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input type="checkbox" checked={formSync} onChange={(e) => setFormSync(e.target.checked)} />
              <span>Synchronous (symmetric) uplink</span>
            </label>

            <label className="label" htmlFor="c-iface">
              Meraki interface
            </label>
            <input
              id="c-iface"
              className="input"
              required
              placeholder="wan1, wan2, cellular"
              style={{ width: "100%", marginBottom: "0.35rem" }}
              value={formIface}
              onChange={(e) => setFormIface(e.target.value)}
            />
            {ifaceCapturedAt ? (
              <p style={{ fontSize: "0.72rem", color: "var(--muted)", margin: "0 0 0.5rem" }}>
                Latest Meraki snapshot: {new Date(ifaceCapturedAt).toLocaleString()}. Pick from:
              </p>
            ) : null}
            {ifaceSuggestions.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                {ifaceSuggestions.map((s, i) => (
                  <button
                    key={`${s.applianceSerial}-${s.interface}-${i}`}
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: "0.72rem", padding: "0.2rem 0.45rem" }}
                    onClick={() => {
                      setFormIface(s.interface);
                      setFormApplianceSerial(s.applianceSerial);
                    }}
                  >
                    {s.interface} @ {s.applianceSerial.slice(-6)} ({s.status})
                  </button>
                ))}
              </div>
            ) : null}

            <label className="label" htmlFor="c-serial">
              Appliance serial (optional)
            </label>
            <input
              id="c-serial"
              className="input"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              value={formApplianceSerial}
              onChange={(e) => setFormApplianceSerial(e.target.value)}
              placeholder="MX serial if multiple appliances"
            />

            <label className="label" htmlFor="c-contact-slot">
              Location local contact
            </label>
            <select
              id="c-contact-slot"
              className="input"
              style={{ width: "100%", marginBottom: "0.35rem" }}
              value={formContactSlot}
              onChange={(e) => setFormContactSlot((e.target.value || "") as "" | "PRIMARY" | "SECONDARY")}
            >
              <option value="">— None —</option>
              <option value="PRIMARY">Primary (shared at location)</option>
              <option value="SECONDARY">Secondary (shared at location)</option>
            </select>
            <p style={{ fontSize: "0.72rem", color: "var(--muted)", margin: "0 0 0.5rem", lineHeight: 1.45 }}>
              Names, phone, and email are stored once per location on the <Link to="/sites">Locations</Link> tab. Any
              circuit can use the same primary or secondary contact.
            </p>
            {formContactSlot ?
              <div
                style={{
                  fontSize: "0.75rem",
                  marginBottom: "0.5rem",
                  padding: "0.45rem 0.5rem",
                  borderRadius: 6,
                  border: "1px solid var(--surface2)",
                  background: "var(--surface2)",
                  lineHeight: 1.45,
                }}
              >
                <strong>{formContactSlot === "PRIMARY" ? "Primary" : "Secondary"}</strong>
                {contactLines(formSite, formContactSlot).length > 0 ?
                  <div style={{ marginTop: 4 }}>{contactLines(formSite, formContactSlot).join(" · ")}</div>
                : <div style={{ marginTop: 4, color: "var(--warn)" }}>Not filled in yet — edit this location under Locations.</div>}
              </div>
            : null}

            <label className="label" htmlFor="c-notes">
              Notes
            </label>
            <textarea
              id="c-notes"
              className="input"
              rows={2}
              style={{ width: "100%", marginBottom: "0.65rem" }}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="btn">
                {editingId ? "Save changes" : "Add circuit"}
              </button>
              {editingId ? (
                <button type="button" className="btn secondary" onClick={() => resetForm()}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        </section>
        ) : null}

        <section className="card" style={{ minWidth: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Speed library</h2>
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 0 }}>
            Filter presets by connectivity type. Empty &quot;kinds&quot; on a preset means it appears for all types.
          </p>
          <label className="label" htmlFor="preset-kind-filter">
            Filter list by kind
          </label>
          <select
            id="preset-kind-filter"
            className="input"
            style={{ width: "100%", marginBottom: "0.65rem" }}
            value={presetKindFilter}
            onChange={(e) => setPresetKindFilter((e.target.value || "") as ConnectivityKind | "")}
          >
            <option value="">All presets</option>
            {(Object.keys(KIND_LABELS) as ConnectivityKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {canEdit ? (
          <button type="button" className="btn secondary" style={{ marginBottom: "0.75rem" }} onClick={() => void seedPresets()}>
            Load common speeds (if library empty)
          </button>
          ) : null}
          {canEdit ? (
          <form onSubmit={(e) => void addPreset(e)} style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>Add preset</div>
            <input
              className="input"
              placeholder="Label"
              style={{ width: "100%", marginBottom: "0.35rem" }}
              value={newPresetLabel}
              onChange={(e) => setNewPresetLabel(e.target.value)}
            />
            <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
              <input
                className="input"
                placeholder="Down Mbps"
                style={{ flex: 1 }}
                inputMode="numeric"
                value={newPresetDown}
                onChange={(e) => setNewPresetDown(e.target.value)}
              />
              <input
                className="input"
                placeholder="Up Mbps (empty=sym)"
                style={{ flex: 1 }}
                inputMode="numeric"
                value={newPresetUp}
                onChange={(e) => setNewPresetUp(e.target.value)}
              />
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
              Limit to kinds (none = all types)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.35rem" }}>
              {(Object.keys(KIND_LABELS) as ConnectivityKind[]).map((k) => {
                const on = newPresetKinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    className={on ? "btn" : "btn secondary"}
                    style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem" }}
                    onClick={() =>
                      setNewPresetKinds((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                    }
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <button type="submit" className="btn secondary">
              Add speed
            </button>
          </form>
          ) : null}
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Label</th>
                  <th style={th}>Mbps</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {presets.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.label}</td>
                    <td style={td}>
                      {p.uploadMbps == null ? `${p.downloadMbps} ↓↑` : `${p.downloadMbps}↓ / ${p.uploadMbps}↑`}
                    </td>
                    <td style={td}>
                      {canEdit ? (
                        <button type="button" className="btn secondary" onClick={() => void deletePreset(p.id)}>
                          Remove
                        </button>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
