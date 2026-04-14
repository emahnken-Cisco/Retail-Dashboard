-- Per-circuit expectations (WAN2 and/or cellular). Migrates legacy expectsDualWan -> expectWan2Healthy.
ALTER TABLE "Site" ADD COLUMN "expectWan2Healthy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Site" ADD COLUMN "expectCellularHealthy" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Site" SET "expectWan2Healthy" = true WHERE "expectsDualWan" = true;
ALTER TABLE "Site" DROP COLUMN "expectsDualWan";
