# AUTH-003B — Pre-Deployment Audit (Read-Only)

Confirmed infrastructure state going into this audit: Vercel domain `traffic-map.adveser.com` valid; Supabase OAuth client registered (client ID `fd53685f-bea6-445f-8061-5042809a8886`, redirect URI `https://traffic-map.adveser.com/auth/sso/callback`); Render backend live at `https://traffic-strategy-map.onrender.com` (unchanged from the prior session's verification); Render environment variables entered and saved, **not yet deployed**. Nothing was merged, deployed, or changed this session — this is a code/documentation review and a set of read-only SQL queries for you to run; no database connection was available to this session.

## 1. Backend environment variables (names and dependencies only — no values)

| Variable | Required for | What breaks if missing |
|---|---|---|
| `FRONTEND_URL` | Server startup itself | `server.js` calls `process.exit(1)` at boot — the whole process refuses to start |
| `PORT` | Binding | Render sets this automatically; code falls back to `3001` if absent — not a real dependency on Render |
| `OPENAI_API_KEY` | `/api/openai` | Without it, the route returns a clean `500 OPENAI_API_KEY not configured` per-request; does not block startup |
| `SUPABASE_URL` | JWT/JWKS verification (`requireAuth.js`, currently unused in the live path — see finding below), OAuth client config, strategies proxy's PostgREST target | Without it, `oauthClientConfigured` is false → `/api/openai` falls back to `requireDisabled` (503 for everything); `strategiesProxyConfigured` is also false → `/api/strategies` is not mounted at all (404) |
| `SUPABASE_ANON_KEY` | Strategies proxy's PostgREST `apikey` header | Without it, `/api/strategies` is not mounted (404), same gate as above |
| `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | All three together gate `oauthClientConfigured` | Missing any one → `/api/openai` and `/api/strategies` both stay in their disabled/not-mounted states; `/auth/sso/*` routes still exist but every `/start` or `/callback` redirects with `sso_error=config_error` instead of crashing |
| `TRAFFIC_STRATEGY_MAP_SESSION_SECRET` | Signing/verifying the first-party session cookie; also gates `sessionSecretConfigured` | Missing it → same disabled states as above, **and** any code path that tries to sign/verify a cookie throws (never reached while the gate is closed) |
| `TRAFFIC_STRATEGY_MAP_DB_URL` | `checkEntitlement`/`checkQuota` (`lib/entitlements.js`), used only by `/api/openai`'s `requireEntitlement` | **Finding, not a security hole**: `server.js`'s own startup check (`oauthClientConfigured && sessionSecretConfigured`) does **not** include this variable. If it's missing, the startup log still prints `"/api/openai running with full SSO cookie auth + per-user entitlement + durable quota"` — but the first real request fails closed with a `503 Could not verify access right now` the moment `checkEntitlement`'s lazy `getPool()` throws on the missing connection string. Functionally safe (fails closed), but the startup log is misleading until this variable is actually set — worth being aware of when reading Render's boot logs, not a correctness bug |
| `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE` | Optional. Defaults to `Lax` | Leave unset for the current same-origin-proxy architecture; only set to `None` as an explicit rollback |
| `OPENAI_DAILY_QUOTA` | Optional. Defaults to `50` | `validateDailyQuota()` throws at startup if set to something invalid (non-integer, ≤0, or >10000) — this is the one variable where a *wrong* value, not a *missing* one, blocks startup |

**Gap found**: `render.yaml` lists every variable above except `OPENAI_DAILY_QUOTA` — harmless to omit (falls back to 50), but worth adding if a non-default cap is wanted, since there's currently no documented place in the Blueprint to set it.

## 2. Production Supabase schema, RLS, roles, quota tables — read-only verification queries

No database connection was available to this session. Run these via the Supabase SQL Editor (read-only — every query below is a `SELECT`, none mutate anything):

```sql
-- 2a. public.strategies: confirm the ownership columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'strategies'
ORDER BY ordinal_position;
-- Expect: user_id (uuid, nullable) and is_demo (boolean, not null, default false)
-- among the columns, alongside the original id/name/nodes/edges/etc.

-- 2b. public.strategies: confirm RLS is actually enabled
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'strategies' AND relnamespace = 'public'::regnamespace;
-- Expect: relrowsecurity = true

-- 2c. public.strategies: confirm exactly the 4 expected policies, nothing extra or missing
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'strategies'
ORDER BY policyname;
-- Expect exactly 4 rows: "read own or approved demo" (SELECT),
-- "insert own" (INSERT), "update own" (UPDATE), "delete own" (DELETE).

-- 2d. Preserve the original 3 strategies - counts only, no row contents
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE user_id IS NULL) AS ownerless_rows,
  count(*) FILTER (WHERE is_demo = true) AS demo_rows
FROM public.strategies;
-- Expect: total_rows >= 3; the original 3 should still be among the
-- ownerless_rows unless you've since explicitly assigned an owner or
-- approved one as a public demo via scripts/assign-strategy-owner.mjs.

-- 2e. openai_usage / openai_quota / oauth_rls_probe tables: existence and RLS
SELECT c.relname, c.relrowsecurity
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('openai_usage', 'openai_quota', 'oauth_rls_probe');
-- Expect 3 rows if all migrations are applied (oauth_rls_probe is
-- optional/only needed for the standalone OAuth/RLS test), all with
-- relrowsecurity = true.

-- 2f. Confirm anon/authenticated have ZERO grants on the two accounting tables
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('openai_usage', 'openai_quota')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee;
-- Expect ZERO rows - confirms the REVOKE ALL ... FROM anon, authenticated
-- in both migrations actually took effect.

-- 2g. Confirm the dedicated app role exists with exactly its intended grants
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'traffic_strategy_map_app';

SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'traffic_strategy_map_app'
ORDER BY table_schema, table_name, privilege_type;
-- Expect exactly: adveser_core.user_product_entitlements (SELECT),
-- public.openai_usage (INSERT), public.openai_quota (SELECT, INSERT, UPDATE).
-- Nothing on public.strategies - that table is never reached by this role.

-- 2h. Confirm 'traffic_strategy_map' is a valid entitlement product value
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'adveser_core.user_product_entitlements'::regclass AND contype = 'c';
-- Confirms the CHECK constraint already includes 'traffic_strategy_map'
-- (per lib/products.ts's own comment in adveser-platform - this was
-- stated as already true in the original AUTH-003 audit, not re-verified
-- with DB access this session).

-- 2i. How many accounts (if any) are currently entitled - no PII, counts only
SELECT status, count(*) FROM adveser_core.user_product_entitlements
WHERE product = 'traffic_strategy_map' GROUP BY status;
```

If `psql`/direct access is available instead of the SQL Editor, the same queries apply unchanged.

## 3. Current feature branches and required commits

Re-verified against the remotes this session (`git fetch` + `git ls-remote`, not cached state):

**`invf/traffic-strategy-map`** — branch `feature/auth-003a-security-and-sso-prep`, remote tip:
```
04de6adcff1169a1dd159d9853007c31c13fb261
```
`master` is unaffected, at `c5dabca5dd3548f4deed7788b55366ef3301bdf1` — confirms nothing has been merged.

**`invf/adveser-platform`** — branch `feature/auth-003b-traffic-map-sso-prep`, remote tip:
```
f8fbf06230f528ceccff26ed6957a1163a7b8a95
```
`main` is unaffected, at `cea1494f895e4e6844ea406bdc191e3c1317b54c` — confirms nothing has been merged.

## 4. Strategies API entitlement enforcement — FINDING (blocking), FIXED

**FIXED**: `backend/middleware/requireProductEntitlement.js` (new) is now mounted ahead of `strategiesRouter` in `app.js`, exactly as scoped below. See `docs/AUTH_003B_FIX_STRATEGIES_ENTITLEMENT.md` for the implementation, the corrected production migration this fix also required (an explicit `"Allow all"` RLS policy removal, confirmed necessary - not cosmetic - by rehearsal), and the full test/verification results. Original finding preserved below for the record.

**The strategies API does not check product entitlement at all.** Traced the exact mount order in `backend/app.js`:
```js
if (strategiesRouter && requireSsoAuth) {
  app.use(requireSsoAuth, strategiesRouter);   // <- authentication only
}
app.post('/api/openai', requireAuth, requireEntitlement, async (req, res) => { ... });  // <- auth AND entitlement
```
`requireSsoAuth` confirms the caller is a **real, signed-in ADVESER account** (a valid session cookie). It does **not** confirm that account has the `traffic_strategy_map` entitlement. `requireEntitlement` — the middleware that actually calls `checkEntitlement()` — is wired up only for `/api/openai`, never for `/api/strategies`. Grepped `strategiesProxy.js` directly for any entitlement-related code: none exists.

**Practical consequence**: any ADVESER account that can complete the OAuth sign-in flow — including one with zero product entitlements, or one entitled only to Launch Studio or Earn Studio — can currently create, list, edit, and delete Traffic Strategy Map strategies once this backend is deployed and the OAuth client is live. This is a real authorization gap, not a theoretical one, and it is independent of everything already fixed in the prior two audits (RLS isolation between users is still correct — User A still can't see User B's strategies — but neither A nor B needs to actually own the product to use it at all).

**Not fixed in this pass** — this audit was scoped read-only; flagging it as the one concrete blocking finding for the GO/NO-GO decision below, with the fix already scoped precisely: `backend/middleware/requireEntitlement.js`'s existing `createRequireEntitlement` is hard-coupled to the OpenAI quota check (its constructor throws without a `checkQuota` function) and isn't directly reusable here — strategies CRUD has no notion of a spending quota. The fix is a small, separate entitlement-only middleware (reusing the already-existing `checkEntitlement()` from `lib/entitlements.js`, no new query needed) mounted ahead of `strategiesRouter` in `app.js`, mirroring `requireEntitlement`'s own 403/503 behavior minus the quota step. Say the word and I'll implement and test it in a follow-up.

## 5. Exact deployment order (given the current real-world state)

Picking up from where infrastructure stands today — domain and OAuth client done, Render env vars entered but not deployed:

1. **Fix the Task 4 finding first, or explicitly accept the risk.** Everything below assumes one or the other decision has been made — deploying as-is means any signed-in ADVESER account can use the strategies feature regardless of entitlement, until this is fixed in a follow-up deploy.
2. **Database migrations** (if not already applied — this session could not check; use section 2's queries to find out), in this exact order, unchanged from `docs/AUTH_003A_COORDINATED_CUTOVER.md`:
   1. `20261118120000_add_strategy_ownership.sql`
   2. `20261118120100_add_openai_usage_tracking.sql`
   3. `20261118120200_provision_app_role.sql` (set the role's password out of band immediately after — this password is the one piece of `TRAFFIC_STRATEGY_MAP_DB_URL` that doesn't come from this repo)
   4. `20261118140000_add_durable_openai_quota.sql`
   5. `20261118130000_add_oauth_rls_probe_table.sql` — only if you intend to run the standalone OAuth/RLS test; not required for production
3. **Deploy the Render backend** — the environment variables are already entered; this step is the actual deploy/restart that picks them up. Per `server.js`'s own fail-closed design, this is safe even if step 2 hasn't fully landed yet: `/api/strategies` simply won't mount (404) until `SUPABASE_URL`/`SUPABASE_ANON_KEY` are confirmed present, and `/api/openai` won't activate until the OAuth trio + session secret are all present — both already true per your report, so both should activate on this deploy.
4. **Deploy the Vercel frontend** (the `vercel.json` rewrites, the relative-URL frontend changes) — in the **same window** as step 3, not before and not long after. Deploying the frontend alone, before the backend is live with its new env vars, would mean the proxy forwards to a backend still running its OLD code/config; deploying the backend alone, before the frontend's rewrites exist, means browsers still hit the old direct `.onrender.com`/`.vercel.app` split-origin paths.
5. **Required live smoke test** (section 6 below) — confirm the whole chain actually works before telling anyone it's live.
6. **Central ADVESER Platform (`adveser-platform`)** — only after step 5 passes, deploy the `ssoStartUrl`/`url` change (already committed on its own branch, not yet activated) so `/account/products`/`/go/traffic-strategy-map` start routing entitled users through the new SSO flow. Deliberately last: activating it before step 5 confirms the product actually works would send real entitled users into a broken flow.

## 6. Smoke tests and rollback plan

### Smoke tests (run after step 3+4 above, before step 6)
1. `curl -I https://traffic-map.adveser.com/auth/sso/start` — expect a `302` to the Supabase authorize endpoint, not a `404` or `config_error` redirect.
2. Complete one real sign-in in a browser. Confirm via devtools: the session cookie is present, `HttpOnly`, `SameSite=Lax`, `Secure`, and carries **no** explicit `Domain` attribute (host-only). This is the one thing the previous session flagged as impossible to verify without a live deployment — confirm now that it's live.
3. Refresh the page. Confirm you're still signed in (no re-redirect to sign-in).
4. Save a strategy, reload, confirm it reappears in the list. Edit it, confirm the change persists. Delete it, confirm it's gone.
5. Sign in as a **second** real account with no `traffic_strategy_map` entitlement and attempt the same — if the Task 4 finding hasn't been fixed yet, this will currently succeed (expected, given the finding above) rather than being denied; if it has been fixed, expect a `403`.
6. Trigger an AI generation request; confirm it succeeds and is subject to the daily quota (check `public.openai_quota` after a few requests — one row per user per day, `count` incrementing).
7. Sign out; confirm the session cookie is cleared and a subsequent `/api/strategies` call returns `401`.

### Rollback plan — never disables RLS, never exposes private strategies
- **Frontend/proxy regression**: revert the Vercel deploy to the prior build (pre-`vercel.json`-rewrite). The backend's own env vars can stay as they are; the old split-origin frontend simply won't hit the new proxy paths.
- **Backend regression**: redeploy the prior Render commit. No database state depends on the backend's own code being live — this is always safe and reversible.
- **Database rollback, if ownership/RLS needs to be walked back after real users have real owned rows**: per `docs/AUTH_003A_ROLLBACK_PROCEDURES.md`, which this engagement already rehearsed against a real disposable stack (11/11 assertions) — **never** `ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY`. Use one of:
  - `REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;` — suspends writes while reads and isolation stay fully intact; lift with the matching `GRANT` once resolved.
  - Fix one specific broken policy in place (`DROP POLICY` + `CREATE POLICY` with corrected logic) — for a bug in one policy's logic specifically, not a blanket rollback.
- **Entitlement-gap rollback** (if the Task 4 fix itself needs to be reverted after deploying it): redeploy the prior backend commit — this is a pure code change, no migration involved, so this alone fully reverts it.

## GO / NO-GO

**GO** — infrastructure setup (domain, OAuth client, env vars entered), code (159+14+19 tests passing across the prior two audits), and documentation are all in place and consistent with each other.

**NO-GO, pending your decision on exactly one thing**: Section 4's entitlement-enforcement gap. Everything else in this audit is a verify-and-confirm or a "run this SQL and report back" — this is the one item that changes what "deployed" actually means (anyone signed in vs. only entitled accounts). Recommend fixing it before step 3 of section 5, not after.

### Required manual actions (yours, not this session's)
1. Run section 2's SQL queries and confirm the schema/RLS/role state (migrations may or may not be applied yet — this session could not check).
2. Decide: fix the Task 4 finding first, or deploy now and fix it in an immediate follow-up.
3. Provision the `traffic_strategy_map_app` role's actual password (migration 2 above creates the role but never a password, by design) and finish assembling `TRAFFIC_STRATEGY_MAP_DB_URL` with it.
4. Execute the deployment order in section 5, then the smoke tests in section 6.
