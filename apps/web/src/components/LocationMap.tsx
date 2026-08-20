import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { GoogleMap, InfoWindow, Marker, useJsApiLoader } from "@react-google-maps/api";
import { api } from "../api.js";
import type { DashboardLocation } from "../lib/sitePayloads.js";
import { mapPinStatus, mapPinStatusDescription } from "../lib/sitePayloads.js";
import {
  MAP_WEATHER_LAYER_OPTIONS,
  mapWeatherOverlayLegend,
  openWeatherProxyTileUrl,
  openWeatherTileSlug,
  type MapWeatherLayerId,
  WEATHER_OVERLAY_MAP_TYPE_NAME,
} from "../lib/mapWeather.js";

const defaultCenter = { lat: 39.8283, lng: -98.5795 };

const PIN_COLORS = {
  ok: "#22c55e",
  degraded: "#ea580c",
  partial: "#f59e0b",
  empty: "#64748b",
} as const;

function pinIconUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">
  <path fill="${color}" stroke="#ffffff" stroke-width="2" d="M20 3C12 3 6 9.2 6 16.5c0 11 14 32.5 14 32.5s14-21.5 14-32.5C34 9.2 28 3 20 3z"/>
  <circle fill="#ffffff" cx="20" cy="16.5" r="5"/>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Removes our OpenWeather raster overlay so the base map is unobstructed.
 * Uses the tracked layer ref first, then sweeps by `name` (Google exposes `name` on ImageMapType;
 * `get("name")` is not always reliable for removal).
 */
function removeWeatherOverlay(
  map: google.maps.Map,
  trackedLayer: MutableRefObject<google.maps.ImageMapType | null>,
): void {
  const omt = map.overlayMapTypes;
  const tracked = trackedLayer.current;
  if (tracked) {
    for (let i = omt.getLength() - 1; i >= 0; i--) {
      if (omt.getAt(i) === tracked) {
        omt.removeAt(i);
      }
    }
    trackedLayer.current = null;
  }
  for (let i = omt.getLength() - 1; i >= 0; i--) {
    const mt = omt.getAt(i) as google.maps.ImageMapType | null | undefined;
    if (!mt) {
      continue;
    }
    const fromGet =
      typeof mt.get === "function" ? (mt.get("name") as string | null | undefined) : undefined;
    const label = (fromGet ?? mt.name) ?? null;
    if (label === WEATHER_OVERLAY_MAP_TYPE_NAME) {
      omt.removeAt(i);
    }
  }
}

export function LocationMap({
  locations,
  apiKey,
  selectedLocationId,
  onSelectLocation,
  mapWeather,
}: {
  locations: DashboardLocation[];
  apiKey: string;
  selectedLocationId: string | null;
  onSelectLocation: (id: string | null) => void;
  mapWeather: {
    defaultOn: boolean;
    layer: MapWeatherLayerId;
    opacity: number;
    /** Temperature overlay legend ticks: F (default) or C. */
    temperatureUnit: "F" | "C";
    /** Wind overlay legend: mph (default), ms, or kmh. */
    windSpeedUnit: "mph" | "ms" | "kmh";
    /** Precipitation overlay legend: in (default) or mm. */
    precipitationUnit: "mm" | "in";
    /** OpenWeather key is stored server-side; overlay loads tiles through the authenticated proxy. */
    openWeatherConfigured: boolean;
  };
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "retail-dashboard-map",
    googleMapsApiKey: apiKey,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const weatherOverlayLayerRef = useRef<google.maps.ImageMapType | null>(null);
  const [mapReadyTick, setMapReadyTick] = useState(0);
  const [overlayOn, setOverlayOn] = useState(mapWeather.defaultOn);
  /** Map overlay layer chosen on the map (independent of Admin default until that default changes). */
  const [overlayLayer, setOverlayLayer] = useState<MapWeatherLayerId>(mapWeather.layer);
  const [owmTileHint, setOwmTileHint] = useState<string | null>(null);

  useEffect(() => {
    setOverlayOn(mapWeather.defaultOn);
  }, [mapWeather.defaultOn]);

  useEffect(() => {
    setOverlayLayer(mapWeather.layer);
  }, [mapWeather.layer]);

  useEffect(() => {
    if (!overlayOn || !mapWeather.openWeatherConfigured) {
      setOwmTileHint(null);
      return;
    }
    const slug = openWeatherTileSlug(overlayLayer);
    let cancelled = false;
    void api<{
      ok: boolean;
      httpStatus: number;
      hint?: string;
      openweatherMessage?: string | null;
      quotaExceeded?: boolean;
    }>(`/api/dashboard/weather/openweather-tiles-status?slug=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (cancelled) {
          return;
        }
        if (r.ok) {
          setOwmTileHint(null);
        } else if (r.quotaExceeded) {
          setOwmTileHint(
            r.hint ??
              "Daily OpenWeather call limit reached (UTC day). Adjust the cap under Admin or try again tomorrow.",
          );
        } else {
          const detail =
            r.openweatherMessage && r.openweatherMessage.trim().length > 0
              ? ` OpenWeather says: ${r.openweatherMessage.trim()}`
              : "";
          setOwmTileHint(
            `${r.hint ?? `OpenWeather map tiles returned HTTP ${r.httpStatus}.`}${detail} Use API keys → Test OpenWeather if this persists.`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwmTileHint("Could not verify OpenWeather tiles (request failed).");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [overlayOn, mapWeather.openWeatherConfigured, overlayLayer]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReadyTick((n) => n + 1);
  }, []);

  const onMapUnmount = useCallback(() => {
    if (mapRef.current) {
      removeWeatherOverlay(mapRef.current, weatherOverlayLayerRef);
    }
    mapRef.current = null;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded || typeof google === "undefined" || mapReadyTick < 1) {
      return;
    }

    removeWeatherOverlay(map, weatherOverlayLayerRef);

    if (!overlayOn) {
      return;
    }

    const { opacity, openWeatherConfigured } = mapWeather;
    if (!openWeatherConfigured) {
      return;
    }

    const origin = window.location.origin;
    const slug = openWeatherTileSlug(overlayLayer);
    const imageMap = new google.maps.ImageMapType({
      name: WEATHER_OVERLAY_MAP_TYPE_NAME,
      opacity,
      tileSize: new google.maps.Size(256, 256),
      getTileUrl: (coord, zoom) => openWeatherProxyTileUrl(origin, slug, zoom, coord),
    });
    weatherOverlayLayerRef.current = imageMap;
    map.overlayMapTypes.insertAt(0, imageMap);

    return () => {
      if (mapRef.current) {
        removeWeatherOverlay(mapRef.current, weatherOverlayLayerRef);
      }
    };
  }, [isLoaded, mapReadyTick, overlayOn, overlayLayer, mapWeather.opacity, mapWeather.openWeatherConfigured]);

  const withCoords = locations.filter((s) => s.lat != null && s.lng != null) as Array<
    DashboardLocation & { lat: number; lng: number }
  >;

  const center =
    withCoords.length > 0
      ? {
          lat: withCoords.reduce((a, s) => a + s.lat, 0) / withCoords.length,
          lng: withCoords.reduce((a, s) => a + s.lng, 0) / withCoords.length,
        }
      : defaultCenter;

  const iconCache = useMemo(() => {
    if (!isLoaded || typeof google === "undefined") {
      return null;
    }
    return {
      ok: {
        url: pinIconUrl(PIN_COLORS.ok),
        scaledSize: new google.maps.Size(40, 52),
        anchor: new google.maps.Point(20, 52),
      },
      degraded: {
        url: pinIconUrl(PIN_COLORS.degraded),
        scaledSize: new google.maps.Size(40, 52),
        anchor: new google.maps.Point(20, 52),
      },
      partial: {
        url: pinIconUrl(PIN_COLORS.partial),
        scaledSize: new google.maps.Size(40, 52),
        anchor: new google.maps.Point(20, 52),
      },
      empty: {
        url: pinIconUrl(PIN_COLORS.empty),
        scaledSize: new google.maps.Size(40, 52),
        anchor: new google.maps.Point(20, 52),
      },
    };
  }, [isLoaded]);

  const owmMissing = overlayOn && !mapWeather.openWeatherConfigured;
  const weatherLegend =
    overlayOn && mapWeather.openWeatherConfigured ?
      mapWeatherOverlayLegend(overlayLayer, {
        temperatureUnit: mapWeather.temperatureUnit,
        windSpeedUnit: mapWeather.windSpeedUnit,
        precipitationUnit: mapWeather.precipitationUnit,
      })
    : null;

  if (loadError) {
    return (
      <div
        className="map-wrap"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          color: "var(--danger)",
          fontSize: "0.9rem",
        }}
      >
        Google Maps failed to load (check API key, billing, and HTTP referrer restrictions).{" "}
        {String(loadError)}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className="map-wrap"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: "0.9rem",
        }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div className="map-toolbar">
        <label className="map-toolbar__toggle">
          <input
            type="checkbox"
            checked={overlayOn}
            onChange={(e) => {
              const on = e.target.checked;
              setOverlayOn(on);
              if (!on) {
                setOwmTileHint(null);
                const map = mapRef.current;
                if (map) {
                  removeWeatherOverlay(map, weatherOverlayLayerRef);
                }
              }
            }}
          />
          Weather overlay
        </label>
        {mapWeather.openWeatherConfigured ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.82rem",
              color: "var(--text)",
            }}
          >
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>Condition</span>
            <select
              className="input"
              aria-label="Weather condition layer on map"
              value={overlayLayer}
              onChange={(e) => setOverlayLayer(e.target.value as MapWeatherLayerId)}
              style={{ fontSize: "0.8rem", padding: "0.2rem 0.45rem", minWidth: "9.5rem" }}
            >
              {MAP_WEATHER_LAYER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {owmMissing ? (
          <span className="map-toolbar__warn">
            Add an <strong>OpenWeatherMap.org</strong> API key under <strong>API keys</strong> (not Weather.com).
          </span>
        ) : null}
        {owmTileHint && overlayOn && mapWeather.openWeatherConfigured ? (
          <span className="map-toolbar__warn" style={{ maxWidth: "36rem" }}>
            {owmTileHint}
          </span>
        ) : null}
        <span className="map-toolbar__attr">Map tiles: OpenWeather — openweathermap.org</span>
      </div>
      <p className="map-legend" style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
        <span style={{ color: PIN_COLORS.ok }}>●</span> Green = healthy &nbsp;|&nbsp;
        <span style={{ color: PIN_COLORS.degraded }}>●</span> Orange = expected WAN2/cellular path down, still online
        &nbsp;|&nbsp;
        <span style={{ color: PIN_COLORS.partial }}>●</span> Amber = partial / offline &nbsp;|&nbsp;
        <span style={{ color: PIN_COLORS.empty }}>●</span> Gray = no snapshots
      </p>
      <div className="map-wrap__canvas">
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "100%" }}
          center={center}
          zoom={withCoords.length > 1 ? 4 : 6}
          onLoad={onMapLoad}
          onUnmount={onMapUnmount}
        >
          {iconCache
            ? withCoords.map((s) => {
                const status = mapPinStatus(s);
                const icon = iconCache[status];
                return (
                  <Marker
                    key={`${s.id}-${status}`}
                    position={{ lat: s.lat, lng: s.lng }}
                    title={s.name}
                    icon={icon}
                    onClick={() => onSelectLocation(s.id)}
                  >
                    {selectedLocationId === s.id ? (
                      <InfoWindow onCloseClick={() => onSelectLocation(null)}>
                        {/* Google InfoWindow is white; do not inherit dark-theme body text colors */}
                        <div className="map-infowindow" style={{ maxWidth: 280, paddingRight: 8 }}>
                          <strong className="map-infowindow__title">{s.name}</strong>
                          <p className="map-infowindow__summary">{mapPinStatusDescription(s)}</p>
                          <p className="map-infowindow__hint">
                            Full tables (tests, equipment, agents) open in the panel below the map.
                          </p>
                        </div>
                      </InfoWindow>
                    ) : null}
                  </Marker>
                );
              })
            : null}
        </GoogleMap>
        {weatherLegend ? (
          <aside className="map-weather-legend" aria-label="Weather overlay color scale">
            <div className="map-weather-legend__title">{weatherLegend.title}</div>
            <div className="map-weather-legend__subtitle">{weatherLegend.subtitle}</div>
            <div
              className="map-weather-legend__bar"
              style={{ background: weatherLegend.gradient }}
              role="img"
              aria-hidden
            />
            <div className="map-weather-legend__ticks">
              <span>{weatherLegend.tickLabels[0]}</span>
              <span>{weatherLegend.tickLabels[1]}</span>
              <span>{weatherLegend.tickLabels[2]}</span>
            </div>
            <p className="map-weather-legend__cite">
              Colors follow{" "}
              <a
                href="https://openweathermap.org/map_legend"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenWeather map legend
              </a>
              ; bar is a guide, not exact pixel values.
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
