-- AUTH-003A - provisions the dedicated, narrowly-scoped Postgres role
-- this app's backend connects as for entitlement checks + usage
-- tracking. NOT YET APPLIED. Mirrors invf/adveser-launch-studio's own
-- launch_studio_app role exactly - same pattern, new role, nothing
-- broader.
--
-- This role is NEVER anon, NEVER authenticated, NEVER service_role -
-- it is its own identity with the minimum grants this app needs:
--   - SELECT only on adveser_core.user_product_entitlements (reads
--     another product's entitlement table; cannot write to it, cannot
--     see any other adveser_core table).
--   - INSERT only on this app's own openai_usage table (write usage
--     logs; cannot read them back, let alone anyone else's).
-- It has NO access to public.strategies at all - that table's
-- authorization is RLS via auth.uid(), a different mechanism, for a
-- different kind of query (scoped to the calling end-user, not a
-- privileged cross-schema read).
--
-- The actual password must be generated and set OUT OF BAND (Supabase
-- dashboard or `ALTER ROLE ... PASSWORD` run directly, never committed
-- here) - this file only creates the role and its grants.

CREATE ROLE traffic_strategy_map_app LOGIN;
-- Set the password separately, out of band:
--   ALTER ROLE traffic_strategy_map_app PASSWORD '<generated, never committed>';

GRANT USAGE ON SCHEMA adveser_core TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.user_product_entitlements TO traffic_strategy_map_app;

GRANT USAGE ON SCHEMA public TO traffic_strategy_map_app;
GRANT INSERT ON public.openai_usage TO traffic_strategy_map_app;
