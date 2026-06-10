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

/** Validation for new model names — matches the server-side regex. */
const MODEL_NAME_RE = /^[A-Z0-9-]{2,32}$/;

type NewModelDraft = {
  model: string;
  capacity: string;
  note: string;
};

const EMPTY_NEW_DRAFT: NewModelDraft = { model: "", capacity: "", note: "" };

export function AdminWirelessCapacityPage() {
  const [rows, setRows] = useState<CapacityRow[]>([]);
  const [err, setErr] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({});
  const [newDraft, setNewDraft] = useState<NewModelDraft>(EMPTY_NEW_DRAFT);
  const [creating, setCreating] = useState<boolean>(false);

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

  async function createRow(): Promise<void> {
    setMsg("");
    setErr("");
    const modelInput = newDraft.model.trim().toUpperCase();
    if (!MODEL_NAME_RE.test(modelInput)) {
      setErr("Model name must be 2–32 chars, letters/digits/dashes only (e.g. MR57, CW9176D1).");
      return;
    }
    // Duplicate check — UI guard before the upsert silently overwrites an
    // existing row. Defensive only; server-side PUT would otherwise just
    // update the row, which is *probably* not what the admin meant.
    if (rows.some((r) => r.model === modelInput)) {
      setErr(`${modelInput} already exists — edit it in the row below instead.`);
      return;
    }
    const capacity = Number.parseInt(newDraft.capacity, 10);
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 2000) {
      setErr("Capacity must be between 1 and 2000.");
      return;
    }
    setCreating(true);
    try {
      await api(`/api/admin/wireless/model-capacity/${encodeURIComponent(modelInput)}`, {
        method: "PUT",
        body: JSON.stringify({
          capacity,
          note: newDraft.note.trim() === "" ? null : newDraft.note.trim(),
        }),
      });
      setMsg(`Added ${modelInput}.`);
      setNewDraft(EMPTY_NEW_DRAFT);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function deleteRow(model: string): Promise<void> {
    setMsg("");
    setErr("");
    // Native confirm is fine for an internal admin tool; not worth a custom modal.
    if (
      !window.confirm(
        `Delete capacity row for ${model}? The wireless sidecar will fall back to the default of 40 clients for any AP of this model.`,
      )
    ) {
      return;
    }
    setBusyModel(model);
    try {
      await api(`/api/admin/wireless/model-capacity/${encodeURIComponent(model)}`, {
        method: "DELETE",
      });
      setMsg(`Deleted ${model}.`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Delete failed for ${model}`);
    } finally {
      setBusyModel(null);
    }
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
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
              {/* Add-model row: an inline form for creating new SKUs (e.g. MR57, CW9176D1) */}
              <tr style={{ borderTop: "1px solid var(--surface2)", background: "var(--surface)" }}>
                <td style={td}>
                  <input
                    type="text"
                    className="input"
                    placeholder="MR57"
                    value={newDraft.model}
                    onChange={(e) => setNewDraft({ ...newDraft, model: e.target.value })}
                    maxLength={32}
                    style={{ width: 110, fontWeight: 700, textTransform: "uppercase" }}
                    aria-label="New model name"
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    className="input"
                    placeholder="40"
                    value={newDraft.capacity}
                    onChange={(e) => setNewDraft({ ...newDraft, capacity: e.target.value })}
                    style={{ width: 100 }}
                    aria-label="New model capacity"
                  />
                </td>
                <td style={td}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional rationale (e.g. 'Wi-Fi 7 8x8, design guide ceiling')"
                    value={newDraft.note}
                    maxLength={280}
                    onChange={(e) => setNewDraft({ ...newDraft, note: e.target.value })}
                    style={{ width: "100%", minWidth: 200 }}
                    aria-label="New model note"
                  />
                </td>
                <td style={{ ...td, fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  new
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={creating || !newDraft.model.trim() || !newDraft.capacity.trim()}
                    onClick={() => void createRow()}
                    style={{
                      opacity:
                        creating || !newDraft.model.trim() || !newDraft.capacity.trim() ? 0.5 : 1,
                    }}
                  >
                    {creating ? "Adding…" : "Add"}
                  </button>
                </td>
              </tr>

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--muted)" }}>
                    No models yet — add one above, or apply the latest migration to seed defaults.
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
                  const busy = busyModel === row.model;
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
                      <td style={{ ...td, whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={!dirty || busy}
                          onClick={() => void saveRow(row.model)}
                          style={{ opacity: !dirty || busy ? 0.5 : 1 }}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void deleteRow(row.model)}
                          style={{
                            opacity: busy ? 0.5 : 1,
                            background: "transparent",
                            color: "var(--danger)",
                            border: "1px solid var(--danger)",
                          }}
                          aria-label={`Delete ${row.model}`}
                        >
                          Delete
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
