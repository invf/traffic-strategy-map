# AUTH-003A — Production Setup Checklist

Everything below is required before the code already committed on `feature/auth-003a-security-and-sso-prep` has any effect in Production. None of it has been done by this session — all of it needs your direct action (Supabase/Render dashboard access this session doesn't have).

## Database (apply via Supabase SQL Editor, in this order)

1. `supabase/migrations/20261118120000_add_strategy_ownership.sql` — adds `user_id`/`is_demo` to `public.strategies`. **Take a fresh backup first** (`node scripts/backup-strategies.mjs`) even though this migration is additive-only.
2. `supabase/migrations/20261118120100_add_openai_usage_tracking.sql` — creates `public.openai_usage`.
3. `supabase/migrations/20261118120200_provision_app_role.sql` — creates the `traffic_strategy_map_app` role. **After running it**, set its password out of band: `ALTER ROLE traffic_strategy_map_app PASSWORD '<a freshly generated secret>';` — never commit this value anywhere.
4. (Only when you're ready to run the OAuth/RLS proof) `supabase/migrations/20261118130000_add_oauth_rls_probe_table.sql`.

## Render environment (`traffic-strategy-backend` service)

- `SUPABASE_URL=https://eukogyljakqafnuvrfiv.supabase.co`
- `TRAFFIC_STRATEGY_MAP_DB_URL=postgresql://traffic_strategy_map_app:<the password from step 3 above>@<project>.pooler.supabase.com:6543/postgres?pgbouncer=true`
- `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID=<set once the OAuth client is registered — see AUTH_003A_OAUTH_CLIENT_SETUP.md>`

## Order of operations

The hardened `/api/openai` code is **safe to deploy before the database setup above is complete** — `requireAuth` fails closed (401) on any request with no valid token regardless, and `requireEntitlement` will correctly 503 ("could not verify access") rather than silently allow anything if `TRAFFIC_STRATEGY_MAP_DB_URL` isn't set yet (the connection attempt throws, caught, reported as an infrastructure failure — never treated as a pass). So: deploying the backend first, then finishing database setup, never leaves a window where the endpoint is *less* protected than it is today.

## Known limitation, carried forward

Per-user rate limiting is in-memory and single-process. `render.yaml` defines this service as one `type: web` instance with no scaling configuration, so this holds today — revisit if the service is ever scaled horizontally.
