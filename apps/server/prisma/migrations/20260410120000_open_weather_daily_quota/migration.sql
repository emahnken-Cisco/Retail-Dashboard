-- OpenWeather daily call cap (UTC day) and per-day counter
ALTER TABLE "AdminSettings" ADD COLUMN "openWeatherDailyLimit" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "OpenWeatherUsageDay" (
    "dayUtc" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OpenWeatherUsageDay_pkey" PRIMARY KEY ("dayUtc")
);
