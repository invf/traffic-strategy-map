-- ADV-002B - read-only access for traffic_strategy_map_app into Launch
-- Studio's new approved-analysis-export table. The ONE grant this whole
-- integration gives Traffic Strategy Map into Launch Studio's own schema:
-- SELECT, one table, nothing else - no grant on workspace_documents,
-- workspace_revisions, or any BYOK table, exactly as ADV-002A's security
-- analysis specified. Never write access, per that report's own explicit
-- instruction ("do not grant Traffic Strategy Map write access to Launch
-- Studio analysis").
--
-- CROSS-REPOSITORY PREREQUISITE, explicit: this file's target table -
-- launch_studio.approved_analysis_exports - is created by
-- invf/adveser-launch-studio's own 0007_approved_analysis_exports.sql
-- migration, which MUST be applied first. Without it, GRANT USAGE ON
-- SCHEMA below still succeeds (the schema already exists, created by that
-- repo's earlier 0003 migration), but the GRANT SELECT on the table will
-- fail outright with an undefined-table error - loud and immediate, same
-- safety property as the previous migration's cross-repo dependency.
--
-- RLS on the target table (approved_analysis_exports_member, defined in
-- Launch Studio's 0007) already scopes every reader - including this
-- role - to rows for projects the caller is a member of, via the SAME
-- is_project_member() check and the SAME app.current_user_id GUC this
-- backend's new withSharedProjectTransaction() helper sets. No new RLS
-- policy is added here; this file is a grant only.
--
-- NOT YET APPLIED TO PRODUCTION - review and apply only after the
-- ADV-002B approval checkpoint and after confirming Launch Studio's 0007
-- is live.

GRANT USAGE ON SCHEMA launch_studio TO traffic_strategy_map_app;
GRANT SELECT ON launch_studio.approved_analysis_exports TO traffic_strategy_map_app;

-- ============================================================================
-- Rollback (manual, no data impact either way - a pure privilege change):
--   REVOKE SELECT ON launch_studio.approved_analysis_exports FROM traffic_strategy_map_app;
--   REVOKE USAGE ON SCHEMA launch_studio FROM traffic_strategy_map_app;
-- ============================================================================
