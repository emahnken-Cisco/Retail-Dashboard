-- =============================================================================
-- PART 2 of 2 — MUST run as a SUPERUSER (e.g. postgres) while connected to
-- database: retail_dashboard  (NOT "postgres")
-- =============================================================================
-- In pgAdmin: right-click database retail_dashboard → Query Tool (check title bar
-- shows retail_dashboard, not postgres).
-- In DBeaver: SQL Editor → dropdown must be retail_dashboard, or use a
-- connection that defaults to that database.
-- =============================================================================

-- Database-level (safe to repeat)
GRANT CONNECT ON DATABASE retail_dashboard TO retail_dashboard_app;
GRANT TEMPORARY ON DATABASE retail_dashboard TO retail_dashboard_app;

-- Schema: Prisma needs USAGE + CREATE here
GRANT USAGE, CREATE ON SCHEMA public TO retail_dashboard_app;

-- Any tables/sequences already in public (empty DB = no-op)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO retail_dashboard_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO retail_dashboard_app;

-- Objects this role creates later (Prisma migrate as retail_dashboard_app)
ALTER DEFAULT PRIVILEGES FOR ROLE retail_dashboard_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO retail_dashboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retail_dashboard_app IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO retail_dashboard_app;

-- If you ever run migrations accidentally as "postgres", new tables are owned by
-- postgres. Uncomment the next two lines once, then comment again:
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT ALL ON TABLES TO retail_dashboard_app;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT ALL ON SEQUENCES TO retail_dashboard_app;
