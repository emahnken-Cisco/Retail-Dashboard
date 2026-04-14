-- CreateEnum
CREATE TYPE "SiteLocalContactSlot" AS ENUM ('PRIMARY', 'SECONDARY');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "localContactPrimaryName" TEXT,
ADD COLUMN "localContactPrimaryPhone" TEXT,
ADD COLUMN "localContactPrimaryEmail" TEXT,
ADD COLUMN "localContactSecondaryName" TEXT,
ADD COLUMN "localContactSecondaryPhone" TEXT,
ADD COLUMN "localContactSecondaryEmail" TEXT;

-- AlterTable
ALTER TABLE "Circuit" ADD COLUMN "siteLocalContactSlot" "SiteLocalContactSlot";

-- Backfill site primary from first circuit per site (by display order)
UPDATE "Site" AS s
SET
  "localContactPrimaryName" = x.n,
  "localContactPrimaryPhone" = x.p,
  "localContactPrimaryEmail" = x.e
FROM (
  SELECT DISTINCT ON ("siteId")
    "siteId",
    NULLIF(TRIM("localContactName"), '') AS n,
    NULLIF(TRIM("localContactPhone"), '') AS p,
    NULLIF(TRIM("localContactEmail"), '') AS e
  FROM "Circuit"
  WHERE COALESCE(TRIM("localContactName"), '') <> ''
     OR COALESCE(TRIM("localContactPhone"), '') <> ''
     OR COALESCE(TRIM("localContactEmail"), '') <> ''
  ORDER BY "siteId", "displayOrder" ASC, "id" ASC
) AS x
WHERE s.id = x."siteId";

-- Backfill site secondary: first circuit per site whose contact triple differs from primary
UPDATE "Site" AS s
SET
  "localContactSecondaryName" = y.n,
  "localContactSecondaryPhone" = y.p,
  "localContactSecondaryEmail" = y.e
FROM (
  SELECT DISTINCT ON (c."siteId")
    c."siteId",
    NULLIF(TRIM(c."localContactName"), '') AS n,
    NULLIF(TRIM(c."localContactPhone"), '') AS p,
    NULLIF(TRIM(c."localContactEmail"), '') AS e
  FROM "Circuit" c
  INNER JOIN "Site" s2 ON s2.id = c."siteId"
  WHERE (
    COALESCE(TRIM(c."localContactName"), '') <> ''
    OR COALESCE(TRIM(c."localContactPhone"), '') <> ''
    OR COALESCE(TRIM(c."localContactEmail"), '') <> ''
  )
  AND (
    COALESCE(TRIM(c."localContactName"), '') IS DISTINCT FROM COALESCE(TRIM(s2."localContactPrimaryName"), '')
    OR COALESCE(TRIM(c."localContactPhone"), '') IS DISTINCT FROM COALESCE(TRIM(s2."localContactPrimaryPhone"), '')
    OR COALESCE(TRIM(c."localContactEmail"), '') IS DISTINCT FROM COALESCE(TRIM(s2."localContactPrimaryEmail"), '')
  )
  ORDER BY c."siteId", c."displayOrder" ASC, c."id" ASC
) AS y
WHERE s.id = y."siteId";

-- Circuits matching site primary → PRIMARY slot
UPDATE "Circuit" c
SET "siteLocalContactSlot" = 'PRIMARY'
FROM "Site" s
WHERE c."siteId" = s.id
AND (
  COALESCE(TRIM(c."localContactName"), '') <> ''
  OR COALESCE(TRIM(c."localContactPhone"), '') <> ''
  OR COALESCE(TRIM(c."localContactEmail"), '') <> ''
)
AND COALESCE(TRIM(c."localContactName"), '') = COALESCE(TRIM(s."localContactPrimaryName"), '')
AND COALESCE(TRIM(c."localContactPhone"), '') = COALESCE(TRIM(s."localContactPrimaryPhone"), '')
AND COALESCE(TRIM(c."localContactEmail"), '') = COALESCE(TRIM(s."localContactPrimaryEmail"), '');

-- Circuits matching site secondary → SECONDARY slot
UPDATE "Circuit" c
SET "siteLocalContactSlot" = 'SECONDARY'
FROM "Site" s
WHERE c."siteId" = s.id
AND c."siteLocalContactSlot" IS NULL
AND (
  COALESCE(TRIM(c."localContactName"), '') <> ''
  OR COALESCE(TRIM(c."localContactPhone"), '') <> ''
  OR COALESCE(TRIM(c."localContactEmail"), '') <> ''
)
AND COALESCE(TRIM(c."localContactName"), '') = COALESCE(TRIM(s."localContactSecondaryName"), '')
AND COALESCE(TRIM(c."localContactPhone"), '') = COALESCE(TRIM(s."localContactSecondaryPhone"), '')
AND COALESCE(TRIM(c."localContactEmail"), '') = COALESCE(TRIM(s."localContactSecondaryEmail"), '');

-- Drop old per-circuit columns
ALTER TABLE "Circuit" DROP COLUMN "localContactName",
DROP COLUMN "localContactPhone",
DROP COLUMN "localContactEmail";
