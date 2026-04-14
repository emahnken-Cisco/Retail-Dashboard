-- =============================================================================
-- Run this in TWO ways to confirm setup
-- =============================================================================
-- A) As SUPERUSER on database retail_dashboard (should all succeed):
--    SELECT current_database(), current_user;
--
-- B) Log in AS retail_dashboard_app (same database) and run:
-- =============================================================================

SELECT current_database() AS db,
       current_user AS logged_in_as,
       has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS public_create;

-- Expect: public_usage = true, public_create = true for retail_dashboard_app
