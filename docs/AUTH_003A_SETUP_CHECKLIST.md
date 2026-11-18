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

## Until the OAuth client is registered: the endpoint is disabled, not gated by a secret

`backend/server.js` now has exactly two states. With `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` set, `/api/openai` runs with full OAuth validation + per-user entitlement + quota. **Without it, every request gets a clean `503` — OpenAI is never called.** There is no third, secret-gated state: an earlier design considered a shared-secret stopgap, but this app's frontend is a static SPA that calls the endpoint directly from the browser, so any secret would have had to be inlined into the public JS bundle — not a real restriction. See `docs/AUTH_003A_SHARED_SECRET_REVIEW.md` for the full review. This is a deliberate, safe default: deploying this code before the OAuth client exists simply takes AI generation offline rather than leaving the endpoint open, or pretending to protect it.

## Known limitation, carried forward

Per-user rate limiting is in-memory and single-process, and **does not guarantee a production spending ceiling** — it resets on every restart and is correct only within one instance. `render.yaml` defines this service as one `type: web` instance with no scaling configuration, so the multi-instance gap isn't live today, but the restart-reset gap is real regardless. `backend/lib/quota.js` was the prepared, durable, atomic (Postgres-backed, proven under real concurrency) design — **now actually wired in as the default, replacing the in-memory limiter** (see `docs/AUTH_003A_QUOTA_DESIGN.md` for the integration). Requires `supabase/migrations/20261118140000_add_durable_openai_quota.sql` applied and the role grant from that same migration.
