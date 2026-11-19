# AUTH-003C — Final Coordinated Release Preparation

Continuing with all database-side work now confirmed complete (`openai_usage`, `traffic_strategy_map_app` with verified Session Pooler connectivity, `openai_quota`, all 5 grants, `TRAFFIC_STRATEGY_MAP_DB_URL` saved in Render — not deployed). `public.strategies` still has its original `"Allow all"` policy; that one remaining migration is the last database step, timed deliberately with the cutover (Task 5). **Nothing in this document has been executed** — no merge, no deploy, no SQL.

## Task 1 — Remote branch tips (freshly re-verified, not cached)

| Repo | Feature branch | Tip | Default branch (confirmed via `gh repo view`) | Tip |
|---|---|---|---|---|
| `invf/traffic-strategy-map` | `feature/auth-003a-security-and-sso-prep` | `2580654a7a8d60bc86226eb6d55eb5276697b8c4` | `master` | `c5dabca5dd3548f4deed7788b55366ef3301bdf1` |
| `invf/adveser-platform` | `feature/auth-003b-traffic-map-sso-prep` | `f8fbf06230f528ceccff26ed6957a1163a7b8a95` | `main` | `cea1494f895e4e6844ea406bdc191e3c1317b54c` |

Both via `git fetch` + `git ls-remote`, independent of local cache.

## Task 2 — Merge preparation

**Both are clean fast-forwards — confirmed, not assumed**: `git merge-base --is-ancestor <default> <feature>` returns true for both repos (the default branch hasn't moved at all since each feature branch was cut — 0 commits on either default branch that aren't already in its feature branch). `git merge-tree` against each produces no real conflict (the only occurrences of the literal word "CONFLICT" in the diff are `INSERT ... ON CONFLICT ...` SQL clause text in the new files, not git conflict markers). Neither repo has branch protection configured, and neither has an existing open PR for these branches.

**Prepared, not executed** — exact commands, either approach works since nothing blocks a direct push:
```bash
# invf/traffic-strategy-map: feature/auth-003a-security-and-sso-prep -> master
gh pr create --repo invf/traffic-strategy-map \
  --base master --head feature/auth-003a-security-and-sso-prep \
  --title "AUTH-003A/B/C: Traffic Strategy Map SSO, strategies proxy, entitlement fix" \
  --body "17 commits - see docs/AUTH_003A_FINAL_CHECKLIST_AND_GO_NOGO.md and docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md for the full record."
# then, once reviewed: gh pr merge --repo invf/traffic-strategy-map <PR#> --ff-only

# invf/adveser-platform: feature/auth-003b-traffic-map-sso-prep -> main
gh pr create --repo invf/adveser-platform \
  --base main --head feature/auth-003b-traffic-map-sso-prep \
  --title "AUTH-003B: prepare Traffic Strategy Map gateway (ssoStartUrl not yet activated)" \
  --body "Adds split-origin gateway support (ssoStartUrl field) - deliberately NOT set on any product yet; see field's own comment in lib/products.ts."
```
Merging `adveser-platform`'s branch does **not** activate anything by itself — `ssoStartUrl` remains unset on the product entry (confirmed again this session, still only in comments); that field is set in its own, separate, later step, after the product is confirmed working (Step 3.6 of `docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md`). Safe to merge now, ahead of the Traffic Strategy Map cutover itself, if you'd rather get it out of the way — or merge it alongside, your call either way since it's inert either way.

**Neither command above has been run.** This is the first real decision point — see "First action requiring approval" at the end of this document.

## Task 3 — Render auto-deploy (manual check — no dashboard/API access this session)

Merging `feature/auth-003a-security-and-sso-prep` into `master` **will trigger an automatic deploy** if Render's "Auto-Deploy" setting for this service is on (Render's default for a service connected to a branch). Since `master` is confirmed as the connected branch, merging before checking this setting risks exactly the unintended early deployment the ticket is asking to prevent. **Before running Task 2's merge**:
1. Render Dashboard → the `traffic-strategy-map` service → Settings → confirm whether "Auto-Deploy" is Yes or No for the `master` branch.
2. If Yes: either turn it off temporarily (merge, verify, turn back on, then manually trigger the deploy when ready), or be prepared for the merge itself to start the deploy immediately — in which case the merge and the deploy become the same event, and you should only run it once every other precondition (Vercel ready, migration timing decided) is also satisfied.
3. If No: merging is safe with respect to this specific risk; the deploy stays a separate, later, manually-triggered action.

Cannot be checked or changed from this session — no Render dashboard/API credential available.

## Task 4 — Vercel settings and same-origin proxy (manual check for dashboard settings; proxy config itself re-confirmed from the repo)

**Re-confirmed directly from the repo** (not repeating the earlier audit, just citing its already-verified conclusion): `vercel.json`'s rewrites proxy `/api/*` and `/auth/*` to the verified live Render hostname, ordered ahead of the SPA fallback, with the rewrite-caching opt-out header rule present — unchanged since it was last verified.

**Cannot be checked from this session** (no Vercel dashboard/API access):
1. Confirm `traffic-map.adveser.com` is still showing "Valid Configuration" (per your own earlier confirmation) immediately before cutover, not just once in the past.
2. Confirm Vercel's own auto-deploy-on-push setting for whichever branch its production environment is wired to, same reasoning as Task 3 — if Vercel is watching the *frontend's* default branch and that also needs a merge first, the same "merge triggers deploy" risk applies there too.
3. Confirm `VITE_API_URL` is unset (or absent) in the Vercel project's environment variables for Production — its absence is what makes the frontend use relative, same-origin paths; a leftover value would silently revert to the old cross-origin behavior.

## Task 5 — Confirm the final `public.strategies` migration timing

Confirmed: `20261118120000_add_strategy_ownership.sql` is the **only** remaining database step (all four others are done). It should run **immediately before, or together with, the backend+frontend cutover deploy** — not independently ahead of time. Reasoning, unchanged from the prior checklist: this is the one migration with an immediate user-facing effect (the *old*, still-live anonymous frontend's Save/Load starts failing RLS checks the moment it runs, since anon has no `user_id` to satisfy `WITH CHECK`); minimizing that window means running it right before the new frontend (which knows how to authenticate) actually replaces the old one. The 3 existing rows' preservation is not a factor either way (confirmed disposable test data) — this is purely about not breaking the *currently live* anonymous save feature for any real visitor between the migration and the new deploy.

## Task 6 — Smoke tests (tightened to the five named areas; full list already in `docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md`'s Step 4)

| Area | Exact check |
|---|---|
| **OAuth** | `curl -I https://traffic-map.adveser.com/auth/sso/start` → `302` to the Supabase authorize endpoint (not `404`, not `sso_error=config_error`). Complete one real sign-in end to end; confirm the callback lands back signed in with no `sso_error` query param. |
| **Entitlement** | Sign in as an account **without** `traffic_strategy_map` → any `/api/strategies` call → `403`. Sign in as one **with** it (or the administrator grant, once run) → `200`. |
| **Session cookies** | After sign-in, inspect via devtools: cookie is `HttpOnly`, `SameSite=Lax`, `Secure`, no explicit `Domain` (host-only). Refresh the page → still signed in. Leave the tab open past 15 minutes, then act → the background silent-refresh (already built, `src/lib/api.js`) keeps the session alive without forcing re-login. |
| **Strategies** | As an entitled account: create, reload and confirm it's listed, edit and confirm the change persists, delete and confirm it's gone. As a second entitled account: confirm the first account's strategy is invisible (`404`, not `403` — the RLS-invisible convention already proven). |
| **OpenAI quota** | Trigger AI generation a few times; `SELECT * FROM public.openai_quota WHERE user_id = '<the test account>';` shows one row per `(user_id, day)` with `count` incrementing; exceeding the configured daily limit returns `429`, not a silent pass-through. |

## Task 7 — Database role runtime access, including sequence permissions

**Already empirically answered, not re-tested** (per "avoid repeating completed audits" — this exact question was already proven, not just reasoned about, in the Task 3 rehearsal for the prior ticket): `public.openai_usage.id` is `bigint GENERATED ALWAYS AS IDENTITY`, not a classic `SERIAL`/user-visible sequence. PostgreSQL's identity-column implementation does **not** require a separate `USAGE`/`SELECT` grant on the underlying sequence for a plain `INSERT` that lets the identity column auto-generate (unlike `SERIAL`, where a role calling `nextval()` directly, or doing `INSERT ... RETURNING` against a manually-created sequence, would need one) — table-level `INSERT` is sufficient. This was directly confirmed by running the real `recordUsage()` function (a plain `INSERT INTO public.openai_usage (user_id, path, requested_at, status, upstream_status) VALUES (...)`, no reference to `id` or `nextval()`) as the real `traffic_strategy_map_app` role, with only its documented 5 grants and no sequence-specific grant — it succeeded. No correction needed; `provision_app_role.sql`'s existing `GRANT INSERT ON public.openai_usage` is already sufficient for everything this role's actual runtime code does. `public.openai_quota`'s primary key is a plain composite `(user_id, day)`, not identity-generated at all, so this question doesn't apply to it.

## The release sequence, in order

1. **(You)** Check Render's Auto-Deploy setting for `master` (Task 3) and Vercel's equivalent + `VITE_API_URL` absence (Task 4) — resolve whatever each shows before step 2.
2. **(Approval needed)** Merge both feature branches (Task 2's prepared commands) — `adveser-platform`'s is inert and can happen any time in this sequence; `traffic-strategy-map`'s may itself trigger a deploy depending on step 1's finding.
3. **(Approval needed, if not already triggered by step 2)** Deploy the Render backend and the Vercel frontend together, in the same window.
4. **(Approval needed)** Apply `20261118120000_add_strategy_ownership.sql` (Task 5) — immediately before or during step 3, not independently ahead of it.
5. Run Task 6's smoke tests in full.
6. Only once step 5 passes: activate `adveser-platform`'s `ssoStartUrl` (a one-line field set + its own small deploy).
7. Prepare and run the administrator entitlement grant (`docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md`'s Step 5 SQL) whenever convenient after step 3 — independent of the rest.

## First action requiring approval

**Merging `invf/traffic-strategy-map`'s `feature/auth-003a-security-and-sso-prep` into `master`** (Task 2's first prepared command) is the first production-changing action in this sequence that this session is capable of executing once you approve it — everything before it in the list above (Tasks 3/4's dashboard checks) is manual, for you, regardless of approval. Confirm Render's Auto-Deploy setting first (Task 3) so you know whether approving this merge also means approving an immediate deploy, or a separate, later, deliberate one.
