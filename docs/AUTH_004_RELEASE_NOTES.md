# AUTH-004 — Unified Cloud Projects: Release Notes

**Merged to `master`**: `86dc560e1dabf2834180c0be1264c1501a41ceed` (fast-forward from `69002e6`, the AUTH-003C TLS fix). **Not deployed.** Render and Vercel Auto-Deploy must both be confirmed OFF before any manual deploy below (last known state: both confirmed OFF during AUTH-003C's cutover prep — re-verify in each dashboard, this session has no way to check it directly).

## What changed

Makes the authenticated cloud `strategies` table the single source of truth for the project switcher across browsers/devices, replacing the previous localStorage-only "projects" list for authenticated users. Local Drafts (unauthenticated, localStorage-only) are untouched and remain fully independent. Full technical detail is in the two merge commits' own messages (`git log -2`).

**No new SQL migration. No RLS change. No new Render/Vercel environment variable.** The one backend change (`PATCH /api/strategies/:id` gaining an optional `expected_updated_at` for optimistic concurrency) is additive and backward-compatible — omitting the field behaves exactly as before this release.

## Known limitation — full integration rehearsal not executed live

`backend/rehearsal_strategies_proxy.mjs` (real two-user, real Supabase Auth + PostgREST + RLS, via a local disposable Supabase/Docker stack) is written, extended with a concurrent-edit scenario for this release, and ready to run — but **Docker Desktop would not start** in the development environment this release was built in, even after a WSL reset. It has **not** been executed against the real PostgREST/GoTrue stack.

**What was verified instead, for real, without Docker:**
- `backend/rehearsal_native_pg_concurrency.mjs` — a standalone PostgreSQL 18 installation (no Docker) ran the exact RLS policies from `supabase/migrations/20261118120000_add_strategy_ownership.sql` verbatim, with two genuinely concurrent live connections racing the same row's conditional `UPDATE`. Proves, at the real database level: exactly one of two simultaneous conditional saves wins, the loser affects zero rows (no lost update), RLS still filters out a cross-user attempt regardless of the timestamp match, and a raw cross-user `INSERT` is rejected by `WITH CHECK` independent of the backend's own logic. 9/9, repeatable.
- 40 backend unit tests (mocked PostgREST) + 42 frontend tests (`vitest`), covering every other required scenario at the application-logic level.

**What remains unverified**: PostgREST's own HTTP-to-SQL translation and Supabase Auth/GoTrue's real JWT issuance, end to end, as one real flow. Run `node backend/rehearsal_strategies_proxy.mjs` against a local Supabase stack (`npx supabase start`) the next time Docker is available in a dev environment — no code changes needed first. Until then, the **Production smoke test below** is this release's only real end-to-end confirmation, and must be run before telling anyone this feature is live.

## Deployment instructions (manual — Auto-Deploy stays off)

1. **Render**: Dashboard → `traffic-strategy-map` (or `traffic-strategy-backend`, per its configured service name) → **Manual Deploy** → **Deploy latest commit** (deploys `master` @ `86dc560e1dabf2834180c0be1264c1501a41ceed`). Wait for it to report live/healthy — `/health` returning `{"status":"ok"}` is the quick confirmation.
2. **Vercel**: Dashboard → the project → **Deployments** → find or trigger the deployment built from `master`'s current tip (same commit) and **Promote to Production** (or **Redeploy** targeting Production, whichever the UI offers for this commit).
3. Backend before frontend is the safer order (not strictly required — the new field is additive — but matches this project's established sequencing).

## Production smoke test (authorized test account, disposable test strategies only)

Run this after both deployments report healthy, before considering the feature live:

1. Sign in with the authorized test account via SSO on the live domain.
2. If the account has no existing cloud strategies, create one disposable one via **Save to Cloud**; confirm it appears in the switcher's Cloud section.
3. Load it; confirm the switcher's active indicator follows the loaded project (the ticket's bug #5). Edit something and **Save** (not *Save as New*); confirm it updates the same row (PATCH), not a new one.
4. In a second browser (or a private/incognito window), sign in with the **same** test account; confirm the identical cloud project list appears (cross-browser consistency).
5. **The one live proof the Docker-dependent rehearsal would otherwise have given**: in browser A, edit and Save the test project. Without refreshing browser B, edit the same project there (now holding a stale `updated_at`) and attempt Save — confirm the conflict panel appears (409) with Reload/Overwrite options, never a silent overwrite.
6. Sign out; confirm the Cloud section disappears from the switcher and any Local Draft remains untouched and usable.
7. **Delete the disposable test strategy/strategies created in this smoke test** — never leave test data in Production.
8. Confirm Local Draft creation/switching still works with no sign-in at all (regression check).

## Pre-deploy checklist

- [ ] Render Auto-Deploy confirmed OFF (re-verify in dashboard)
- [ ] Vercel automatic Production Deploy confirmed OFF (re-verify in dashboard)
- [ ] Render manual deploy of `86dc560` completed and healthy
- [ ] Vercel manual promote of `86dc560` completed
- [ ] Smoke test above completed and passed
- [ ] Smoke-test disposable strategies deleted
