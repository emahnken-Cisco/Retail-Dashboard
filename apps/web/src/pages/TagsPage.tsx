import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

type TEAccountGroup = {
  aid?: string | number;
  accountGroupName?: string;
  isDefaultAccountGroup?: boolean;
};

type TETag = {
  id?: string;
  key?: string;
  value?: string;
  objectType?: string;
  type?: string;
  description?: string | null;
  color?: string;
  builtIn?: boolean;
  assignments?: Array<{ id?: string; type?: string }>;
};

type MerakiOrg = { id: string; name: string };

type MerakiInvDevice = {
  serial: string;
  networkId: string;
  name: string;
  model: string;
  tags: string[];
};

const TE_OBJECT_TYPES = [
  "v-agent",
  "endpoint-agent",
  "test",
  "endpoint-test",
  "dashboard",
] as const;

function deviceKey(d: MerakiInvDevice): string {
  return `${d.serial}\t${d.networkId}`;
}

export function TagsPage() {
  const [teErr, setTeErr] = useState("");
  const [merakiErr, setMerakiErr] = useState("");
  const [accountGroups, setAccountGroups] = useState<TEAccountGroup[]>([]);
  const [aid, setAid] = useState<string>("");
  const [teTags, setTeTags] = useState<TETag[]>([]);
  const [teLoading, setTeLoading] = useState(false);

  const [organizations, setOrganizations] = useState<MerakiOrg[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [invDevices, setInvDevices] = useState<MerakiInvDevice[]>([]);
  const [uniqueMerakiTags, setUniqueMerakiTags] = useState<Array<{ tag: string; deviceCount: number }>>([]);
  const [invMeta, setInvMeta] = useState<{ total: number; truncated: boolean } | null>(null);
  const [invLoading, setInvLoading] = useState(false);

  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [selectedTeTagId, setSelectedTeTagId] = useState<string | null>(null);
  const [merakiTagInput, setMerakiTagInput] = useState("");

  const [teKey, setTeKey] = useState("");
  const [teValue, setTeValue] = useState("");
  const [teLabel, setTeLabel] = useState("");
  const [teObjectType, setTeObjectType] = useState<string>(TE_OBJECT_TYPES[0]);
  const [assignJson, setAssignJson] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const loadAccountGroups = useCallback(async () => {
    setTeErr("");
    try {
      const r = await api<{ accountGroups: TEAccountGroup[] }>("/api/dashboard/tags/te/account-groups");
      setAccountGroups(r.accountGroups ?? []);
      const def = r.accountGroups?.find((g) => g.isDefaultAccountGroup);
      const firstAid = def?.aid ?? r.accountGroups?.[0]?.aid;
      if (firstAid != null) {
        setAid((prev) => (prev ? prev : String(firstAid)));
      }
    } catch (e) {
      setTeErr(e instanceof Error ? e.message : "Failed to load account groups");
    }
  }, []);

  const loadTeTags = useCallback(async () => {
    setTeLoading(true);
    setTeErr("");
    try {
      const q = new URLSearchParams();
      if (aid.trim()) {
        q.set("aid", aid.trim());
      }
      q.set("expand", "assignments");
      const r = await api<{ tags: TETag[] }>(`/api/dashboard/tags/te?${q.toString()}`);
      setTeTags(r.tags ?? []);
    } catch (e) {
      setTeErr(e instanceof Error ? e.message : "Failed to load TE tags");
      setTeTags([]);
    } finally {
      setTeLoading(false);
    }
  }, [aid]);

  const loadMerakiOrgs = useCallback(async () => {
    setMerakiErr("");
    try {
      const r = await api<{ organizations: MerakiOrg[] }>("/api/dashboard/tags/meraki/organizations");
      setOrganizations(r.organizations ?? []);
      if (r.organizations?.[0]?.id) {
        setOrgId((prev) => (prev ? prev : r.organizations![0].id));
      }
    } catch (e) {
      setMerakiErr(e instanceof Error ? e.message : "Failed to load Meraki orgs");
    }
  }, []);

  const loadInventory = useCallback(async () => {
    if (!orgId.trim()) {
      return;
    }
    setInvLoading(true);
    setMerakiErr("");
    setSelectedDevices(new Set());
    try {
      const q = new URLSearchParams({ organizationId: orgId.trim() });
      const r = await api<{
        devices: MerakiInvDevice[];
        uniqueTags: Array<{ tag: string; deviceCount: number }>;
        total: number;
        truncated: boolean;
      }>(`/api/dashboard/tags/meraki/inventory?${q.toString()}`);
      setInvDevices(r.devices ?? []);
      setUniqueMerakiTags(r.uniqueTags ?? []);
      setInvMeta({ total: r.total, truncated: Boolean(r.truncated) });
    } catch (e) {
      setMerakiErr(e instanceof Error ? e.message : "Failed to load inventory");
      setInvDevices([]);
      setUniqueMerakiTags([]);
      setInvMeta(null);
    } finally {
      setInvLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadAccountGroups();
    void loadMerakiOrgs();
  }, [loadAccountGroups, loadMerakiOrgs]);

  const selectedTeTag = useMemo(
    () => teTags.find((t) => t.id === selectedTeTagId) ?? null,
    [teTags, selectedTeTagId],
  );

  useEffect(() => {
    if (selectedTeTag?.key != null && selectedTeTag?.value != null) {
      setMerakiTagInput(`${selectedTeTag.key}:${selectedTeTag.value}`);
    }
  }, [selectedTeTag]);

  function toggleDevice(d: MerakiInvDevice) {
    const k = deviceKey(d);
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedDevices(new Set(invDevices.map(deviceKey)));
  }

  function clearSelection() {
    setSelectedDevices(new Set());
  }

  async function applyTeToMeraki() {
    setSyncMsg("");
    const tag = merakiTagInput.trim();
    if (!tag) {
      setSyncMsg("Enter a Meraki tag string (e.g. store:retail-01).");
      return;
    }
    const targets: Array<{ networkId: string; serial: string }> = [];
    for (const k of selectedDevices) {
      const [serial, networkId] = k.split("\t");
      if (serial && networkId) {
        targets.push({ serial, networkId });
      }
    }
    if (targets.length === 0) {
      setSyncMsg("Select at least one Meraki device in the table.");
      return;
    }
    setSyncBusy(true);
    try {
      const r = await api<{
        merakiTag: string;
        results: Array<{ serial: string; networkId: string; ok: boolean; error?: string; skippedDuplicate?: boolean }>;
      }>("/api/dashboard/tags/sync/te-to-meraki", {
        method: "POST",
        body: JSON.stringify({ merakiTag: tag, targets }),
      });
      const ok = r.results.filter((x) => x.ok).length;
      const fail = r.results.filter((x) => !x.ok).length;
      setSyncMsg(`Applied “${r.merakiTag}”: ${ok} ok, ${fail} failed. Reload inventory to verify.`);
      void loadInventory();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  }

  async function createTeFromMeraki() {
    setSyncMsg("");
    setSyncBusy(true);
    try {
      let assignments: Array<{ id: string; type: string }> | undefined;
      const raw = assignJson.trim();
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error("Assignments must be a JSON array of { id, type }");
        }
        assignments = parsed as Array<{ id: string; type: string }>;
      }
      const r = await api<{ tagId: string | null; key: string; value: string; assignNote: string | null }>(
        "/api/dashboard/tags/sync/meraki-to-te",
        {
          method: "POST",
          body: JSON.stringify({
            aid: aid.trim() || undefined,
            label: teLabel.trim() || undefined,
            key: teKey.trim() || undefined,
            value: teValue.trim() || undefined,
            objectType: teObjectType,
            assignments,
          }),
        },
      );
      setSyncMsg(
        `ThousandEyes tag created (id: ${r.tagId ?? "—"}). ${r.assignNote ? `Assignment note: ${r.assignNote}` : ""} Reload TE tags to see it.`,
      );
      void loadTeTags();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSyncBusy(false);
    }
  }

  function useMerakiTagString(t: string) {
    setTeLabel(t);
    const idx = t.indexOf(":");
    if (idx > 0) {
      setTeKey(t.slice(0, idx).trim());
      setTeValue(t.slice(idx + 1).trim());
    } else {
      setTeKey("meraki");
      setTeValue(t.trim());
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Tags management</h1>
      <p style={{ color: "var(--muted)", maxWidth: "52rem", lineHeight: 1.5 }}>
        View ThousandEyes tags (with assignments when expanded in the table) and Meraki Dashboard device tags from
        organization inventory. Push a tag string onto selected Meraki devices (typical mapping: TE{" "}
        <code>key:value</code> → Meraki tag <code>key:value</code>), or create a new TE tag from a Meraki label. TE tag
        assignment to agents/tests requires object IDs — use optional JSON below or assign in the ThousandEyes UI.
      </p>

      {syncMsg ? (
        <p style={{ margin: "1rem 0", fontSize: "0.9rem", color: "var(--text)" }} role="status">
          {syncMsg}
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))",
          gap: "1.25rem",
          marginTop: "1.25rem",
        }}
      >
        <section className="card" style={{ minWidth: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>ThousandEyes</h2>
          {teErr ? <p style={{ color: "var(--danger)", fontSize: "0.88rem" }}>{teErr}</p> : null}
          <label className="label" htmlFor="te-aid">
            Account group (aid)
          </label>
          <select
            id="te-aid"
            className="input"
            style={{ maxWidth: "100%", marginBottom: "0.75rem" }}
            value={aid}
            onChange={(e) => setAid(e.target.value)}
          >
            {accountGroups.map((g, i) => (
              <option key={`${String(g.aid)}-${i}`} value={String(g.aid ?? "")}>
                {g.accountGroupName ?? g.aid ?? "—"}
                {g.isDefaultAccountGroup ? " (default)" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn secondary" disabled={teLoading} onClick={() => void loadTeTags()}>
            {teLoading ? "Loading…" : "Load tags"}
          </button>
          <div style={{ marginTop: "1rem", overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.35rem" }} />
                  <th style={{ padding: "0.35rem" }}>Key</th>
                  <th style={{ padding: "0.35rem" }}>Value</th>
                  <th style={{ padding: "0.35rem" }}>Type</th>
                  <th style={{ padding: "0.35rem" }}>#</th>
                </tr>
              </thead>
              <tbody>
                {teTags.map((t) => {
                  const n = t.assignments?.length ?? 0;
                  const sel = t.id === selectedTeTagId;
                  return (
                    <tr
                      key={t.id ?? `${t.key}-${t.value}`}
                      style={{
                        borderTop: "1px solid var(--surface2)",
                        background: sel ? "rgba(61,139,253,0.12)" : undefined,
                      }}
                    >
                      <td style={{ padding: "0.35rem" }}>
                        <input
                          type="radio"
                          name="te-tag-sel"
                          checked={sel}
                          onChange={() => setSelectedTeTagId(t.id ?? null)}
                          aria-label={`Select tag ${t.key}:${t.value}`}
                        />
                      </td>
                      <td style={{ padding: "0.35rem" }}>{t.key ?? "—"}</td>
                      <td style={{ padding: "0.35rem" }}>{t.value ?? "—"}</td>
                      <td style={{ padding: "0.35rem", color: "var(--muted)" }}>{t.objectType ?? "—"}</td>
                      <td style={{ padding: "0.35rem" }}>{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {teTags.length === 0 && !teLoading ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No tags loaded.</p>
            ) : null}
          </div>
          {selectedTeTag && (selectedTeTag.assignments?.length ?? 0) > 0 ? (
            <div style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Assignments (selected tag)</div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)" }}>
                {selectedTeTag.assignments!.map((a, i) => (
                  <li key={`${a.id}-${i}`}>
                    <code>{a.type ?? "—"}</code> · {a.id ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="card" style={{ minWidth: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Meraki</h2>
          {merakiErr ? <p style={{ color: "var(--danger)", fontSize: "0.88rem" }}>{merakiErr}</p> : null}
          <label className="label" htmlFor="meraki-org">
            Organization
          </label>
          <select
            id="meraki-org"
            className="input"
            style={{ maxWidth: "100%", marginBottom: "0.75rem" }}
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn secondary" disabled={invLoading || !orgId} onClick={() => void loadInventory()}>
            {invLoading ? "Loading…" : "Load inventory"}
          </button>
          {invMeta ? (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.65rem" }}>
              {invMeta.total} devices with network (showing {invDevices.length}
              {invMeta.truncated ? ", list truncated" : ""}).
            </p>
          ) : null}
          {uniqueMerakiTags.length > 0 ? (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 6 }}>Tag strings (click to fill TE form)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {uniqueMerakiTags.slice(0, 24).map((u) => (
                  <button
                    key={u.tag}
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: "0.68rem", padding: "0.2rem 0.45rem" }}
                    onClick={() => useMerakiTagString(u.tag)}
                  >
                    {u.tag} ({u.deviceCount})
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: "0.85rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn secondary" style={{ fontSize: "0.75rem" }} onClick={selectAllVisible}>
              Select all shown
            </button>
            <button type="button" className="btn secondary" style={{ fontSize: "0.75rem" }} onClick={clearSelection}>
              Clear selection
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", alignSelf: "center" }}>
              Selected: {selectedDevices.size}
            </span>
          </div>
          <div style={{ marginTop: "0.65rem", overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.3rem" }} />
                  <th style={{ padding: "0.3rem" }}>Serial</th>
                  <th style={{ padding: "0.3rem" }}>Name</th>
                  <th style={{ padding: "0.3rem" }}>Tags</th>
                </tr>
              </thead>
              <tbody>
                {invDevices.map((d) => {
                  const k = deviceKey(d);
                  return (
                    <tr key={k} style={{ borderTop: "1px solid var(--surface2)" }}>
                      <td style={{ padding: "0.3rem" }}>
                        <input
                          type="checkbox"
                          checked={selectedDevices.has(k)}
                          onChange={() => toggleDevice(d)}
                          aria-label={`Select ${d.serial}`}
                        />
                      </td>
                      <td style={{ padding: "0.3rem", fontFamily: "ui-monospace, monospace" }}>{d.serial}</td>
                      <td style={{ padding: "0.3rem" }}>{d.name || "—"}</td>
                      <td style={{ padding: "0.3rem", color: "var(--muted)" }}>
                        {d.tags.length ? d.tags.join(", ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Cross-platform actions</h2>
        <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}>
          <div>
            <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>ThousandEyes → Meraki</h3>
            <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0 0 0.5rem", lineHeight: 1.45 }}>
              Adds the tag string to each selected device (merged with existing Meraki tags). Select a TE tag above to
              prefill <code>key:value</code>, or edit the string.
            </p>
            <label className="label" htmlFor="meraki-tag-str">
              Meraki tag string
            </label>
            <input
              id="meraki-tag-str"
              className="input"
              style={{ maxWidth: "100%" }}
              value={merakiTagInput}
              onChange={(e) => setMerakiTagInput(e.target.value)}
              placeholder="e.g. store:chicago-42"
            />
            <button
              type="button"
              className="btn"
              style={{ marginTop: "0.65rem" }}
              disabled={syncBusy}
              onClick={() => void applyTeToMeraki()}
            >
              Apply to selected Meraki devices
            </button>
          </div>
          <div>
            <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Meraki → ThousandEyes</h3>
            <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0 0 0.5rem", lineHeight: 1.45 }}>
              Creates a static TE tag for the chosen object type. Use a Meraki tag chip above or enter{" "}
              <code>label</code> as <code>key:value</code>.
            </p>
            <label className="label" htmlFor="te-label">
              Label (optional)
            </label>
            <input
              id="te-label"
              className="input"
              style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
              value={teLabel}
              onChange={(e) => setTeLabel(e.target.value)}
              placeholder="key:value or single string"
            />
            <label className="label" htmlFor="te-key">
              Key
            </label>
            <input
              id="te-key"
              className="input"
              style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
              value={teKey}
              onChange={(e) => setTeKey(e.target.value)}
            />
            <label className="label" htmlFor="te-val">
              Value
            </label>
            <input
              id="te-val"
              className="input"
              style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
              value={teValue}
              onChange={(e) => setTeValue(e.target.value)}
            />
            <label className="label" htmlFor="te-ot">
              TE object type
            </label>
            <select
              id="te-ot"
              className="input"
              style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
              value={teObjectType}
              onChange={(e) => setTeObjectType(e.target.value)}
            >
              {TE_OBJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="label" htmlFor="te-assign">
              Assign JSON (optional)
            </label>
            <textarea
              id="te-assign"
              className="input"
              style={{ maxWidth: "100%", minHeight: 72, fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
              value={assignJson}
              onChange={(e) => setAssignJson(e.target.value)}
              placeholder='[{"id":"12345","type":"v-agent"}]'
            />
            <button
              type="button"
              className="btn"
              style={{ marginTop: "0.65rem" }}
              disabled={syncBusy}
              onClick={() => void createTeFromMeraki()}
            >
              Create ThousandEyes tag
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
