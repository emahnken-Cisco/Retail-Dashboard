export type MapWeatherLayerId =
  | "openweather_precipitation"
  | "openweather_clouds"
  | "openweather_wind"
  | "openweather_temp";

export const MAP_WEATHER_LAYER_OPTIONS: { id: MapWeatherLayerId; label: string }[] = [
  { id: "openweather_precipitation", label: "Precipitation" },
  { id: "openweather_clouds", label: "Clouds" },
  { id: "openweather_wind", label: "Wind" },
  { id: "openweather_temp", label: "Temperature" },
];

/** Visual scale hints for the OpenWeather raster tiles (see https://openweathermap.org/map_legend). */
export type MapWeatherOverlayLegend = {
  title: string;
  subtitle: string;
  /** CSS `linear-gradient` for the color bar (approximates OWM map colormap). */
  gradient: string;
  tickLabels: [string, string, string];
};

/** Admin / dashboard: temperature legend on map overlay (tiles use °C internally). */
export type MapWeatherTemperatureUnit = "F" | "C";

export function normalizeMapWeatherTemperatureUnit(v: unknown): MapWeatherTemperatureUnit {
  if (v === "C") {
    return "C";
  }
  return "F";
}

/** Admin / dashboard: wind legend on map overlay (OpenWeather tiles use m/s). */
export type MapWeatherWindSpeedUnit = "mph" | "ms" | "kmh";

export function normalizeMapWeatherWindSpeedUnit(v: unknown): MapWeatherWindSpeedUnit {
  if (v === "ms" || v === "mps" || v === "m/s") {
    return "ms";
  }
  if (v === "kmh" || v === "km/h") {
    return "kmh";
  }
  return "mph";
}

/** Admin / dashboard: precipitation legend (OpenWeather tiles use mm). */
export type MapWeatherPrecipitationUnit = "mm" | "in";

export function normalizeMapWeatherPrecipitationUnit(v: unknown): MapWeatherPrecipitationUnit {
  if (v === "mm") {
    return "mm";
  }
  return "in";
}

function formatPrecipInches(mm: number): string {
  const inches = mm / 25.4;
  if (inches < 0.15) {
    return `~${inches.toFixed(2)} in`;
  }
  return `${Math.round(inches * 10) / 10} in`;
}

export const MAP_WEATHER_OVERLAY_LEGEND: Record<MapWeatherLayerId, MapWeatherOverlayLegend> = {
  openweather_precipitation: {
    title: "Precipitation",
    subtitle: "Accumulation (classic rain scale, mm)",
    gradient:
      "linear-gradient(90deg, rgba(225,200,100,0.25) 0%, rgba(150,150,190,0.45) 22%, rgba(110,110,205,0.65) 45%, rgba(80,80,225,0.88) 72%, rgb(20,20,255) 100%)",
    tickLabels: ["0", "~1 mm", "140 mm"],
  },
  openweather_clouds: {
    title: "Cloud cover",
    subtitle: "Opacity / density (0–100%)",
    gradient:
      "linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(250,250,255,0.35) 35%, rgba(247,247,255,0.65) 65%, rgba(240,240,255,0.98) 100%)",
    tickLabels: ["0%", "50%", "100%"],
  },
  openweather_wind: {
    title: "Wind speed",
    subtitle: "Mean at 10 m (m/s)",
    gradient:
      "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(238,206,206,0.55) 18%, rgba(179,100,188,0.8) 42%, rgba(116,76,172,0.92) 68%, rgba(70,0,175,0.98) 88%, rgb(13,17,38) 100%)",
    tickLabels: ["~1", "25 m/s", "100+"],
  },
  openweather_temp: {
    title: "Temperature",
    subtitle: "Air temperature (°C on tiles)",
    gradient:
      "linear-gradient(90deg, rgb(130,22,146) 0%, rgb(32,140,236) 22%, rgb(35,221,221) 42%, rgb(194,255,40) 58%, rgb(255,194,40) 75%, rgb(252,128,20) 100%)",
    tickLabels: ["−40 °C", "0 °C", "30 °C"],
  },
};

export function mapWeatherOverlayLegend(
  layer: MapWeatherLayerId,
  options?: {
    temperatureUnit?: MapWeatherTemperatureUnit;
    windSpeedUnit?: MapWeatherWindSpeedUnit;
    precipitationUnit?: MapWeatherPrecipitationUnit;
  },
): MapWeatherOverlayLegend {
  const tempUnit = normalizeMapWeatherTemperatureUnit(options?.temperatureUnit);
  const windUnit = normalizeMapWeatherWindSpeedUnit(options?.windSpeedUnit);
  const precipUnit = normalizeMapWeatherPrecipitationUnit(options?.precipitationUnit);
  const base = MAP_WEATHER_OVERLAY_LEGEND[layer];

  if (layer === "openweather_precipitation") {
    if (precipUnit === "mm") {
      return base;
    }
    return {
      ...base,
      subtitle: "Accumulation (labels in.; tile colors follow OpenWeather mm scale)",
      tickLabels: ["0", formatPrecipInches(1), formatPrecipInches(140)],
    };
  }

  if (layer === "openweather_temp") {
    if (tempUnit === "C") {
      return base;
    }
    const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
    return {
      ...base,
      subtitle: "Air temperature (labels °F; tile colors follow OpenWeather °C scale)",
      tickLabels: [`${cToF(-40)} °F`, `${cToF(0)} °F`, `${cToF(30)} °F`],
    };
  }

  if (layer === "openweather_wind") {
    const refLow = 1;
    const refMid = 25;
    const refHigh = 100;
    if (windUnit === "ms") {
      return {
        ...base,
        subtitle: "Mean wind at 10 m (m/s; matches OpenWeather tile scale)",
        tickLabels: ["~1 m/s", "25 m/s", "100+ m/s"],
      };
    }
    if (windUnit === "kmh") {
      const toKmh = (ms: number) => Math.round(ms * 3.6);
      return {
        ...base,
        subtitle: "Mean wind at 10 m (labels km/h; tile colors follow OpenWeather m/s scale)",
        tickLabels: [`~${toKmh(refLow)} km/h`, `${toKmh(refMid)} km/h`, `${toKmh(refHigh)}+ km/h`],
      };
    }
    const toMph = (ms: number) => Math.round(ms * 2.2369362920544);
    return {
      ...base,
      subtitle: "Mean wind at 10 m (labels mph; tile colors follow OpenWeather m/s scale)",
      tickLabels: [`~${toMph(refLow)} mph`, `${toMph(refMid)} mph`, `${toMph(refHigh)}+ mph`],
    };
  }

  return base;
}

const OWM_TILE_LAYER: Record<MapWeatherLayerId, string> = {
  openweather_precipitation: "precipitation_new",
  openweather_clouds: "clouds_new",
  openweather_wind: "wind_new",
  openweather_temp: "temp_new",
};

export const WEATHER_OVERLAY_MAP_TYPE_NAME = "retail-dashboard-weather";

/** Migrate old lens values and invalid strings to a safe default. */
export function normalizeMapWeatherLayer(v: unknown): MapWeatherLayerId {
  if (v === "rainviewer_radar") {
    return "openweather_precipitation";
  }
  if (typeof v === "string" && v in OWM_TILE_LAYER) {
    return v as MapWeatherLayerId;
  }
  return "openweather_precipitation";
}

export function openWeatherTileSlug(layer: MapWeatherLayerId): string {
  return OWM_TILE_LAYER[layer];
}

/**
 * Same-origin tile URL via server proxy (counts toward Admin daily OpenWeather cap; key stays server-side).
 * Google Maps ImageMapType needs an absolute URL; pass `window.location.origin` (or your public app origin).
 */
export function openWeatherProxyTileUrl(
  appOrigin: string,
  slug: string,
  zoom: number,
  coord: { x: number; y: number },
): string {
  const bound = 2 ** zoom;
  const x = ((coord.x % bound) + bound) % bound;
  const base = appOrigin.replace(/\/$/, "");
  return `${base}/api/dashboard/weather/openweather-tile/${encodeURIComponent(slug)}/${zoom}/${x}/${coord.y}`;
}
