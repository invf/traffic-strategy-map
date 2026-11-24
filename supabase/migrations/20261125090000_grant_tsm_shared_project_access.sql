-- AUTH-005/ADV-002B - grants traffic_strategy_map_app read access to the
-- shared adveser_core project/membership tables, so this backend can list
-- a user's own ADVESER Projects and (in a later milestone, ADV-004) check
-- membership before linking a strategy to one. Mirrors the exact
-- least-privilege shape invf/adveser-launch-studio's own launch_studio_app
-- role already has on these same tables - SELECT only, no write grant of
-- any kind, since this backend never creates a project or manages
-- membership itself.
--
-- Confirmed prerequisites (per ADV-002B's own manually-verified Production
-- findings, reconciling ADV-002A-R1): adveser_core.projects,
-- project_members, project_products, and the two SECURITY DEFINER helper
-- functions (is_project_member, is_project_owner) all already exist in
-- Production; traffic_strategy_map_app currently lacks SELECT on the
-- three tables and EXECUTE on the two functions - this migration closes
-- exactly that gap, nothing more.
--
-- Does NOT touch adveser_core.user_product_entitlements or its existing
-- policies (traffic_strategy_map_app_entitlement_read,
-- user_product_entitlements_self) in any way - this file only adds new
-- grants on three DIFFERENT tables plus two functions. Does not enable or
-- alter RLS on any table (RLS is already enabled on all three, per the
-- same confirmed Production findings) and does not weaken it in any way -
-- a read-only GRANT, nothing more, same discipline as this repo's own
-- 20261118120200_provision_app_role.sql.
--
-- NOT YET APPLIED TO PRODUCTION - review and apply only after the
-- ADV-002B approval checkpoint.

GRANT SELECT ON adveser_core.projects TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.project_members TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.project_products TO traffic_strategy_map_app;

GRANT EXECUTE ON FUNCTION adveser_core.is_project_member(uuid, uuid) TO traffic_strategy_map_app;
GRANT EXECUTE ON FUNCTION adveser_core.is_project_owner(uuid, uuid) TO traffic_strategy_map_app;

-- set_config(text, text, boolean) is how this backend's new
-- withSharedProjectTransaction() helper (backend/lib/sharedProjectAccess.js)
-- sets the transaction-local app.current_user_id these tables' RLS
-- policies read - already granted to launch_studio_app for the identical
-- reason (invf/adveser-launch-studio's 0003 migration); granted here for
-- the same reason, not a new mechanism.
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO traffic_strategy_map_app;

-- ============================================================================
-- Rollback (manual, run only after confirming the new project-listing
-- feature flag is disabled - see backend/lib/sharedProjectAccess.js):
--   REVOKE SELECT ON adveser_core.projects FROM traffic_strategy_map_app;
--   REVOKE SELECT ON adveser_core.project_members FROM traffic_strategy_map_app;
--   REVOKE SELECT ON adveser_core.project_products FROM traffic_strategy_map_app;
--   REVOKE EXECUTE ON FUNCTION adveser_core.is_project_member(uuid, uuid) FROM traffic_strategy_map_app;
--   REVOKE EXECUTE ON FUNCTION adveser_core.is_project_owner(uuid, uuid) FROM traffic_strategy_map_app;
-- (set_config's grant is left in place - it's a harmless, generic,
-- normally-PUBLIC-executable function per Postgres's own defaults, and
-- launch_studio_app already has an identical grant with no issue.)
-- No data of any kind is affected by this migration or its rollback -
-- pure privilege statements.
-- ============================================================================
