# AUTH-003A/B — Coordinated Release Sequence

**Core rule, unchanged from the ticket's instruction**: the protected `/api/openai` endpoint, the strategies proxy, and the new restrictive RLS on `public.strategies` must not land ahead of a working authenticated frontend. There is no longer an approved interim alternative that relaxes this — the temporary shared-secret design (`TEMPORARY_SHARED_SECRET`, "Mode 2") was reviewed and rejected (`docs/AUTH_003A_SHARED_SECRET_REVIEW.md`): `src/services/openai.js` calls the backend directly from the browser via a Vite-inlined `VITE_API_URL`, so any secret placed there would leak into the public bundle the same way an API key would. The only pre-OAuth-client state is `requireDisabled` — 503 for every request, OpenAI never called, no secret anywhere. Below is the one sequence that satisfies the ticket's ordering instruction for every piece, now that AUTH-003B's SSO backend and frontend are actually built (not still a proposal).

## 0. Before anything else

- Fresh backup (`node scripts/backup-strategies.mjs`) — already taken multiple times this session, byte-identical, confirming no production drift. Take one more immediately before step 2.
- Nothing to "decide" about `/api/openai`'s auth mode anymore — there is exactly one real mode (SSO cookie via `requireSsoAuth`) and one disabled state (`requireDisabled`), chosen automatically by `server.js` based on whether `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` and `TRAFFIC_STRATEGY_MAP_SESSION_SECRET` are all set. `server.js` also now refuses to start at all without `FRONTEND_URL`.

## 1. Central ADVESER entitlement

Nothing to do here specifically for this release — the `traffic_strategy_map` entitlement key already exists in the central gateway (confirmed in the AUTH-003 audit). No entitlements are granted automatically by anything in this branch, and none should be until a real account needs one for testing (your call, not automated).

## 2. Database migrations (apply in this exact order)

1. `20261118120000_add_strategy_ownership.sql` — adds `user_id`/`is_demo` to `public.strategies`. **All 3 existing strategies are preserved untouched** — this is additive only, `is_demo DEFAULT false` means they become private-pending-review, never auto-classified, never auto-assigned (confirmed by the executed local rehearsal, not just the SQL's intent).
2. `20261118120100_add_openai_usage_tracking.sql` — `public.openai_usage`.
3. `20261118120200_provision_app_role.sql` — the `traffic_strategy_map_app` role (set its password out of band immediately after).
4. `20261118140000_add_durable_openai_quota.sql` — `public.openai_quota`. No longer optional (see step 8) — apply it in this release, not deferred to "later."
5. `20261118130000_add_oauth_rls_probe_table.sql` — only when you're ready to run the OAuth/RLS test.

**At this point**: the frontend hasn't changed yet (if deployed out of order — don't; see step 6), so real anonymous visitors keep using the app exactly as today — `public.strategies` has new RLS, but the frontend's existing anonymous Save/Load calls will now start failing RLS checks (since anon has no `user_id` to satisfy `WITH CHECK`). **This is why step 2 and step 6 must ship in the same deployment window**, not step 2 alone.

## 3. OAuth client configuration

Register the client (`docs/AUTH_003A_OAUTH_CLIENT_SETUP.md` — now updated for AUTH-003B's redirect URI, which points at this backend's own `/auth/sso/callback`, not the frontend), then run the two-step OAuth/RLS test (`supabase/oauth_test/`) for real, resolving the one open empirical question (`setSession()` compatibility) before trusting any assumption about it. AUTH-003B's own design does not need this answered to work (see step 4) — the test still matters as verification, not as a blocking dependency.

## 4. Traffic Strategy Map SSO — built this release (AUTH-003B)

`backend/routes/ssoRoutes.js` (`/auth/sso/start`, `/auth/sso/callback`, `/auth/sso/session`, `/auth/sso/logout`) plus `backend/auth/{pkce,oauthClient,ssoSession,ssoState}.js`. Deliberately does **not** depend on `setSession()` working in the browser: the OAuth access/refresh tokens are cached server-side only (`ssoSession.js`'s `cacheAccessToken`/`getCachedAccessToken`), and the browser gets only this app's own opaque, HttpOnly, `SameSite=None; Secure` session cookie. 133 unconditional test assertions (`backend/tests/{pkce,ssoRoutes,requireSsoAuth,strategiesProxy}.test.mjs`).

## 5. Authenticated frontend — built this release (AUTH-003B)

`src/components/AccountButton.jsx` (sign-in/out in the TopBar), `src/hooks/useAuth.js` + `src/services/auth.js` (session state via `GET /auth/sso/session`), and `src/components/StrategiesModal.jsx` rewritten to call `src/services/strategies.js` (the authenticated proxy) instead of supabase-js directly — `src/lib/supabase.js` is deleted; the browser no longer holds a Supabase client or key of any kind. Signed-out state shows a dedicated "Sign in required" prompt and never attempts a strategies request (verified). `sso_error` redirect codes render a translated banner in `App.jsx`. Verified end-to-end against a local backend + Vite dev server (sign-in redirect round-trip, signed-out gate, `/api/openai` 503 fail-closed path) — see this session's commit for the specific checks run.

## 6. Private strategy ownership + RLS — only truly "live" once step 5 ships

This is the call-out from step 2: applying the migration changes the *database's* behavior immediately, but it only changes what *real users experience* once the frontend (step 5, now built) is actually deployed and able to authenticate. Between step 2 landing and step 5 deploying, anonymous Save/Load in the OLD frontend would start failing (RLS rejects writes with no `user_id`) — **this is exactly the gap the ticket's "do not apply migrations before the authenticated frontend is ready" instruction is about.**

**Resolution**: deploy step 2's migrations and step 4/5's backend+frontend together, in the same deployment window — a brief, coordinated cutover, not a staged one. Step 5's frontend is now ready; nothing here is still pending on "new work."

## 7. Protected OpenAI API

Already built and tested (`backend/middleware/requireSsoAuth.js` + `requireEntitlement.js`). Only one real mode now — SSO cookie auth — selected automatically once the OAuth client and session secret are configured; `requireDisabled` otherwise. No separate "Mode 1 vs Mode 2" decision remains.

## 8. Quotas and usage accounting

The durable Postgres-backed quota (`backend/lib/quota.js`, proven under real concurrency, including a simulated backend-restart test — `backend/tests/quota.concurrency.test.mjs`) is the only option carried into this release. The in-memory limiter is no longer an acceptable alternative for a production spending ceiling and is not wired into `server.js`. Apply migration 2.4 (`20261118140000_add_durable_openai_quota.sql`) in this release, not deferred.

## 9. Rollback

- **Pre-cutover** (before step 6 is truly live, i.e. before real owned rows exist): drop the ownership columns — already executed and verified against a local rehearsal stack.
- **Post-cutover** (real owned rows exist): **never** `DISABLE ROW LEVEL SECURITY`. Use one of the two rehearsed, RLS-preserving procedures instead — (A) suspend writes via `REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;` (reads and isolation stay fully intact; lift via `GRANT` once resolved), or (B) fix the one specific broken policy in place (`DROP POLICY` + `CREATE POLICY` with corrected logic). Both proven via `supabase/rehearsal_rollback.mjs` (11/11 assertions) against a disposable local stack, including a deliberately-introduced broken policy to confirm the fix actually restores isolation. Full detail: `docs/AUTH_003A_ROLLBACK_PROCEDURES.md`.
- Backend rollback (any state): redeploy the prior commit — no database state depends on the backend's own code being live.

## Preserving the 3 existing strategies through all of this

Confirmed at every step above: the ownership migration never deletes or reclassifies them (step 2), the rollback procedures never destroy real ownership metadata once it exists and never disable RLS (step 9), and nothing in this sequence ever requires touching them directly. Two independent backups already taken, byte-identical.
