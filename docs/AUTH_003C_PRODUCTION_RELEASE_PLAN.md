# AUTH-003C — Traffic Strategy Map Production Release

Continuing from commit `e9a4bec2a43f83023c634ffd6f53a2a297ce6ca7` (implementation and security tests accepted). This document is the release plan only. **Nothing in this document has been executed against production.** No merge, deploy, migration, Supabase configuration change, or entitlement grant happened this session.

**Scope update (later session)**: the 3 existing `public.strategies` rows were confirmed disposable test data; their preservation is no longer a release requirement (their loss is acceptable, though the migration's own `ADD COLUMN`-only design leaves them unchanged regardless). Every reference below to backing them up or verifying their preservation is superseded by `docs/AUTH_003C_MIGRATION_PREPARATION.md`'s own "Scope update" note and its downgraded Task 1 — this document's backup/preservation language is kept for historical record only, not as an active requirement.

## Step 1 — Final preparation

1. **Removed the outdated unsafe RLS rollback comment** from `supabase/migrations/20261118120000_add_strategy_ownership.sql`. It previously recommended `ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY;` as the post-cutover rollback — unsafe once real owned private rows exist (it would expose every one of them, not just restore pre-migration behavior), and never executed. Replaced with a pointer to the two actually-sanctioned, RLS-preserving procedures in `docs/AUTH_003A_ROLLBACK_PROCEDURES.md`. Committed this session (see commit below) — this is the one code change in this step.
2. **Both feature branches confirmed**, re-verified via `git fetch` + `git ls-remote` (not cached state):
   - `invf/traffic-strategy-map` — `feature/auth-003a-security-and-sso-prep` at `e9a4bec2a43f83023c634ffd6f53a2a297ce6ca7` (plus this session's one commit on top — see below). `master` unaffected, at `c5dabca5dd3548f4deed7788b55366ef3301bdf1`.
   - `invf/adveser-platform` — `feature/auth-003b-traffic-map-sso-prep` at `f8fbf06230f528ceccff26ed6957a1163a7b8a95`. `main` unaffected, at `cea1494f895e4e6844ea406bdc191e3c1317b54c`.
   - **Neither branch is merged.** This is a real, required manual action (Step 1.5 below), not just a status note.
3. **Vercel proxy configuration confirmed** — `vercel.json`:
   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://traffic-strategy-map.onrender.com/api/:path*" },
       { "source": "/auth/:path*", "destination": "https://traffic-strategy-map.onrender.com/auth/:path*" },
       { "source": "/(.*)", "destination": "/index.html" }
     ],
     "headers": [{ "source": "/(api|auth)/:path*", "headers": [{ "key": "x-vercel-enable-rewrite-caching", "value": "0" }] }]
   }
   ```
   Destination matches the confirmed Render hostname exactly; proxy rules precede the SPA fallback (first-match-wins order is correct); the cache opt-out header rule is present.
4. **Required Render environment variable names**, re-enumerated directly from the code (`grep` across `backend/`, excluding `node_modules` noise) — unchanged from the prior audit, confirmed `requireProductEntitlement.js` introduces no new one:

   `FRONTEND_URL`, `PORT`, `OPENAI_API_KEY`, `OPENAI_DAILY_QUOTA` (optional), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TRAFFIC_STRATEGY_MAP_DB_URL`, `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID`, `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_SECRET`, `TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI`, `TRAFFIC_STRATEGY_MAP_SESSION_SECRET`, `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE` (optional, leave unset)

   **Cannot confirm presence on the actual Render service from this session** — no Render dashboard/API access was available. This is a required manual check: open the Render service's Environment tab and confirm every required name above has a value (names only, as instructed — do not paste any value back to me).
5. **Render service's connected repo/branch — cannot verify from this session**, same access limitation. This surfaces a real logistical requirement, not just a checkbox: **all of this engagement's work lives on `feature/auth-003a-security-and-sso-prep`, never merged into `master`.** Confirm in the Render dashboard which branch the service actually deploys from. If it's `master` (typical default), the feature branch must be merged via a reviewed PR before any deploy of this work can happen at all — that merge is a decision for you to make and execute, not something this session can do under its restrictions. If Render has instead been pointed directly at the feature branch, confirm that's intentional and not an oversight.
6. **Central ADVESER Platform confirmed unchanged** — `lib/products.ts` on `feature/auth-003b-traffic-map-sso-prep`: the `traffic-strategy-map` product's `url` is still the old `PRODUCT_URLS["traffic-strategy-map"]` (the pre-Option-B Vercel URL), and `ssoStartUrl` appears only in comments, never as an actual field on the product object. Not activated.

## Step 2 — Database migration checkpoint (STOP — approval required before executing anything below)

### Confirmed real production baseline (per your report — not independently queried, no DB access this session)
- `public.strategies`, 8 columns (`id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at`).
- An existing permissive RLS policy named `"Allow all"`.
- 3 existing strategy rows.
- No `user_id`/`is_demo` columns yet, no `openai_usage`/`openai_quota` tables yet.

This matches exactly what `supabase/migrations/20261118115900_baseline_strategies_schema_for_rehearsal.sql` now reproduces for local rehearsal (confirmed in the prior session: this corrected baseline was used to rehearse the exact migration below, including proving the `"Allow all"` policy removal is load-bearing, not cosmetic — rehearsal's first assertion would fail without it).

### Preflight SQL (read-only — run and review the output before proceeding)
```sql
-- 2a. Confirm the exact current shape matches what's assumed above
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'strategies' ORDER BY ordinal_position;
-- Expect exactly 8 rows, the columns listed above - if anything else
-- is present (in particular user_id or is_demo already existing),
-- STOP and reconcile before proceeding - the migration below assumes
-- neither exists yet.

-- 2b. Confirm the "Allow all" policy really exists, by that exact name
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'strategies';
-- Expect exactly one row: policyname = 'Allow all'. If the name
-- differs, the migration's DROP POLICY IF EXISTS "Allow all" will
-- silently not remove it (IF EXISTS suppresses the error, not the
-- mismatch) - find the real name and tell me before this is applied.

-- 2c. Confirm exactly 3 rows exist, capture their ids for post-migration comparison
SELECT id, name, created_at FROM public.strategies ORDER BY created_at;

-- 2d. Confirm neither target table exists yet (migrations are additive/idempotent via IF NOT EXISTS, but worth knowing going in)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('openai_usage', 'openai_quota');

-- 2e. Confirm the role doesn't already exist under a different definition
SELECT rolname FROM pg_roles WHERE rolname = 'traffic_strategy_map_app';
```

### Backup (take this BEFORE anything else in this step)
1. **Supabase's own backup**: confirm a recent automatic backup exists (Dashboard → Database → Backups), or trigger a manual one if your plan tier supports it. This is the real safety net for schema *and* data together — nothing below replaces it.
2. **This repo's own row-level snapshot**, additionally, for a fast human-readable diff:
   ```bash
   VITE_SUPABASE_ANON_KEY=<the real anon key> node scripts/backup-strategies.mjs
   ```
   Writes a timestamped JSON file to `backups/` (gitignored). Works today because RLS isn't enabled on `public.strategies` yet; re-run it once more immediately *after* migration 1 below, while the 3 original rows are still readable by `service_role`/an admin query, as a second confirmation point.

### The migration itself — exact SQL, in order, not yet executed

**1. `20261118120000_add_strategy_ownership.sql`** (the one corrected this session):
```sql
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Allow all" ON public.strategies;

ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or approved demo" ON public.strategies
  FOR SELECT
  USING (is_demo = true OR (user_id IS NOT NULL AND user_id = auth.uid()));

CREATE POLICY "insert own" ON public.strategies
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_demo = false);

CREATE POLICY "update own" ON public.strategies
  FOR UPDATE
  USING (user_id = auth.uid() AND is_demo = false)
  WITH CHECK (user_id = auth.uid() AND is_demo = false);

CREATE POLICY "delete own" ON public.strategies
  FOR DELETE
  USING (user_id = auth.uid() AND is_demo = false);
```
Preserves all 3 existing rows unchanged (`ADD COLUMN` only, no `UPDATE`/`DELETE` anywhere in this file) — they get `user_id = NULL, is_demo = false` by column default, i.e. private-pending-review, invisible to anon/authenticated until an administrator explicitly approves or assigns one (never a bulk operation — see `scripts/assign-strategy-owner.mjs`).

**2. `20261118120100_add_openai_usage_tracking.sql`**:
```sql
CREATE TABLE IF NOT EXISTS public.openai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  path text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  upstream_status integer
);
CREATE INDEX IF NOT EXISTS openai_usage_user_id_requested_at_idx ON public.openai_usage (user_id, requested_at DESC);
REVOKE ALL ON public.openai_usage FROM anon, authenticated;
ALTER TABLE public.openai_usage ENABLE ROW LEVEL SECURITY;
```

**3. `20261118120200_provision_app_role.sql`** — least-privilege, provisions `traffic_strategy_map_app`:
```sql
CREATE ROLE traffic_strategy_map_app LOGIN;
GRANT CONNECT ON DATABASE postgres TO traffic_strategy_map_app;
GRANT USAGE ON SCHEMA adveser_core TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.user_product_entitlements TO traffic_strategy_map_app;
GRANT USAGE ON SCHEMA public TO traffic_strategy_map_app;
GRANT INSERT ON public.openai_usage TO traffic_strategy_map_app;
```
**Immediately after this file runs**: `ALTER ROLE traffic_strategy_map_app PASSWORD '<generate one, never commit it>';` — out of band, by hand, in the SQL editor or psql directly, never in a file. This password is the one piece `TRAFFIC_STRATEGY_MAP_DB_URL` needs that isn't in this repo at all. The only grant touching `adveser_core` is a single `SELECT` on one specific table — that schema itself is never altered.

**4. `20261118140000_add_durable_openai_quota.sql`**:
```sql
CREATE TABLE IF NOT EXISTS public.openai_quota (
  user_id uuid NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
REVOKE ALL ON public.openai_quota FROM anon, authenticated;
ALTER TABLE public.openai_quota ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.openai_quota TO traffic_strategy_map_app;
```

**5. `20261118130000_add_oauth_rls_probe_table.sql`** — **optional**, only if you intend to re-run the standalone OAuth/RLS compatibility test; not required for production and safe to skip entirely.

Nothing above touches any table or schema other than `public.strategies`, the two new `public.openai_*` tables, and one `SELECT` grant on `adveser_core.user_product_entitlements` — no other Supabase schema is modified.

### Post-migration verification (run immediately after, still read-only)
Re-run preflight queries 2a–2c: expect 10 columns on `strategies` now (8 original + `user_id` + `is_demo`), the 4 new policy names from `pg_policies` and **zero** rows named `"Allow all"`, and the same 3 row ids from 2c still present with unchanged `name`/`created_at`.

**STOP HERE.** Nothing in Step 2 has been executed. Explicit approval is required before any statement above runs against the real project.

## Step 3 — Coordinated deployment (after Step 2 approval and execution)

1. Apply the approved migrations in the agreed maintenance window (Step 2, in the exact order given).
2. Re-run the post-migration verification queries above; confirm clean.
3. Merge `feature/auth-003a-security-and-sso-prep` into whatever branch Render deploys from (Step 1.5), then deploy the Render backend. Per `server.js`'s own fail-closed design, `/api/openai` and `/api/strategies` only activate once every required env var (Step 1.4) is confirmed present — deploying before Step 2 finishes is survivable (routes simply stay inactive), but do not rely on that as a substitute for doing Step 2 first.
4. Merge `invf/adveser-platform`'s branch similarly if any of ITS changes are needed for this step (its `ssoStartUrl` activation is explicitly Step 3.6, last — the gateway-prep commits so far don't need their own merge until then). Deploy the Vercel frontend (the `vercel.json` rewrites) in the **same window** as step 3 — not before, not long after. The old `.vercel.app` URL keeps working throughout for anyone still using it directly.
5. Verify OAuth login and session-cookie delivery for real (Step 4's smoke tests) before telling anyone it's live.
6. **Only after the product works independently** (Step 4 passes in full): merge and deploy `adveser-platform`'s `ssoStartUrl`/`url` activation, so `/account/products` and `/go/traffic-strategy-map` start routing entitled users through the new flow.

**Avoid leaving restrictive RLS live against the OLD anonymous frontend for an extended period**: once Step 2's migration lands, the *old* frontend's anonymous Save/Load immediately starts failing RLS (no `user_id` to satisfy `WITH CHECK`) — this is exactly why step 3 (new frontend) must follow step 2 within the same coordinated window, not as a separately-scheduled follow-up. If the new frontend deploy must slip for any reason after the migration has already landed, the fastest safe mitigation is the rollback plan's write-suspension procedure (Step on rollback, below) — not reverting the migration.

## Step 4 — Production smoke tests

| # | Check | How |
|---|---|---|
| 1 | ADVESER Account login | Sign in at `https://traffic-map.adveser.com` end to end |
| 2 | Traffic Strategy Map SSO | `/auth/sso/start` → Supabase consent → `/auth/sso/callback` → lands back signed in, no `sso_error` |
| 3 | Session persistence | Refresh the page; still signed in (no re-redirect) |
| 4 | Product entitlement | Sign in as an account **without** the `traffic_strategy_map` entitlement; confirm `/api/strategies` returns `403`, not success |
| 5 | Strategy create/save/load/update/delete | As an entitled account: create one, reload and confirm it's listed, edit it and confirm the change persists, delete it and confirm it's gone |
| 6 | Anonymous and cross-user access denial | A logged-out request to `/api/strategies` → `401`; a second entitled account cannot see or modify the first account's strategy (`404`, per the RLS-invisible convention already proven) |
| 7 | AI usage and quota enforcement | Trigger AI generation a few times; confirm `public.openai_quota` gets one row per `(user_id, day)` with `count` incrementing, and that exceeding the configured daily limit returns `429` |
| 8 | Logout | `POST /auth/sso/logout`; confirm the session cookie is cleared and a subsequent `/api/strategies` call is `401` |
| 9 | No access to other users' strategies | Same as #6, stated as its own explicit pass/fail |
| 10 | All 3 original strategies preserved | `SELECT id, name FROM public.strategies WHERE id IN (<the 3 ids captured in Step 2's preflight 2c>);` — all 3 still present, `name` unchanged |

## Step 5 — Administrator access (prepared, not executed; not automatic)

Exact targeted grant for **one specific, named administrator account** — never a bulk operation, never driven by matching email patterns, mirroring this engagement's standing `scripts/assign-strategy-owner.mjs` discipline:

```sql
-- Run this FIRST, to see whether a row already exists for this exact admin:
SELECT user_id, product, status FROM adveser_core.user_product_entitlements
WHERE user_id = '<the administrator''s real auth.users.id>' AND product = 'traffic_strategy_map';

-- If NO row came back:
INSERT INTO adveser_core.user_product_entitlements (user_id, product, status)
VALUES ('<the administrator''s real auth.users.id>', 'traffic_strategy_map', 'active');

-- If a row DID come back, with a status other than 'active', update
-- that ONE row by its own exact user_id + product, never a broader WHERE:
UPDATE adveser_core.user_product_entitlements
SET status = 'active'
WHERE user_id = '<the administrator''s real auth.users.id>' AND product = 'traffic_strategy_map';
```
No other row, account, or product's entitlement is touched by any of the three statements above. Not run this session — requires the administrator's real `auth.users.id` (not their email; resolve that first, separately, the same way `scripts/assign-strategy-owner.mjs` already requires for strategy ownership) and your explicit go-ahead.

## Deliverables

### 1. Final deployment checklist
Steps 1 (done, except the two access-limited manual checks) → 2 (approval required) → 3 (in order, same-window pairing as noted) → 4 (full pass required before step 3.6) → 5 (separate, your call, any time after the product is live).

### 2. Exact production migration plan
Step 2 above, in full — preflight, backup, the 4 required files' exact SQL in order, post-migration verification. Migration 5 (`oauth_rls_probe`) optional.

### 3. Render and Vercel deployment requirements
Step 1.3–1.5 above: `vercel.json` already correct and committed; env var names enumerated (presence on the real services unverifiable from this session — manual check required); **the unmerged-feature-branch issue is the one deployment requirement most likely to block you if unaddressed** — resolve the merge strategy before attempting step 3.3.

### 4. Administrator entitlement grant procedure
Step 5 above — prepared, parameterized, not executed.

### 5. Rollback plan preserving RLS
Unchanged from `docs/AUTH_003A_ROLLBACK_PROCEDURES.md`, re-confirmed this session (the stale comment pointing at the unsafe alternative is now removed from the migration file itself, Step 1.1): **never** `DISABLE ROW LEVEL SECURITY`. Use (A) `REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;` to suspend writes while reads/isolation stay intact, lifted with the matching `GRANT`; or (B) fix one specific broken policy in place (`DROP POLICY` + `CREATE POLICY`). Backend rollback (any step): redeploy the prior Render commit — no database state depends on it. Frontend/proxy rollback: revert the Vercel deploy to the pre-`vercel.json`-rewrite build.

### 6. GO / NO-GO

**GO** — on Step 1 (both code and branch/config state), Step 2's plan (fully prepared and twice rehearsed against a real corrected local stack this and the prior session, 182+19+48 assertions passing), and Step 5's procedure (ready whenever wanted).

**NO-GO, pending three things only you can resolve**:
1. **Confirm the Render service's connected branch**, and merge `feature/auth-003a-security-and-sso-prep` into it if it isn't already what Render deploys from — nothing in Step 3 can start without this.
2. **Confirm the Render environment variable values are actually present** (names enumerated above; this session has no access to check).
3. **Explicit approval to execute Step 2's SQL** against the real project, after a fresh verified backup.

Stopping at the first production-changing approval checkpoint, as instructed.
