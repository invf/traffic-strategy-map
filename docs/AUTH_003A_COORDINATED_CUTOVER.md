# AUTH-003A-3 — Coordinated Release Sequence

**Core rule, unchanged from the ticket's instruction**: the protected `/api/openai` endpoint and the new restrictive RLS on `public.strategies` must not land ahead of a working authenticated frontend, *unless* the temporary service restriction (Mode 2, `TEMPORARY_SHARED_SECRET`) is separately approved as an interim step. Below is the one sequence that satisfies this for every piece, in order, with what each step preserves.

## 0. Before anything else

- Fresh backup (`node scripts/backup-strategies.mjs`) — already taken twice this session, byte-identical, confirming no production drift. Take one more immediately before step 2.
- Decide Mode 1 vs Mode 2 for `/api/openai` *before* deploying the backend at all (`server.js` now refuses to start otherwise — see `docs/AUTH_003A_SETUP_CHECKLIST.md`).

## 1. Central ADVESER entitlement

Nothing to do here specifically for this release — the `traffic_strategy_map` entitlement key already exists in the central gateway (confirmed in the AUTH-003 audit). No entitlements are granted automatically by anything in this branch, and none should be until a real account needs one for testing (your call, not automated).

## 2. Database migrations (apply in this exact order)

1. `20261118120000_add_strategy_ownership.sql` — adds `user_id`/`is_demo` to `public.strategies`. **All 3 existing strategies are preserved untouched** — this is additive only, `is_demo DEFAULT false` means they become private-pending-review, never auto-classified, never auto-assigned (confirmed by the executed local rehearsal, not just the SQL's intent).
2. `20261118120100_add_openai_usage_tracking.sql` — `public.openai_usage`.
3. `20261118120200_provision_app_role.sql` — the `traffic_strategy_map_app` role (set its password out of band immediately after).
4. `20261118140000_add_durable_openai_quota.sql` — `public.openai_quota`, if adopting the durable quota now rather than later.
5. `20261118130000_add_oauth_rls_probe_table.sql` — only when you're ready to run the OAuth/RLS test.

**At this point**: the frontend hasn't changed yet, so real anonymous visitors keep using the app exactly as today — `public.strategies` has new RLS, but the frontend's existing anonymous Save/Load calls will now start failing RLS checks (since anon has no `user_id` to satisfy `WITH CHECK`). **This is the one step that DOES change current behavior before the frontend catches up** — see the explicit call-out below.

## 3. OAuth client configuration

Register the client (`docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`), run the two-step OAuth/RLS test (`supabase/oauth_test/`) for real, resolve the one open empirical question before building anything on top of an assumption.

## 4. Traffic Strategy Map SSO (new work, not yet built)

The receiving endpoint (this app's own `/auth/sso/start` + `/auth/callback`-equivalent), informed by whichever way step 3 comes out (`setSession()`-based if it checks out; a Launch-Studio-style first-party session if it doesn't).

## 5. Authenticated frontend (new work, not yet built)

The UI that actually uses the identity from step 4 — sign-in state, "your strategies" vs "demo strategies" distinction, error handling for the new auth-required states.

## 6. Private strategy ownership + RLS — only truly "live" once step 5 ships

This is the call-out from step 2: applying the migration changes the *database's* behavior immediately, but it only changes what *real users experience* once the frontend (step 5) knows how to authenticate and pass a real session along. Between step 2 and step 5 shipping, anonymous Save/Load in the current frontend would start failing (RLS rejects writes with no `user_id`) — **this is exactly the gap the ticket's "do not deploy restrictive RLS ahead of a working authenticated frontend" instruction is about.**

**Resolution**: either (a) hold applying the migration until step 5 is ready to ship in the same deployment window (a brief, coordinated cutover, not a long gap), or (b) if the migration needs to land earlier for other reasons, temporarily relax the INSERT/UPDATE policies to also allow `user_id IS NULL` writes (preserving today's anonymous-write behavior) until step 5 ships, then tighten them in a follow-up migration once the frontend is live. Recommend (a) — it's a smaller number of moving parts and was already the plan; noting (b) only because the ticket explicitly asks this sequencing question to be answered, not assumed.

## 7. Protected OpenAI API

Already built and tested (`backend/middleware/requireAuth.js` + `requireEntitlement.js`), gated by the Mode 1/Mode 2 choice from step 0. Mode 1 only becomes meaningful once step 4 exists (a real client issuing real scoped tokens) — until then, Mode 2 is the one that actually restricts access.

## 8. Quotas and usage accounting

Ship with the in-memory limiter (already honestly documented as not a guaranteed ceiling) or adopt the durable Postgres-backed one (`backend/lib/quota.js`, proven under real concurrency) — either is compatible with steps 3–7; the durable one just needs its own migration (step 2.4) applied first.

## 9. Rollback

- **Pre-cutover** (before step 6 is truly live, i.e. before real owned rows exist): drop the ownership columns — already executed and verified against a local rehearsal stack.
- **Post-cutover** (real owned rows exist): `DISABLE ROW LEVEL SECURITY` alone, never drop the columns — preserves every row's real ownership for later re-enablement. Full detail: `docs/AUTH_003A_ROLLBACK_PROCEDURES.md`.
- Backend rollback (any mode): redeploy the prior commit — no database state depends on the backend's own code being live.

## Preserving the 3 existing strategies through all of this

Confirmed at every step above: the ownership migration never deletes or reclassifies them (step 2), the rollback procedures never destroy real ownership metadata once it exists (step 9), and nothing in this sequence ever requires touching them directly. Two independent backups already taken, byte-identical.
