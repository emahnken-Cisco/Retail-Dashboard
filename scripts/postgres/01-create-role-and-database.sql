-- =============================================================================
-- PART 1 of 2 — Run while connected to the maintenance database: postgres
-- (or template1). Works in pgAdmin, DBeaver, Azure Data Studio, etc.
-- =============================================================================
-- Creates login role + empty database. Does NOT use psql-only commands (\c, \set).
--
-- Then open PART 2 and run it while connected to database: retail_dashboard
-- =============================================================================

-- Application login role (no server-wide admin rights)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_dashboard_app') THEN
    RAISE NOTICE 'Role retail_dashboard_app already exists; skipping CREATE ROLE.';
  ELSE
    CREATE ROLE retail_dashboard_app WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      CONNECTION LIMIT -1
      PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
  END IF;
END
$$;

COMMENT ON ROLE retail_dashboard_app IS 'Retail Operations Dashboard app + migrations (Prisma)';

-- Database owned by the app user
CREATE DATABASE retail_dashboard
  OWNER retail_dashboard_app
  ENCODING 'UTF8'
  LC_COLLATE = 'C'
  LC_CTYPE = 'C'
  TEMPLATE template0;

COMMENT ON DATABASE retail_dashboard IS 'Retail Operations Dashboard (Meraki, ThousandEyes, admin settings)';

-- =============================================================================
-- NEXT: In your SQL client, switch the connection to database "retail_dashboard"
--       (new query window / connection target), then run:
--       scripts/postgres/02-grants-in-retail-dashboard.sql
--
-- DATABASE_URL:
-- postgresql://retail_dashboard_app:REPLACE_WITH_STRONG_PASSWORD@HOST:5432/retail_dashboard?schema=public
-- =============================================================================
