import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api } from "../api.js";
import { circuitRowsFromCsv, type CircuitImportApiRow } from "../lib/csvParse.js";

type ValidateResponse = {
  rows: Array<{ index: number; ok: boolean; errors?: string[]; resolvedSiteId?: string }>;
};

type CommitResponse = {
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
};

async function downloadSampleCsv() {
  const res = await fetch("/api/circuits/import/sample", { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Download failed");
  }
  const cd = res.headers.get("Content-Disposition");
  let name = "circuit_import_sample.csv";
  const m = cd?.match(/filename="?([^";]+)"?/i);
  if (m) {
    name = m[1];
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadInventoryCsv(exportSiteId: string | undefined) {
  const q = exportSiteId?.trim() ? `?siteId=${encodeURIComponent(exportSiteId.trim())}` : "";
  const res = await fetch(`/api/circuits/import/export${q}`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Download failed");
  }
  const cd = res.headers.get("Content-Disposition");
  let name = "circuit_inventory.csv";
  const m = cd?.match(/filename="?([^";]+)"?/i);
  if (m) {
    name = m[1];
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CircuitBulkImport({
  onCommitted,
  exportSiteId,
}: {
  onCommitted: () => void;
  /** When set (e.g. Circuits page location filter), export only circuits for this site. */
  exportSiteId?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CircuitImportApiRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [columnRefOpen, setColumnRefOpen] = useState(false);

  useEffect(() => {
    if (!columnRefOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setColumnRefOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columnRefOpen]);

  const loadFile = useCallback(async (f: File | null) => {
    setFile(f);
    setValidateResult(null);
    setCommitResult(null);
    setMsg("");
    if (!f) {
      setRows([]);
      setParseErrors([]);
      return;
    }
    const text = await f.text();
    const { rows: parsed, errors } = circuitRowsFromCsv(text);
    setRows(parsed);
    setParseErrors(errors);
  }, []);

  const validate = useCallback(async () => {
    setMsg("");
    setCommitResult(null);
    if (rows.length === 0) {
      setMsg("No rows to validate. Upload a CSV or fix parse errors.");
      return;
    }
    if (parseErrors.length > 0) {
      setMsg("Fix CSV parse errors before validating.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<ValidateResponse>("/api/circuits/import/validate", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setValidateResult(r);
      const bad = r.rows.filter((x) => !x.ok).length;
      setMsg(bad === 0 ? "All rows passed validation." : `${bad} row(s) have errors. Fix the CSV and re-upload, or adjust data in a future edit step.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Validate failed");
    } finally {
      setBusy(false);
    }
  }, [parseErrors.length, rows]);

  const commit = useCallback(async () => {
    setMsg("");
    if (rows.length === 0) {
      setMsg("Nothing to commit.");
      return;
    }
    const ok =
      validateResult?.rows.every((x) => x.ok) ??
      false;
    if (!validateResult || !ok) {
      setMsg("Validate successfully first (all rows must pass).");
      return;
    }
    if (!confirm(`Create ${rows.length} circuit(s)?`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await api<CommitResponse>("/api/circuits/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setCommitResult(r);
      setMsg(
        `Created ${r.created}, skipped (idempotent) ${r.skipped}, failed ${r.failed}.`,
      );
      if (r.created > 0 || r.skipped > 0) {
        onCommitted();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }, [onCommitted, rows, validateResult]);

  return (
    <section className="card" style={{ marginTop: "1.25rem" }}>
      <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Bulk import (CSV)</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", maxWidth: "48rem", lineHeight: 1.5 }}>
        Download the sample file or a CSV of current circuits (same columns), fill one row per circuit, then upload.
        Validate checks site resolution and duplicate Meraki interfaces per location. Commit uses a unique idempotency
        key per row so retries do not duplicate circuits. Import only creates new circuits—re-uploading an unchanged
        export will fail validation where a site and interface already exist.{" "}
        <button
          type="button"
          onClick={() => setColumnRefOpen(true)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--accent)",
            cursor: "pointer",
            textDecoration: "underline",
            font: "inherit",
            fontSize: "inherit",
          }}
        >
          CSV column reference (required &amp; optional fields)
        </button>
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.65rem" }}>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void downloadSampleCsv()}>
          Download sample CSV
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void downloadInventoryCsv(exportSiteId)}
        >
          Download current inventory
        </button>
        <label className="btn secondary" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
          Choose CSV…
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            style={{ display: "none" }}
            onChange={(e) => void loadFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file ? (
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{file.name}</span>
        ) : null}
      </div>
      {parseErrors.length > 0 ? (
        <ul style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
          {parseErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "0.5rem" }}>
          Parsed <strong>{rows.length}</strong> data row(s).
        </p>
      ) : null}
      <div style={{ marginTop: "0.65rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" className="btn secondary" disabled={busy || rows.length === 0} onClick={() => void validate()}>
          Validate
        </button>
        <button type="button" className="btn" disabled={busy || rows.length === 0} onClick={() => void commit()}>
          Commit import
        </button>
      </div>
      {msg ? (
        <p style={{ fontSize: "0.88rem", marginTop: "0.5rem" }} role="status">
          {msg}
        </p>
      ) : null}
      {validateResult ? (
        <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>OK</th>
                <th style={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {validateResult.rows.map((r) => (
                <tr key={r.index}>
                  <td style={td}>{r.index + 1}</td>
                  <td style={td}>{r.ok ? "Yes" : "No"}</td>
                  <td style={td}>
                    {r.ok ? (r.resolvedSiteId ? `site_id: ${r.resolvedSiteId.slice(0, 8)}…` : "—") : (r.errors?.join("; ") ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {commitResult && commitResult.failed > 0 ? (
        <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
          <p style={{ fontSize: "0.85rem", color: "var(--danger)" }}>Some rows failed on commit:</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>OK</th>
                <th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {commitResult.results
                .filter((x) => !x.ok)
                .map((r) => (
                  <tr key={r.index}>
                    <td style={td}>{r.index + 1}</td>
                    <td style={td}>No</td>
                    <td style={td}>{r.error ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {columnRefOpen ? (
        <>
          <button
            type="button"
            aria-label="Close column reference"
            onClick={() => {
              setColumnRefOpen(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.45)",
              border: "none",
              cursor: "pointer",
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="circuit-import-column-ref-title"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 1001,
              width: "min(420px, 100vw)",
              maxWidth: "100%",
              background: "var(--surface)",
              borderLeft: "1px solid var(--surface2)",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.35)",
              padding: "1.25rem 1.25rem 2rem",
              overflowY: "auto",
              animation: "circuitImportDrawerIn 0.2s ease-out",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
              <h3
                id="circuit-import-column-ref-title"
                style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.35 }}
              >
                Circuit import CSV columns
              </h3>
              <button
                type="button"
                className="btn secondary"
                style={{ flexShrink: 0, padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}
                onClick={() => setColumnRefOpen(false)}
              >
                Close
              </button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "0.65rem", lineHeight: 1.5 }}>
              Use the first row as headers. Column names are <strong>snake_case</strong> (see sample file). The app adds an
              idempotency key per row when you upload—you do not put that in the CSV.
            </p>

            <h4 style={{ fontSize: "0.82rem", margin: "1rem 0 0.4rem", color: "var(--ok)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Required (each data row)
            </h4>
            <ul style={{ margin: 0, paddingLeft: "1.15rem", fontSize: "0.86rem", lineHeight: 1.55, color: "var(--text)" }}>
              <li>
                <strong>Site</strong> — provide <em>at least one</em> of:{" "}
                <code style={{ fontSize: "0.78rem" }}>site_id</code>, <code style={{ fontSize: "0.78rem" }}>site_name</code>{" "}
                (matches a location name, case-insensitive), or <code style={{ fontSize: "0.78rem" }}>meraki_network_id</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>connectivity_kind</code> —{" "}
                <code style={{ fontSize: "0.78rem" }}>DIA</code>, <code style={{ fontSize: "0.78rem" }}>BROADBAND</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>SATELLITE</code>, or <code style={{ fontSize: "0.78rem" }}>CELLULAR_4G_5G</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>provider_name</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>carrier_circuit_id</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>meraki_interface</code> — e.g. <code style={{ fontSize: "0.78rem" }}>wan1</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>wan2</code>, <code style={{ fontSize: "0.78rem" }}>cellular</code>
              </li>
            </ul>

            <h4 style={{ fontSize: "0.82rem", margin: "1rem 0 0.4rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Optional
            </h4>
            <ul style={{ margin: 0, paddingLeft: "1.15rem", fontSize: "0.86rem", lineHeight: 1.55, color: "var(--text)" }}>
              <li>
                <code style={{ fontSize: "0.78rem" }}>speed_preset_id</code> — UUID from the speed library
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>custom_speed_label</code> — free text if not using a preset
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>is_synchronous</code> — <code style={{ fontSize: "0.78rem" }}>true</code> /{" "}
                <code style={{ fontSize: "0.78rem" }}>false</code> (default true)
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>site_local_contact_slot</code> —{" "}
                <code style={{ fontSize: "0.78rem" }}>PRIMARY</code>, <code style={{ fontSize: "0.78rem" }}>SECONDARY</code>, or empty
                (which store contact this circuit uses for display)
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>local_contact_primary_name</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>local_contact_primary_phone</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>local_contact_primary_email</code> — optional; updates the location&apos;s
                primary store contact when present (same as Stores tab)
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>local_contact_secondary_name</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>local_contact_secondary_phone</code>,{" "}
                <code style={{ fontSize: "0.78rem" }}>local_contact_secondary_email</code> — optional; secondary store contact
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>meraki_appliance_serial</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>notes</code>
              </li>
              <li>
                <code style={{ fontSize: "0.78rem" }}>display_order</code> — integer (default 0)
              </li>
            </ul>

            <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "1rem", lineHeight: 1.5 }}>
              Only one circuit per location per Meraki interface is allowed; duplicates are rejected on validate or commit.
            </p>
          </aside>
          <style>{`
            @keyframes circuitImportDrawerIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </>
      ) : null}
    </section>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.35rem 0.45rem",
  borderBottom: "1px solid var(--surface2)",
  color: "var(--muted)",
  fontSize: "0.72rem",
};
const td: CSSProperties = { padding: "0.3rem 0.45rem", borderTop: "1px solid var(--surface2)" };
