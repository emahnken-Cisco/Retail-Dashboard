import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

type Cred = { provider: string; masked: string | null; updatedAt: string };

export function CredentialsPage() {
  const [list, setList] = useState<Cred[]>([]);
  const [meraki, setMeraki] = useState("");
  const [te, setTe] = useState("");
  const [gmaps, setGmaps] = useState("");
  const [owm, setOwm] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ credentials: Cred[] }>("/api/credentials");
    setList(r.credentials);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    provider: "meraki" | "thousandeyes" | "google_maps" | "openweathermap",
    secret: string,
  ) {
    setMsg("");
    try {
      await api(`/api/credentials/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ secret }),
      });
      setMsg(`Saved ${provider}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function testMeraki() {
    setMsg("");
    try {
      const r = await api<{ ok: boolean; organizationCount?: number }>("/api/integrations/meraki/test", {
        method: "POST",
        body: "{}",
      });
      setMsg(`Meraki OK — organizations visible: ${r.organizationCount ?? 0}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function testOpenWeather() {
    setMsg("");
    try {
      const r = await api<{
        ok: boolean;
        currentWeatherHttp: number;
        currentWeatherDetail: string;
        mapTilesHttp: number;
        mapTilesOk: boolean;
        mapTilesDetail: string;
      }>("/api/integrations/openweathermap/test", { method: "POST", body: "{}" });
      setMsg(
        r.ok
          ? `OpenWeather OK — Current Weather API: ${r.currentWeatherHttp}, map tiles: OK.`
          : `OpenWeather check: Current Weather HTTP ${r.currentWeatherHttp} (${r.currentWeatherDetail}). Map tiles HTTP ${r.mapTilesHttp}, ok=${r.mapTilesOk}${r.mapTilesDetail ? ` — ${r.mapTilesDetail}` : ""}. New keys can take up to ~2 hours to activate; re-save the key after trimming is fixed.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function testTe() {
    setMsg("");
    try {
      const r = await api<{ ok: boolean; enterpriseAgentCount?: number }>(
        "/api/integrations/thousandeyes/test",
        { method: "POST", body: "{}" },
      );
      setMsg(`ThousandEyes OK — enterprise agents: ${r.enterpriseAgentCount ?? 0}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test failed");
    }
  }

  return (
    <div>
      <h1>API keys</h1>
      <p style={{ color: "var(--muted)" }}>
        Secrets are encrypted with <code>CREDENTIALS_MASTER_KEY</code>. Only masked values are shown after save.
      </p>
      {msg ? <p style={{ color: "var(--accent)" }}>{msg}</p> : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Configured</h2>
        <ul>
          {list.map((c) => (
            <li key={c.provider}>
              <strong>{c.provider}</strong> — key: {c.masked ?? "n/a"} — {c.updatedAt}
            </li>
          ))}
        </ul>
        {list.length === 0 ? <p style={{ color: "var(--muted)" }}>None yet.</p> : null}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Meraki Dashboard API key</h2>
        <input
          className="input"
          type="password"
          placeholder="New key"
          value={meraki}
          onChange={(e) => setMeraki(e.target.value)}
        />
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => void save("meraki", meraki)} disabled={!meraki}>
            Save
          </button>
          <button type="button" className="btn secondary" onClick={() => void testMeraki()}>
            Test connection
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>ThousandEyes OAuth bearer token</h2>
        <input
          className="input"
          type="password"
          placeholder="Bearer token"
          value={te}
          onChange={(e) => setTe(e.target.value)}
        />
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => void save("thousandeyes", te)} disabled={!te}>
            Save
          </button>
          <button type="button" className="btn secondary" onClick={() => void testTe()}>
            Test connection
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Google Maps JavaScript API key</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Restrict this key by HTTP referrer in Google Cloud. Enable Maps JavaScript API. This key does{" "}
          <strong>not</strong> enable map weather tiles — see Admin → Lenses for how radar/weather overlays work.
        </p>
        <input
          className="input"
          type="password"
          placeholder="API key"
          value={gmaps}
          onChange={(e) => setGmaps(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          style={{ marginTop: "0.75rem" }}
          onClick={() => void save("google_maps", gmaps)}
          disabled={!gmaps}
        >
          Save
        </button>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>OpenWeatherMap.org API key (map weather overlay)</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.45 }}>
          Create a key at <strong>openweathermap.org</strong> (account → API keys). This is <strong>not</strong>{" "}
          Weather.com, The Weather Channel, or IBM — those keys will not work. The dashboard map uses OpenWeather{" "}
          <strong>Weather maps 1.0</strong> tiles (proxied through this app; the key is not sent to browsers). New keys
          may take <strong>up to ~2 hours</strong> to activate (OpenWeather FAQ). Leading/trailing spaces are stripped
          when you save. Each outbound OpenWeather request counts toward the daily budget in <strong>Admin</strong>{" "}
          (default 1000/UTC day), including <strong>each map tile</strong>, this test (two calls), and the map tile
          health check.
        </p>
        <input
          className="input"
          type="password"
          placeholder="API key"
          value={owm}
          onChange={(e) => setOwm(e.target.value)}
        />
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => void save("openweathermap", owm)} disabled={!owm}>
            Save
          </button>
          <button type="button" className="btn secondary" onClick={() => void testOpenWeather()}>
            Test OpenWeather (Current Weather + map tile)
          </button>
        </div>
      </div>
    </div>
  );
}
