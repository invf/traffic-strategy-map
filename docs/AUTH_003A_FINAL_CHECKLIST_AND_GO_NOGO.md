# AUTH-003A/B — Final Coordinated Deployment Checklist & GO/NO-GO

**Superseded on environment/URL specifics**: the architecture decision landed on Option B (same-origin Vercel reverse proxy, `traffic-map.adveser.com`) after this document was written — its migration sequencing and rollback guidance remain accurate, but `docs/AUTH_003B_SAME_ORIGIN_PROXY_IMPLEMENTATION.md` has the authoritative, current env var values and deployment steps (step 3 below's `FRONTEND_URL`/OAuth redirect URI values specifically are from the OLD split-origin design and should not be used).

Consolidates every AUTH-003A/B commit on `feature/auth-003a-security-and-sso-prep` through this session's final commit. Nothing below has been run against production — read-only verification only (confirmed the 3 original strategies are present and unchanged, most recently immediately before writing this document). AUTH-003B's own instruction was explicit: implement the complete integration, not another proposal, and stop only at the actual manual OAuth configuration or production approval checkpoint — that is where this document stops.

## Deployment checklist, in order

1. **Backup** — `node scripts/backup-strategies.mjs` (confirmed multiple times already this engagement, byte-identical every time).
2. **Database migrations**, in order:
   - `20261118115900_baseline_strategies_schema_for_rehearsal.sql` — **local rehearsal only, never apply to production** (production already has this table).
   - `20261118120000_add_strategy_ownership.sql`
   - `20261118120100_add_openai_usage_tracking.sql`
   - `20261118120200_provision_app_role.sql` (set the role's password out of band immediately after)
   - `20261118140000_add_durable_openai_quota.sql`
   - `20261118130000_add_oauth_rls_probe_table.sql` (only when ready to run the standalone OAuth/RLS test)
3. **Render environment** (backend) — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TRAFFIC_STRATEGY_MAP_DB_URL`, `FRONTEND_URL` (required — `server.js` now refuses to start without it), `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID`/`_CLIENT_SECRET`/`_REDIRECT_URI` (once registered — see `docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`'s "AUTH-003B production config" section), `TRAFFIC_STRATEGY_MAP_SESSION_SECRET` (a long random value, generated once), optionally `OPENAI_DAILY_QUOTA` (validated strictly at startup).
4. **Vercel environment** (frontend) — `VITE_API_URL` only. `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are no longer used by the frontend at all (`src/lib/supabase.js` is deleted) — safe to remove from the Vercel project once this ships.
5. **Backend deploy**: safe to deploy *before* the OAuth client exists — `/api/openai` and `/api/strategies` both run in their disabled/not-mounted state (503 / 404 respectively) rather than insecurely open or fake-protected by a leakable secret. The SSO router itself (`/auth/sso/*`) is always mounted and degrades gracefully (redirects with `sso_error=config_error`) rather than crashing.
6. **Frontend deploy**: also safe to deploy before the OAuth client exists — signed-out UX (the "Sign in required" prompt, the sign-in button) works regardless; it simply can't complete a real sign-in until step 3's OAuth vars are set on the backend.
7. **OAuth client registration** (`docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`) — the one manual step left. Once registered and the five vars from step 3 are set, `/api/openai` and `/api/strategies` both activate automatically (`server.js` logs which state it's in).
8. **Apply the RLS migration (step 2) and deploy the new frontend+backend (steps 5-6) in the same coordinated window** — not two independent deploys. Applying step 2's migration alone, before the new frontend is live, breaks the OLD frontend's anonymous Save/Load (RLS rejects writes with no `user_id`). This is the exact gap the ticket's "do not apply migrations before the authenticated frontend is ready" instruction is about, and it is why this is one window, not a sequence with a gap in it.
9. **Standalone OAuth/RLS test** (`supabase/oauth_test/`) — run for real verification/confirmation once a disposable test account exists. Not a blocking dependency for anything above: AUTH-003B's actual session design (step 5) never calls `setSession()` and never hands a Supabase token to the browser, so it does not depend on this test's answer to function. It remains valuable as independent proof that the underlying OAuth Server behaves as documented.

## What's proven vs. what's still a documented gap

| Area | Status |
|---|---|
| RLS ownership + isolation | **Proven** — 23 + 11 = 34 executed assertions across two local rehearsals (ownership/demo/admin logic, and the corrected safe-rollback procedures) |
| OpenAI endpoint auth + entitlement + quota | **Proven** — unconditional unit/integration assertions, plus 12 quota-concurrency assertions against a real disposable Postgres (including a genuine simulated-restart proof) |
| Shared-secret stopgap | **Rejected and removed** — confirmed unsafe for this app's actual (browser-direct) architecture; replaced with a clean disabled state |
| Daily quota configuration | **Validated strictly** — 14 assertions; an invalid env var now fails startup loudly |
| Post-cutover rollback safety | **Corrected and proven** — no longer recommends disabling RLS under any circumstance; the write-freeze and single-policy-fix procedures are both executed, not just designed |
| Backend SSO (PKCE, OAuth client, session cookie, token refresh) | **Built and tested** (AUTH-003B) — 133 unconditional assertions across `pkce`/`ssoRoutes`/`requireSsoAuth`/`strategiesProxy` test files; does not assume `setSession()` compatibility |
| Strategies CRUD proxy (`/api/strategies`) | **Built and tested** (AUTH-003B) — relays to PostgREST using the signed-in user's real, server-cached access token; user_id always taken from the verified session, never the request body |
| Frontend SSO (sign-in/out, session state, signed-out UX, error handling) | **Built** (AUTH-003B) — verified end-to-end against a local backend + Vite dev server this session (sign-in redirect round-trip, signed-out strategies gate makes no request, `/api/openai` 503 fail-closed path, translated error banners); production build succeeds |
| OAuth/RLS compatibility (`setSession()`, `auth.uid()` for an OAuth token via the standalone test) | **Not yet empirically proven, and no longer load-bearing** — the test is written, reviewed, and architecturally corrected, but AUTH-003B's shipped design does not depend on its answer (see row above) |
| Central `/account/products` + `/go/traffic-strategy-map` entitlement wiring (`adveser-platform`) | **Not started** — out of scope for this branch; `adveser-platform` untouched this session |

## Production risks, stated plainly

- The real OAuth client has never been registered and no real sign-in has ever completed against the shared Supabase project from this code — everything above is verified against fakes/local stacks/a disabled-OAuth-client local backend, not the real thing. The OAuth client registration is the one step that turns "tested design" into "tested against the real provider."
- Applying the RLS migration (checklist step 2) without also deploying the new frontend (steps 5-6) in the same window breaks the OLD frontend's anonymous Save/Load. This is a hard ordering requirement, not a suggestion.
- The in-memory OpenAI rate limiter is fully retired from this release — the durable Postgres-backed quota (step 2's migration 4) is the only option shipped; don't skip applying it.

## Final GO / NO-GO

**GO** — on everything in this checklist up through step 6 (backup, migrations, both environments' config minus the OAuth client secret, both the backend and frontend deploys in their disabled/signed-out-safe states). All of it is independently tested, reversible via the corrected rollback procedures, and changes nothing a real user experiences until step 8's coordinated cutover.

**NO-GO, still, on step 7 onward** — the OAuth client registration remains the one thing only you can provide, and step 8 (the coordinated RLS + frontend cutover) should not happen until it's done and at least minimally smoke-tested against the real provider.

Stopping at the production approval / manual OAuth configuration checkpoint, as instructed.
