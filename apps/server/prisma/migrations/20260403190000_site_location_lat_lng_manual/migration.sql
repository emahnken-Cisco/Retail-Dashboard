-- Manual map/weather coordinates override Meraki-derived position when true.
ALTER TABLE "Site" ADD COLUMN "locationLatLngManual" BOOLEAN NOT NULL DEFAULT false;
