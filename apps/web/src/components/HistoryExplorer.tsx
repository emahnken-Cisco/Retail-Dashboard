import { useEffect, useState } from "react";
import { api } from "../api.js";

export function HistoryExplorer({
  locationId,
  locationName,
}: {
  locationId: string;
  locationName: string;
}) {
  const [source, setSource] = useState<"meraki" | "thousandeyes">("meraki");
  const [points, setPoints] = useState<{ capturedAt: string }[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    setErr("");
    void (async () => {
      try {
        const r = await api<{ points: { capturedAt: string }[] }>(
          `/api/dashboard/history/${locationId}?source=${source}&days=30`,
        );
        setPoints(r.points);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
        setPoints([]);
      }
    })();
  }, [locationId, source]);

  const byDay = points.reduce<Record<string, number>>((acc, p) => {
    const d = p.capturedAt.slice(0, 10);
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();

  return (
    <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--surface2)" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>History — {locationName}</span>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as "meraki" | "thousandeyes")}
          style={{ background: "var(--bg)", color: "var(--text)", borderRadius: 6, padding: "0.2rem 0.4rem" }}
        >
          <option value="meraki">Meraki</option>
          <option value="thousandeyes">ThousandEyes</option>
        </select>
      </div>
      {err ? <p style={{ color: "var(--danger)", fontSize: "0.75rem" }}>{err}</p> : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48, marginTop: "0.5rem" }}>
        {days.slice(-14).map((d) => {
          const n = byDay[d] ?? 0;
          const h = Math.min(40, 4 + n * 6);
          return (
            <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                title={`${d}: ${n} snapshots`}
                style={{
                  width: "100%",
                  maxWidth: 24,
                  height: h,
                  background: "var(--accent)",
                  borderRadius: 4,
                  opacity: 0.85,
                }}
              />
              <span style={{ fontSize: "0.55rem", color: "var(--muted)", marginTop: 2 }}>
                {d.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
        {points.length} snapshots in selected range (max 2000 rows).
      </p>
    </div>
  );
}
