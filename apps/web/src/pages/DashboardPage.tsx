import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { canViewAdminSettings } from "../lib/roles.js";
import { LocationMap } from "../components/LocationMap.js";
import { HistoryExplorer } from "../components/HistoryExplorer.js";
import { SiteDetailPanel, LocationCardSummary } from "../components/SiteSummaryTables.js";
import {
  normalizeMapWeatherLayer,
  normalizeMapWeatherPrecipitationUnit,
  normalizeMapWeatherTemperatureUnit,
  normalizeMapWeatherWindSpeedUnit,
  type MapWeatherLayerId,
} from "../lib/mapWeather.js";
import type { DashboardLocation } from "../lib/sitePayloads.js";
import {
  mapPinStatus,
  mapPinStatusDescription,
  parseMerakiSnapshot,
  parseTESnapshot,
} from "../lib/sitePayloads.js";

function SiteHistoryPicker({ locations }: { locations: DashboardLocation[] }) {
  const [id, setId] = useState(locations[0]?.id ?? "");
  useEffect(() => {
    if (locations.length > 0 && !locations.some((s) => s.id === id)) {
      setId(locations[0].id);
    }
  }, [locations, id]);
  const loc = locations.find((s) => s.id === id) ?? locations[0];
  if (!loc) {
    return null;
  }
  return (
    <>
      <div className="form-group" style={{ maxWidth: 360 }}>
        <label className="label">Location</label>
        <select
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {locations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <HistoryExplorer locationId={loc.id} locationName={loc.name} />
    </>
  );
}

type Lenses = {
  showMeraki?: boolean;
  showThousandEyes?: boolean;
  showMap?: boolean;
  cardColumns?: number;
  mapWeatherDefaultOn?: boolean;
  mapWeatherLayer?: MapWeatherLayerId;
  mapWeatherOpacity?: number;
  /** Temperature overlay legend: F (default) or C. */
  mapWeatherTemperatureUnit?: "F" | "C";
  /** Wind overlay legend: mph (default), ms, or kmh. */
  mapWeatherWindSpeedUnit?: "mph" | "ms" | "kmh";
  /** Precipitation overlay legend: in (default) or mm. */
  mapWeatherPrecipitationUnit?: "mm" | "in";
};

export function DashboardPage() {
  const { user } = useAuth();
  const showAdminHints = canViewAdminSettings(user?.role);

  const [locations, setLocations] = useState<DashboardLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const detailAnchorRef = useRef<HTMLDivElement | null>(null);
  const [lenses, setLenses] = useState<Lenses>({
    showMeraki: true,
    showThousandEyes: true,
    showMap: true,
    cardColumns: 3,
  });
  const [mapsEnabled, setMapsEnabled] = useState(false);
  const [mapsKey, setMapsKey] = useState<string | null>(null);
  const [openWeatherConfigured, setOpenWeatherConfigured] = useState(false);
  const [err, setErr] = useState("");

  const loadSitesOnly = useCallback(async () => {
    try {
      const dash = await api<{ sites: DashboardLocation[] }>("/api/dashboard/sites");
      setLocations(dash.sites);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [dash, settings] = await Promise.all([
        api<{ sites: DashboardLocation[] }>("/api/dashboard/sites"),
        api<{ lenses: unknown; googleMapsEnabled: boolean; openWeatherKeyConfigured?: boolean }>(
          "/api/dashboard/ui-config",
        ),
      ]);
      setLocations(dash.sites);
      setLenses((prev) => ({ ...prev, ...(settings.lenses as Lenses) }));
      setMapsEnabled(settings.googleMapsEnabled);
      setOpenWeatherConfigured(Boolean(settings.openWeatherKeyConfigured));
      if (settings.googleMapsEnabled) {
        try {
          const m = await api<{ apiKey: string }>("/api/dashboard/google-maps-key");
          setMapsKey(m.apiKey);
        } catch {
          setMapsKey(null);
        }
      } else {
        setMapsKey(null);
      }
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Snapshots update when Meraki ingest runs; poll `/api/dashboard/sites` so map pins and cards pick up WAN status changes. */
  useEffect(() => {
    const intervalMs = 30_000;
    let id: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      void loadSitesOnly();
    };

    const start = () => {
      if (id !== undefined) {
        clearInterval(id);
      }
      id = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [loadSitesOnly]);

  useEffect(() => {
    if (selectedLocationId) {
      detailAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedLocationId]);

  const cols = Math.min(6, Math.max(1, lenses.cardColumns ?? 3));
  const showMap = Boolean(lenses.showMap && mapsEnabled && mapsKey);

  const snapshotsMissing =
    locations.length > 0 &&
    locations.some(
      (s) =>
        (lenses.showMeraki !== false && !s.latestMeraki) ||
        (lenses.showThousandEyes !== false && !s.latestThousandEyes),
    );

  const selectedLocation = selectedLocationId ? locations.find((x) => x.id === selectedLocationId) : undefined;

  return (
    <div>
      <h1>Location overview</h1>
      <p style={{ color: "var(--muted)" }}>Latest ingested data per retail location.</p>
      {err ? <p style={{ color: "var(--danger)" }}>{err}</p> : null}
      {snapshotsMissing ? (
        <p
          className="card"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            fontSize: "0.9rem",
            color: "var(--text)",
            borderLeft: "4px solid var(--accent)",
          }}
        >
          Location cards pull from <strong>saved snapshots</strong>, not live API calls. If you just started
          the server, wait a few seconds for the first ingest
          {showAdminHints ?
            <>
              , or go to <strong>Admin</strong> → <strong>Full re-sync (Meraki + ThousandEyes)</strong>. Confirm API
              keys under <strong>API keys</strong> and check <strong>Admin → Recent ingest runs</strong> for errors
              (skipped = missing token).
            </>
          : (
            ". Ask an organization admin to confirm API keys and ingest if data stays empty."
          )}
        </p>
      ) : null}

      <div className="toolbar">
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Refresh
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Auto-refresh every 30s while this tab is visible (picks up new Meraki snapshots after ingest).
        </span>
        <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Card columns: {cols}
          {showAdminHints ? " (change in Admin → Lenses)" : " (set by organization admin)"}
        </span>
      </div>

      {showMap ? (
        <LocationMap
          locations={locations}
          apiKey={mapsKey!}
          selectedLocationId={selectedLocationId}
          onSelectLocation={setSelectedLocationId}
          mapWeather={{
            defaultOn: Boolean(lenses.mapWeatherDefaultOn),
            layer: normalizeMapWeatherLayer(lenses.mapWeatherLayer),
            opacity:
              typeof lenses.mapWeatherOpacity === "number"
                ? Math.min(0.95, Math.max(0.2, lenses.mapWeatherOpacity))
                : 0.55,
            temperatureUnit: normalizeMapWeatherTemperatureUnit(lenses.mapWeatherTemperatureUnit),
            windSpeedUnit: normalizeMapWeatherWindSpeedUnit(lenses.mapWeatherWindSpeedUnit),
            precipitationUnit: normalizeMapWeatherPrecipitationUnit(lenses.mapWeatherPrecipitationUnit),
            openWeatherConfigured,
          }}
        />
      ) : lenses.showMap && mapsEnabled && !mapsKey ? (
        <p style={{ color: "var(--warn)" }}>Map enabled but Google Maps API key missing (API keys page).</p>
      ) : null}

      {selectedLocation ? (
        <SiteDetailPanel
          siteId={selectedLocation.id}
          anchorRef={detailAnchorRef}
          locationName={selectedLocation.name}
          merakiNetworkId={selectedLocation.merakiNetworkId}
          thousandEyesTag={selectedLocation.thousandEyesTag}
          merakiCapturedAt={selectedLocation.latestMeraki?.capturedAt ?? null}
          teCapturedAt={selectedLocation.latestThousandEyes?.capturedAt ?? null}
          meraki={selectedLocation.latestMeraki ? parseMerakiSnapshot(selectedLocation.latestMeraki.payload) : null}
          te={
            selectedLocation.latestThousandEyes
              ? parseTESnapshot(selectedLocation.latestThousandEyes.payload)
              : null
          }
          onClose={() => setSelectedLocationId(null)}
          expectWan2Healthy={Boolean(selectedLocation.expectWan2Healthy)}
          expectCellularHealthy={Boolean(selectedLocation.expectCellularHealthy)}
          pinStatus={mapPinStatus(selectedLocation)}
          healthSummary={mapPinStatusDescription(selectedLocation)}
          showEndpointAgents={lenses.showThousandEyes !== false}
          siteLat={selectedLocation.lat}
          siteLng={selectedLocation.lng}
          openWeatherConfigured={openWeatherConfigured}
          circuits={selectedLocation.circuits ?? []}
        />
      ) : null}

      <div
        className="grid-locations"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        }}
      >
        {locations.map((s) => (
          <div key={s.id} className="card">
            {lenses.showMeraki !== false || lenses.showThousandEyes !== false ? (
              <LocationCardSummary
                siteId={s.id}
                locationName={s.name}
                merakiNetworkId={s.merakiNetworkId}
                thousandEyesTag={s.thousandEyesTag}
                pinStatus={mapPinStatus(s)}
                healthSummary={mapPinStatusDescription(s)}
                showAgentsColumn={lenses.showThousandEyes !== false}
                showTestsTable={lenses.showThousandEyes !== false}
                showEquipmentTable={lenses.showMeraki !== false}
                showEndpointAgents={lenses.showThousandEyes !== false}
                meraki={
                  lenses.showMeraki !== false && s.latestMeraki
                    ? parseMerakiSnapshot(s.latestMeraki.payload)
                    : null
                }
                te={
                  lenses.showThousandEyes !== false && s.latestThousandEyes
                    ? parseTESnapshot(s.latestThousandEyes.payload)
                    : null
                }
                merakiCapturedAt={lenses.showMeraki !== false ? (s.latestMeraki?.capturedAt ?? null) : null}
                teCapturedAt={
                  lenses.showThousandEyes !== false ? (s.latestThousandEyes?.capturedAt ?? null) : null
                }
                circuits={s.circuits ?? []}
              />
            ) : (
              <>
                <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>{s.name}</h2>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                  Meraki and ThousandEyes panels are hidden (Admin → Lenses).
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      {locations.length > 0 ? (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Historic snapshots</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Bar height = snapshot count per day (Meraki or ThousandEyes), up to 30 days / 2000 points.
          </p>
          <SiteHistoryPicker locations={locations} />
        </div>
      ) : null}

      {locations.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "1rem" }}>
          No locations yet. Add sites under <strong>Locations</strong> and map Meraki networks / TE tags.
        </p>
      ) : null}
    </div>
  );
}
