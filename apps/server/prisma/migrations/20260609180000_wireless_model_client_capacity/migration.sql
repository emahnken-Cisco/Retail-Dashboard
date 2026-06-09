-- "Healthy design" client capacity per Meraki AP model, used by the wireless
-- health sidecar to flag overloaded APs. ORG_ADMIN can edit values; rows are
-- seeded with sensible defaults for current MR / CW series.

CREATE TABLE "MerakiModelClientCapacity" (
    "model"           TEXT NOT NULL,
    "capacity"        INTEGER NOT NULL,
    "note"            TEXT,
    "updatedById"     TEXT,
    "updatedByEmail"  TEXT,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerakiModelClientCapacity_pkey" PRIMARY KEY ("model")
);

-- Defaults reflect common "healthy design" client counts per AP model.
-- Operators can tune these via the admin UI; deletions are not used (PUT only).
INSERT INTO "MerakiModelClientCapacity" ("model", "capacity", "note", "updatedAt") VALUES
    ('MR33',     30, 'Wave 2 dual-band; legacy retail closet AP.',      NOW()),
    ('MR36',     40, 'Wi-Fi 6 dual-band entry; typical retail floor.',  NOW()),
    ('MR42',     40, 'Wave 2 tri-radio; legacy mid-density deployments.', NOW()),
    ('MR44',     45, 'Wi-Fi 6 tri-radio; mid-density.',                 NOW()),
    ('MR46',     50, 'Wi-Fi 6 4x4:4 tri-radio; high-density.',          NOW()),
    ('MR55',     60, 'Wi-Fi 6 8x8:8; large-room high-density.',         NOW()),
    ('MR57',     60, 'Wi-Fi 6E tri-radio; future-proofing for 6 GHz.',  NOW()),
    ('CW9162I',  50, 'Catalyst Wi-Fi 6E 2x2:2.',                        NOW()),
    ('CW9166I',  60, 'Catalyst Wi-Fi 6E 4x4:4 tri-radio.',              NOW());
