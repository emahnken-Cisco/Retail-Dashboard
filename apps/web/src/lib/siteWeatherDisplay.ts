/** Tooltip: expected condition + OWM icon code (for hover on the glyph). */
export function openWeatherIconTooltip(
  iconCode: string | null,
  main: string,
  description: string,
): string {
  const mainT = main.trim() || "—";
  const descT = description.trim();
  const descPart = descT ? ` — ${descT}` : "";
  if (!iconCode) {
    return `Condition: ${mainT}${descPart}`;
  }
  const c = iconCode.trim().toLowerCase();
  const dayPart = c.endsWith("d") ? "day" : c.endsWith("n") ? "night" : "";
  const num = c.length >= 2 ? c.slice(0, 2) : "";
  const byNumber: Record<string, string> = {
    "01": "Clear sky",
    "02": "Few clouds",
    "03": "Scattered clouds",
    "04": "Broken / overcast clouds",
    "09": "Shower rain",
    "10": "Rain",
    "11": "Thunderstorm",
    "13": "Snow",
    "50": "Mist / fog / haze",
  };
  const kind = byNumber[num] ?? "Weather";
  const when = dayPart ? ` (${dayPart})` : "";
  return `Icon ${iconCode}: ${kind}${when}. API group: ${mainT}.${descPart}`;
}

/** OpenWeather `weather[].main` → emoji (no external requests; works with strict CSP). */
export function weatherEmojiForMain(main: string): string {
  const m = main.trim().toLowerCase();
  if (m.includes("thunder")) {
    return "⛈️";
  }
  if (m === "drizzle" || m === "rain") {
    return "🌧️";
  }
  if (m.includes("snow")) {
    return "❄️";
  }
  if (
    m === "mist" ||
    m === "fog" ||
    m === "haze" ||
    m === "smoke" ||
    m === "dust" ||
    m === "sand" ||
    m === "ash"
  ) {
    return "🌫️";
  }
  if (m === "clear") {
    return "🌤️";
  }
  if (m.includes("cloud")) {
    return "☁️";
  }
  if (m.includes("tornado") || m.includes("squall")) {
    return "🌪️";
  }
  return "🌤️";
}

/** Official OWM PNG (may require CSP img-src to include openweathermap.org in production). */
export function openWeatherIconUrl(iconCode: string | null, size: "1x" | "2x" | "4x" = "2x"): string | null {
  if (!iconCode || !/^[0-9][0-9][dn]$/i.test(iconCode.trim())) {
    return null;
  }
  const code = iconCode.trim().toLowerCase();
  const suffix = size === "4x" ? "@4x" : size === "2x" ? "@2x" : "";
  return `https://openweathermap.org/img/wn/${code}${suffix}.png`;
}
