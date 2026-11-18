# AUTH-003B — Fix: Missing Strategies Entitlement Enforcement

Fixes the blocking finding from `docs/AUTH_003B_PRE_DEPLOYMENT_AUDIT.md`'s Task 4: `/api/strategies` checked authentication (`requireSsoAuth`) but never the `traffic_strategy_map` product entitlement, so any signed-in ADVESER account could use the strategies feature regardless of ownership. Nothing merged, deployed, or changed in production this session.

## Task 1 — Entitlement-only middleware

`backend/middleware/requireProductEntitlement.js` (new): reuses the existing `checkEntitlement()` from `lib/entitlements.js` — one source of truth for "does this user have the entitlement." Deliberately **not** a reuse of `requireEntitlement.js`'s `createRequireEntitlement`: that middleware's constructor requires a `checkQuota` function and always calls it, correct for `/api/openai` (a metered resource) but wrong for strategies CRUD, which has no quota concept at all — forcing one through would mean either a meaningless fake or, worse, actually consuming `/api/openai`'s own daily cap on a request that never touches OpenAI.

- Runs after `requireSsoAuth` (needs `req.userId`).
- `active` entitlement → `next()`.
- No entitlement (`none`, or entitled only to a different product — `checkEntitlement()`'s own query is scoped to `product = 'traffic_strategy_map'`, so a Launch-Studio-only account gets `none` here too) → `403`.
- Entitlement check throws, or returns `'error'` → `503`, **never** treated as granted.
- No `checkQuota` parameter exists on this middleware at all — strategies CRUD cannot consume OpenAI quota by construction, not by convention.

Mounted in `backend/app.js`:
```js
if (strategiesRouter && requireSsoAuth && requireProductEntitlement) {
  app.use(requireSsoAuth, requireProductEntitlement, strategiesRouter);
}
```
Applies to every route in `strategiesRouter` (list, get, create, update, delete) — it's middleware ahead of the whole router, not per-route. `server.js` builds it via `createRequireProductEntitlement({ checkEntitlement })` whenever `strategiesProxyConfigured` is true (same gate as before, now also requiring `TRAFFIC_STRATEGY_MAP_DB_URL` — see Task 3).

## Task 2 — Tests

`backend/tests/requireProductEntitlement.test.mjs` (new, 9 tests) — the middleware in isolation, mirroring `requireEntitlement.test.mjs`'s own pattern: construction guard, no-`req.userId` 500, active→next(), none→403, a different-product account→403, infrastructure failure (both the real `'error'` return and a thrown exception)→503, and a signature check confirming no quota parameter exists anywhere on it.

`backend/tests/strategiesEntitlement.test.mjs` (new, 14 tests) — full-stack integration via `createApp`, the real `requireSsoAuth → requireProductEntitlement → strategiesRouter` order, with a fake PostgREST `fetchImpl` to prove the ticket's specific requirements:

| # | Requirement | Covered |
|---|---|---|
| 1 | Authenticated + entitled → access | ✅ reaches PostgREST, 200 |
| 2 | Authenticated, no entitlement → 403 | ✅ |
| 3 | Entitled only to Launch Studio → 403 | ✅ |
| 4 | Unauthenticated → 401 | ✅ |
| 5 | DB/entitlement service failure → 503 | ✅ (both the real-shape `'error'` return and a thrown exception) |
| 6 | Unauthorized requests never reach PostgREST | ✅ asserted explicitly in every denial case above (401/403/503) |
| 7 | No OpenAI quota consumed | ✅ a poisoned quota function that would throw if ever called is proven never invoked, and the middleware's own constructor never accepts one |
| 8 | Existing owner-isolation tests remain green | ✅ `strategiesProxy.test.mjs` (29/29) and the real two-user rehearsals below, re-run unchanged |

Full regression after the fix: **182 unconditional backend assertions** (up from 159 before this ticket), **19 frontend assertions**, all passing. Frontend production build succeeds; backend syntax/module-resolution verified (`node --check` on every changed file, plus confirming `server.js`'s own module graph resolves cleanly and its `FRONTEND_URL` startup guard still fires correctly).

## Task 3 — Production readiness

**`TRAFFIC_STRATEGY_MAP_DB_URL` is now required for protected-API readiness**, closing the exact gap the previous audit flagged: `server.js`'s `strategiesProxyConfigured` check (and `/api/openai`'s own `oauthClientConfigured` check) now both include it explicitly. Before this fix, the startup log could claim `/api/openai running with ... per-user entitlement` while every real request 503'd the moment `checkEntitlement`'s `getPool()` threw on a missing connection string — now that misleading state is impossible; the routes simply don't mount/activate without it, same "absent, not silently degraded" discipline as every other gate in this app.

**Production migration explicitly removes the existing `"Allow all"` RLS policy on `public.strategies`.** This was a real, previously-unexamined gap in the migration itself, not just in application code: Postgres RLS policies for the same command are OR'd together, so if production's `public.strategies` has a permissive `"Allow all"` policy (as stated for this ticket) and the ownership migration only *added* new owner-scoped policies without *removing* the old one, every row would remain readable/writable by anyone regardless of how correct the new policies are — silently defeating the entire migration. `supabase/migrations/20261118120000_add_strategy_ownership.sql` now includes `DROP POLICY IF EXISTS "Allow all" ON public.strategies;` before creating the new policies (`IF EXISTS` makes it safe to run even if the real name differs or no such policy exists).

**The corrected migration was rehearsed against the actual eight-column production baseline** — `supabase/migrations/20261118115900_baseline_strategies_schema_for_rehearsal.sql` (confirmed 8 columns: `id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at`) was itself corrected to also reproduce the `"Allow all"` RLS policy (it previously modeled production's access control as bare `GRANT`s only, which made the new `DROP POLICY` statement impossible to meaningfully rehearse — nothing existed yet to drop). Three full local-stack rehearsals, executed against a disposable `supabase start`/`db reset` stack and torn down afterward:

1. **`supabase/rehearsal.mjs`** (23/23 passing) — seeds the 3 "existing, ownerless" strategies exactly as it always has, then proves: anon sees zero rows (not auto-public), two real users' RLS isolation holds in every direction (read/update/delete/insert-spoofing/demo-flag-tampering), and admin-driven demo-approval/owner-assignment both work precisely as scoped — **with the corrected migration this time**, where this exact test suite would have failed the very first assertion ("returns ZERO rows") had the `DROP POLICY` fix been missing, since the surviving `"Allow all"` policy would have made every row visible to anon.
2. **`supabase/rehearsal_rollback.mjs`** (11/11 passing) — both sanctioned rollback procedures (write-suspension via `REVOKE`, single-broken-policy fix) re-confirmed correct against the corrected baseline+migration, RLS never disabled in either scenario.
3. **`backend/rehearsal_strategies_proxy.mjs`** (14/14 passing) — the real `strategiesProxy.js` router, composed with the real corrected RLS policies and two real GoTrue users end to end, unchanged behavior from the prior session's own run of this same script.

**All three original strategies are preserved** — directly asserted in `rehearsal.mjs`'s own seeding+preservation checks (seeded as service_role-inserted ownerless rows, confirmed still present, still private-pending-review except where explicitly approved/assigned by the simulated admin, exactly matching this entire engagement's standing requirement never to delete or auto-reclassify them).

## Task 4 — Final verification

| Check | Result |
|---|---|
| Backend tests | **182/182 unconditional assertions passing** (13 test files; `quota.concurrency.test.mjs` correctly skips without `QUOTA_TEST_DB_URL`, unchanged from every prior session) |
| Frontend tests | **19/19 passing** (unaffected by this backend-only change, confirming no regression) |
| Frontend production build | Succeeds (`npm run build`) |
| Backend "build" (no bundler — syntax/module-resolution check) | `node --check` clean on every changed/new file; `server.js`'s module graph resolves and its `FRONTEND_URL` startup guard still fires correctly |
| Local two-user RLS integration tests | **48/48 real-stack assertions passing** across the three rehearsals above, executed against a disposable local Supabase stack, then torn down |

## Restrictions honored

Nothing merged or deployed. No production Supabase data, policies, roles, or secrets were changed — `supabase/migrations/20261118120000_add_strategy_ownership.sql` and `.../20261118115900_baseline_strategies_schema_for_rehearsal.sql` were edited as **files in this repo**, not executed against the real shared project; the corrected migration still has not been applied to production, same as every migration in this engagement so far. Launch Studio, Earn Studio, and Slovakia Operations were not touched. No entitlements were granted to any account, automatically or otherwise — this fix only changes what's *required* to use the feature, never grants it.

Stopping here, at the production approval checkpoint, as instructed.
