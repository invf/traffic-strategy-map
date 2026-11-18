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
- **Exactly one** of:
  - `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID=<set once the OAuth client is registered — see AUTH_003A_OAUTH_CLIENT_SETUP.md>` (Mode 1, the real/intended configuration), or
  - `TEMPORARY_SHARED_SECRET=<a freshly generated value>` (Mode 2, the explicit stopgap — see `backend/middleware/requireSharedSecret.js`; no per-user entitlement or quota in this mode)

## AUTH-003A-3 correction: this now REQUIRES a choice before deploy, not after

`backend/server.js` **refuses to start at all** if neither of the two env vars above is set — this is a deliberate, loud failure (see `server.js`'s own comment), not a bug. Before this correction, omitting `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` silently left `requireAuth` validating signature/issuer/audience but NOT which OAuth client issued the token — a real security gap that would have been easy to miss. Now: deploying this code with neither var set means the service won't come up at all (Render will show it as failed/crash-looping), which is loud and immediately visible, rather than quietly running with a hole in it.

**Practically**: choose Mode 2 (`TEMPORARY_SHARED_SECRET`) if you want `/api/openai` taken out of its current fully-open state *before* the OAuth client is registered — this stops it being reachable by anyone on the internet, though with no per-user entitlement/quota (every secret-holder is equally trusted). Switch to Mode 1 the moment the OAuth client exists, and remove `TEMPORARY_SHARED_SECRET` entirely at that point — never run both.

## Known limitation, carried forward

Per-user rate limiting (Mode 1 only — Mode 2 has no per-user concept at all) is in-memory and single-process, and **does not guarantee a production spending ceiling** — it resets on every restart and is correct only within one instance. `render.yaml` defines this service as one `type: web` instance with no scaling configuration, so the multi-instance gap isn't live today, but the restart-reset gap is real regardless. `backend/lib/quota.js` is the prepared, durable, atomic (Postgres-backed, proven under real concurrency) replacement — see `docs/AUTH_003A_QUOTA_DESIGN.md` for why it isn't the wired-in default yet and exactly how to adopt it.
