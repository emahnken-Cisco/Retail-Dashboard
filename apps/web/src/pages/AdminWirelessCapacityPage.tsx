/**
 * Admin → Wireless capacity. ORG_ADMIN-only table for editing the "healthy
 * design" client capacity per Meraki AP model. Drives the warning tone in
 * the wireless health sidecar (clientCount / clientCapacity).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type CapacityRow = {
  model: string;
  capacity: number;
  note: string | null;
  updatedById: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
};

type FormDraft = {
  capacity: string;
  note: string;
};

export function AdminWirelessCapacityPage() {
  const [rows, setRows] = useState<CapacityRow[]>([]);
  const [err, setErr] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({});

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await api<{ models: CapacityRow[] }>("/api/admin/wireless/model-capacity");
      setRows(r.models ?? []);
      // Seed drafts so the inputs are controlled from the start.
      setDrafts(
        Object.fromEntries(
          (r.models ?? []).map((row) => [
            row.model,
            { capacity: String(row.capacity), note: row.note ?? "" },
          ]),
        ),
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load model capacities");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(model: string): Promise<void> {
    setMsg("");
    setErr("");
    const draft = drafts[model];
    if (!draft) {
      return;
    }
    const capacity = Number.parseInt(draft.capacity, 10);
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 2000) {
      setErr(`${model}: capacity must be between 1 and 2000.`);
      return;
    }
    setBusyModel(model);
    try {
      await api(`/api/admin/wireless/model-capacity/${encodeURIComponent(model)}`, {
        method: "PUT",
        body: JSON.stringify({
          capacity,
          note: draft.note.trim() === "" ? null : draft.note.trim(),
        }),
      });
      setMsg(`Saved ${model}.`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Save failed for ${model}`);
    } finally {
      setBusyModel(null);
    }
  }

  function setDraft(model: string, patch: Partial<FormDraft>): void {
    setDrafts((prev) => {
      const current = prev[model] ?? { capacity: "", note: "" };
      return { ...prev, [model]: { ...current, ...patch } };
    });
  }

  return (
    <div>
      <h1>Wireless capacity</h1>
      <p style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
        <Link to="/admin">← Administration</Link>
      </p>
      <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)", maxWidth: 720 }}>
        These "healthy design" client counts per Meraki AP model drive the warning tone in the wireless health
        sidecar (Site detail → <strong>Wireless health</strong> chip). This is not the radio's theoretical
        maximum — it is the ceiling above which performance typically degrades in real deployments.
      </p>

      {err ? (
        <p className="card" style={{ marginTop: "1rem", color: "var(--danger)" }} role="alert">
          {err}
        </p>
      ) : null}
      {msg ? (
        <p style={{ marginTop: "0.75rem", color: "var(--accent)" }} role="status">
          {msg}
        </p>
      ) : null}

      <section className="card" style={{ marginTop: "1rem", padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                <th style={th}>Model</th>
                <th style={th}>Capacity</th>
                <th style={th}>Note</th>
                <th style={th}>Updated</th>
                <th style={{ ...th, width: 1, whiteSpace: "nowrap" }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--muted)" }}>
                    No models seeded — apply the latest migration.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const draft = drafts[row.model] ?? {
                    capacity: String(row.capacity),
                    note: row.note ?? "",
                  };
                  const dirty =
                    draft.capacity !== String(row.capacity) ||
                    (draft.note ?? "") !== (row.note ?? "");
                  return (
                    <tr key={row.model} style={{ borderTop: "1px solid var(--surface2)" }}>
                      <td style={{ ...td, fontWeight: 700 }}>{row.model}</td>
                      <td style={td}>
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          className="input"
                          value={draft.capacity}
                          onChange={(e) => setDraft(row.model, { capacity: e.target.value })}
                          style={{ width: 100 }}
                        />
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          className="input"
                          value={draft.note}
                          maxLength={280}
                          onChange={(e) => setDraft(row.model, { note: e.target.value })}
                          style={{ width: "100%", minWidth: 200 }}
                        />
                      </td>
                      <td style={{ ...td, fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {row.updatedByEmail ?? "—"}
                        <br />
                        <span style={{ fontSize: "0.7rem" }}>
                          {new Date(row.updatedAt).toLocaleString()}
                        </span>
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={!dirty || busyModel === row.model}
                          onClick={() => void saveRow(row.model)}
                          style={{ opacity: !dirty || busyModel === row.model ? 0.5 : 1 }}
                        >
                          {busyModel === row.model ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.55rem 0.75rem",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
};

const td: React.CSSProperties = {
  padding: "0.55rem 0.75rem",
  verticalAlign: "middle",
};
