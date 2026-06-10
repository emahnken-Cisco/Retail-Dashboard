import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import {
  MAP_WEATHER_LAYER_OPTIONS,
  normalizeMapWeatherLayer,
  normalizeMapWeatherPrecipitationUnit,
  normalizeMapWeatherTemperatureUnit,
  normalizeMapWeatherWindSpeedUnit,
  type MapWeatherLayerId,
} from "../lib/mapWeather.js";

type TeAccountGroupRow = {
  aid?: string | number;
  accountGroupName?: string;
  isDefaultAccountGroup?: boolean;
};

type Settings = {
  retentionDays: number;
  heartbeatIntervalSec: number;
  pollIntervalMerakiSec: number;
  pollIntervalTESec: number;
  /** ThousandEyes account group id — scope TE API to the same org as Meraki. */
  thousandEyesAid?: string | null;
  oidcEnabled: boolean;
  oidcIssuerUrl: string | null;
  oidcClientId: string | null;
  googleMapsEnabled: boolean;
  sessionIdleTimeoutMin: number;
  lenses: Record<string, unknown>;
  openWeatherDailyLimit?: number;
  openWeatherKeyConfigured?: boolean;
  openWeatherQuotaDayUtc?: string;
  openWeatherCallsTodayUtc?: number;
  envOidcAvailable?: boolean;
};

export function AdminPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [teAccountGroups, setTeAccountGroups] = useState<TeAccountGroupRow[]>([]);
  const [ingest, setIngest] = useState<
    { id: string; jobType: string; status: string; startedAt: string }[]
  >([]);
  const [taskMsg, setTaskMsg] = useState("");

  const load = useCallback(async () => {
    const [settings, runs, teGroups] = await Promise.all([
      api<Settings>("/api/admin/settings"),
      api<{ runs: typeof ingest }>("/api/admin/ingest-runs"),
      api<{ accountGroups: TeAccountGroupRow[] }>("/api/dashboard/tags/te/account-groups").catch(() => ({
        accountGroups: [] as TeAccountGroupRow[],
      })),
    ]);
    setS(settings);
    setIngest(runs.runs);
    setTeAccountGroups(teGroups.accountGroups ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Partial<Settings> & { lenses?: Record<string, unknown> }) {
    await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) });
    await load();
  }

  async function resync() {
    setTaskMsg("");
    await api("/api/admin/tasks/resync", { method: "POST", body: "{}" });
    setTaskMsg("Re-sync triggered.");
    await load();
  }

  async function retention() {
    setTaskMsg("");
    const r = await api<{ deleted: number }>("/api/admin/tasks/retention", { method: "POST", body: "{}" });
    setTaskMsg(`Retention completed. Removed ${r.deleted} snapshots.`);
    await load();
  }

  async function uploadTls(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setTaskMsg("");
    const res = await fetch("/api/admin/tls/upload", {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskMsg(j.error ?? "TLS upload failed");
      return;
    }
    setTaskMsg(j.message ?? "TLS files saved.");
    form.reset();
  }

  if (!s) {
    return <div>Loading…</div>;
  }

  const lenses = (s.lenses ?? {}) as {
    showMeraki?: boolean;
    showThousandEyes?: boolean;
    showMap?: boolean;
    cardColumns?: number;
    mapWeatherDefaultOn?: boolean;
    mapWeatherLayer?: MapWeatherLayerId;
    mapWeatherOpacity?: number;
    mapWeatherTemperatureUnit?: "F" | "C";
    mapWeatherWindSpeedUnit?: "mph" | "ms" | "kmh";
    mapWeatherPrecipitationUnit?: "mm" | "in";
    wirelessConnLogDefaultWindow?: "1h" | "12h" | "24h" | "7d";
  };

  return (
    <div>
      <h1>Administration</h1>
      <p style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
        <Link to="/admin/users">User admin</Link> — create users and assign roles (organization admins only).
      </p>
      <p style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
        <Link to="/admin/wireless-capacity">Wireless capacity</Link> — tune the "healthy design" client capacity
        per Meraki AP model (drives the warning tone in the wireless health sidecar).
      </p>
      {taskMsg ? <p style={{ color: "var(--accent)" }}>{taskMsg}</p> : null}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Lenses &amp; data</h2>
        <div className="form-group">
          <label className="label">Retention (days)</label>
          <input
            type="number"
            className="input"
            defaultValue={s.retentionDays}
            key={s.retentionDays}
            onBlur={(e) => void patch({ retentionDays: Number(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label className="label">Heartbeat interval (seconds)</label>
          <input
            type="number"
            className="input"
            defaultValue={s.heartbeatIntervalSec}
            key={s.heartbeatIntervalSec}
            onBlur={(e) => void patch({ heartbeatIntervalSec: Number(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label className="label">Meraki poll interval (seconds)</label>
          <input
            type="number"
            className="input"
            defaultValue={s.pollIntervalMerakiSec}
            key={s.pollIntervalMerakiSec}
            onBlur={(e) => void patch({ pollIntervalMerakiSec: Number(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label className="label">ThousandEyes poll interval (seconds)</label>
          <input
            type="number"
            className="input"
            defaultValue={s.pollIntervalTESec}
            key={s.pollIntervalTESec}
            onBlur={(e) => void patch({ pollIntervalTESec: Number(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label className="label">ThousandEyes account group (aid)</label>
          <select
            className="input"
            value={s.thousandEyesAid ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              void patch({ thousandEyesAid: v === "" ? null : v });
            }}
          >
            <option value="">Default — token&apos;s primary account group</option>
            {s.thousandEyesAid &&
            !teAccountGroups.some((g) => String(g.aid ?? "") === String(s.thousandEyesAid)) ? (
              <option value={String(s.thousandEyesAid)}>
                {String(s.thousandEyesAid)} (saved — not in current list)
              </option>
            ) : null}
            {teAccountGroups.map((g, i) => (
              <option key={`${String(g.aid)}-${i}`} value={String(g.aid ?? "")}>
                {String(g.aid ?? "")}
                {g.accountGroupName ? ` — ${g.accountGroupName}` : ""}
                {g.isDefaultAccountGroup ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.45 }}>
            Set this to the ThousandEyes account group that matches your Meraki organization scope. Ingest, store
            discovery, endpoint details, and enterprise test charts all pass this{" "}
            <code style={{ fontSize: "0.85em" }}>aid</code> to the TE API. Requires a saved ThousandEyes token to load
            the list.
          </p>
        </div>
        <div className="form-group">
          <label className="label">Session idle timeout (minutes)</label>
          <input
            type="number"
            className="input"
            defaultValue={s.sessionIdleTimeoutMin}
            key={s.sessionIdleTimeoutMin}
            onBlur={(e) => void patch({ sessionIdleTimeoutMin: Number(e.target.value) })}
          />
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={Boolean(lenses.showMeraki ?? true)}
            onChange={(e) =>
              void patch({ lenses: { ...lenses, showMeraki: e.target.checked } })
            }
          />
          Show Meraki on dashboard cards
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <input
            type="checkbox"
            checked={Boolean(lenses.showThousandEyes ?? true)}
            onChange={(e) =>
              void patch({ lenses: { ...lenses, showThousandEyes: e.target.checked } })
            }
          />
          Show ThousandEyes on dashboard cards
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <input
            type="checkbox"
            checked={Boolean(lenses.showMap ?? true)}
            onChange={(e) => void patch({ lenses: { ...lenses, showMap: e.target.checked } })}
          />
          Show map lens (requires Google Maps key + enable below)
        </label>
        <div className="form-group" style={{ marginTop: "0.65rem" }}>
          <label className="label">Wireless connection log — default window</label>
          <select
            className="input"
            style={{ maxWidth: 240 }}
            value={lenses.wirelessConnLogDefaultWindow ?? "12h"}
            onChange={(e) =>
              void patch({
                lenses: {
                  ...lenses,
                  wirelessConnLogDefaultWindow: e.target.value as "1h" | "12h" | "24h" | "7d",
                },
              })
            }
          >
            <option value="1h">Last hour</option>
            <option value="12h">Last 12 hours (default)</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.45 }}>
            Drives the initial time window shown in the per-AP <strong>View log</strong> sidecar
            (Site detail → Equipment table → MR row → Live column). Users can still flip windows
            in the sidecar; this just controls the default the sidecar opens to.
          </p>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.75rem 0 0", lineHeight: 1.45 }}>
          <strong>Map weather overlay:</strong> Uses <strong>OpenWeatherMap.org</strong> map tiles (precipitation,
          clouds, wind, temperature). The Google Maps JavaScript API does not ship a weather raster layer; add an
          OpenWeather API key under <strong>API keys</strong>. Keys from <strong>Weather.com</strong> or other vendors
          will not work here. Tiles are loaded through this server so usage counts toward the daily cap below (each
          visible tile request is one call; pan/zoom can use many calls).
        </p>
        <div className="form-group" style={{ marginTop: "0.65rem" }}>
          <label className="label">OpenWeather calls / UTC day (budget)</label>
          <input
            type="number"
            min={0}
            max={2000000}
            className="input"
            style={{ maxWidth: 160 }}
            defaultValue={s.openWeatherDailyLimit ?? 1000}
            key={`owm-limit-${s.openWeatherDailyLimit}`}
            onBlur={(e) =>
              void patch({ openWeatherDailyLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
          />
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
            Default <strong>1000</strong> helps stay within common free-tier guidance. Set to <strong>0</strong> to
            disable all server-side OpenWeather (map overlay, tile check, integration test). Today (
            {s.openWeatherQuotaDayUtc ?? "—"} UTC):{" "}
            <strong>
              {s.openWeatherCallsTodayUtc ?? 0} / {s.openWeatherDailyLimit ?? 1000}
            </strong>
            {s.openWeatherKeyConfigured ? "" : " — no API key saved yet (API keys)."}
          </p>
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.65rem" }}>
          <input
            type="checkbox"
            checked={Boolean(lenses.mapWeatherDefaultOn)}
            onChange={(e) =>
              void patch({ lenses: { ...lenses, mapWeatherDefaultOn: e.target.checked } })
            }
          />
          Weather overlay on by default when map loads (users can still toggle off on the map)
        </label>
        <div className="form-group" style={{ marginTop: "0.65rem" }}>
          <label className="label">Weather overlay layer</label>
          <select
            className="input"
            style={{ maxWidth: 420 }}
            value={normalizeMapWeatherLayer(lenses.mapWeatherLayer)}
            onChange={(e) =>
              void patch({
                lenses: { ...lenses, mapWeatherLayer: e.target.value as MapWeatherLayerId },
              })
            }
          >
            {MAP_WEATHER_LAYER_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginTop: "0.5rem" }}>
          <label className="label">Weather overlay opacity (0.2–0.95)</label>
          <input
            type="number"
            min={0.2}
            max={0.95}
            step={0.05}
            className="input"
            style={{ maxWidth: 140 }}
            defaultValue={lenses.mapWeatherOpacity ?? 0.55}
            key={lenses.mapWeatherOpacity}
            onBlur={(e) =>
              void patch({
                lenses: {
                  ...lenses,
                  mapWeatherOpacity: Math.min(0.95, Math.max(0.2, Number(e.target.value) || 0.55)),
                },
              })
            }
          />
        </div>
        <div className="form-group" style={{ marginTop: "0.5rem" }}>
          <label className="label">Map precipitation legend</label>
          <select
            className="input"
            style={{ maxWidth: 320 }}
            value={normalizeMapWeatherPrecipitationUnit(lenses.mapWeatherPrecipitationUnit)}
            onChange={(e) =>
              void patch({
                lenses: {
                  ...lenses,
                  mapWeatherPrecipitationUnit: e.target.value as "mm" | "in",
                },
              })
            }
          >
            <option value="in">Inches (default)</option>
            <option value="mm">Millimeters (mm)</option>
          </select>
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
            Applies to the <strong>Precipitation</strong> overlay on the location overview map. OpenWeather tiles use
            an mm accumulation scale; inches shows converted tick labels on the same color bar.
          </p>
        </div>
        <div className="form-group" style={{ marginTop: "0.5rem" }}>
          <label className="label">Map temperature legend</label>
          <select
            className="input"
            style={{ maxWidth: 320 }}
            value={normalizeMapWeatherTemperatureUnit(lenses.mapWeatherTemperatureUnit)}
            onChange={(e) =>
              void patch({
                lenses: {
                  ...lenses,
                  mapWeatherTemperatureUnit: e.target.value as "F" | "C",
                },
              })
            }
          >
            <option value="F">Fahrenheit (default)</option>
            <option value="C">Celsius</option>
          </select>
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
            Applies to the <strong>Temperature</strong> overlay on the location overview map. OpenWeather tiles use a
            °C colormap; Fahrenheit shows converted tick labels for the same color bar.
          </p>
        </div>
        <div className="form-group" style={{ marginTop: "0.5rem" }}>
          <label className="label">Map wind speed legend</label>
          <select
            className="input"
            style={{ maxWidth: 320 }}
            value={normalizeMapWeatherWindSpeedUnit(lenses.mapWeatherWindSpeedUnit)}
            onChange={(e) =>
              void patch({
                lenses: {
                  ...lenses,
                  mapWeatherWindSpeedUnit: e.target.value as "mph" | "ms" | "kmh",
                },
              })
            }
          >
            <option value="mph">Miles per hour (default)</option>
            <option value="ms">Meters per second (m/s)</option>
            <option value="kmh">Kilometers per hour (km/h)</option>
          </select>
          <p style={{ fontSize: "0.78rem", color: "var(--muted)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
            Applies to the <strong>Wind</strong> overlay on the location overview map. OpenWeather tiles encode speed in
            m/s; other units show converted tick labels on the same color bar.
          </p>
        </div>
        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <label className="label">Location card columns (1–6)</label>
          <input
            type="number"
            min={1}
            max={6}
            className="input"
            defaultValue={lenses.cardColumns ?? 3}
            key={lenses.cardColumns}
            onBlur={(e) =>
              void patch({ lenses: { ...lenses, cardColumns: Number(e.target.value) } })
            }
          />
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={s.googleMapsEnabled}
            onChange={(e) => void patch({ googleMapsEnabled: e.target.checked })}
          />
          Enable Google Maps
        </label>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>SSO (OIDC)</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Set <code>OIDC_ENABLED=true</code> and client secret in server <code>.env</code>. Configure issuer and client
          ID here (Cisco-compatible OIDC).
        </p>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={s.oidcEnabled}
            disabled={!s.envOidcAvailable}
            onChange={(e) => void patch({ oidcEnabled: e.target.checked })}
          />
          Enable SSO login {s.envOidcAvailable ? "" : "(set OIDC_ENABLED in server env first)"}
        </label>
        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <label className="label">Issuer URL</label>
          <input
            className="input"
            defaultValue={s.oidcIssuerUrl ?? ""}
            key={s.oidcIssuerUrl ?? ""}
            onBlur={(e) => void patch({ oidcIssuerUrl: e.target.value || null })}
          />
        </div>
        <div className="form-group">
          <label className="label">Client ID</label>
          <input
            className="input"
            defaultValue={s.oidcClientId ?? ""}
            key={s.oidcClientId ?? ""}
            onBlur={(e) => void patch({ oidcClientId: e.target.value || null })}
          />
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Backend tasks</h2>
        <button type="button" className="btn secondary" onClick={() => void resync()}>
          Full re-sync (Meraki + ThousandEyes)
        </button>
        <button type="button" className="btn secondary" style={{ marginLeft: "0.5rem" }} onClick={() => void retention()}>
          Run retention purge now
        </button>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>TLS certificate upload</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Upload PEM certificate and private key. Update <code>.env</code> paths and restart with HTTPS.
        </p>
        <form onSubmit={(e) => void uploadTls(e)}>
          <div className="form-group">
            <label className="label">Certificate (cert)</label>
            <input name="cert" type="file" accept=".pem,.crt,.txt" required />
          </div>
          <div className="form-group">
            <label className="label">Private key (key)</label>
            <input name="key" type="file" accept=".pem,.key,.txt" required />
          </div>
          <button type="submit" className="btn">
            Upload
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Recent ingest runs</h2>
        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th>Job</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {ingest.map((r) => (
              <tr key={r.id}>
                <td>{r.jobType}</td>
                <td>{r.status}</td>
                <td>{r.startedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
