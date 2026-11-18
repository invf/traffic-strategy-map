# AUTH-003A — Final Coordinated Deployment Checklist & GO/NO-GO

Consolidates every AUTH-003A commit on `feature/auth-003a-security-and-sso-prep` through `[this session's final commit]`. Nothing below has been run against production — read-only verification only (confirmed the 3 original strategies are present and unchanged, most recently immediately before writing this document).

## Deployment checklist, in order

1. **Backup** — `node scripts/backup-strategies.mjs` (confirmed twice already this engagement, byte-identical both times).
2. **Database migrations**, in order:
   - `20261118115900_baseline_strategies_schema_for_rehearsal.sql` — **local rehearsal only, never apply to production** (production already has this table).
   - `20261118120000_add_strategy_ownership.sql`
   - `20261118120100_add_openai_usage_tracking.sql`
   - `20261118120200_provision_app_role.sql` (set the role's password out of band immediately after)
   - `20261118140000_add_durable_openai_quota.sql`
   - `20261118130000_add_oauth_rls_probe_table.sql` (only when ready to run the OAuth/RLS test)
3. **Render environment**: `SUPABASE_URL`, `TRAFFIC_STRATEGY_MAP_DB_URL`, `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` (once registered), optionally `OPENAI_DAILY_QUOTA` (validated strictly at startup — an invalid value now crashes the service loudly rather than silently misbehaving).
4. **Backend deploy**: safe to deploy *before* the OAuth client exists — the service runs in a disabled state (`503` for every `/api/openai` request, nothing else affected) rather than insecurely open or fake-protected by a leakable secret.
5. **OAuth client registration + the OAuth/RLS test** (`docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`'s 3-item minimum config) — resolves the one real open technical question before AUTH-003B's frontend work assumes an answer.
6. **AUTH-003B** (frontend SSO, callback, authenticated UI) — ships in the *same coordinated window* as unfreezing `public.strategies`' write grants for real users, per the explicit restriction against deploying restrictive RLS ahead of a working authenticated frontend. Until AUTH-003B ships, the migrated-but-not-yet-frontend-integrated state is fine to sit in (reads/writes for existing anonymous flows aren't affected until the frontend changes).

## What's proven vs. what's still a documented gap

| Area | Status |
|---|---|
| RLS ownership + isolation | **Proven** — 23 + 11 = 34 executed assertions across two local rehearsals (ownership/demo/admin logic, and the corrected safe-rollback procedures) |
| OpenAI endpoint auth + entitlement + quota | **Proven** — 57 unconditional unit/integration assertions, plus 12 quota-concurrency assertions against a real disposable Postgres (including a genuine simulated-restart proof) |
| Shared-secret stopgap | **Rejected and removed** — confirmed unsafe for this app's actual (browser-direct) architecture; replaced with a clean disabled state |
| Daily quota configuration | **Validated strictly** — 14 assertions; an invalid env var now fails startup loudly |
| Post-cutover rollback safety | **Corrected and proven** — no longer recommends disabling RLS under any circumstance; the write-freeze and single-policy-fix procedures are both executed, not just designed |
| OAuth/RLS compatibility (`setSession()`, `auth.uid()` for an OAuth token) | **Not yet empirically proven** — the test is written, reviewed, and architecturally corrected (browser-assisted, not scripted-cookie-faking), but still requires the one OAuth client registration + disposable test account this session cannot produce |
| Frontend SSO/callback/authenticated UI | **Not started** — scoped as AUTH-003B |

## Production risks, stated plainly

- The one remaining unknown is whether `setSession()` + PostgREST correctly resolve `auth.uid()` for an OAuth-Server-issued token on this specific project — documented evidence leans "yes" (Supabase's own docs) with a caveat (real GitHub issues reporting failure under specific conditions). AUTH-003B's session-handling design depends on this answer; don't build it on an assumption.
- Until AUTH-003B ships, applying the RLS migration changes `public.strategies`' behavior for the *current* anonymous frontend — anonymous writes will start failing RLS checks. This is why the migration and AUTH-003B are one coordinated window, not two independent deploys.

## Final GO / NO-GO

**GO** — on everything in this checklist up through step 4 (backup, migrations, role/role-grant, backend deploy in its disabled state). All of it is independently tested, reversible via the corrected rollback procedures, and changes nothing a real user experiences until the frontend catches up.

**NO-GO, still, on step 5 onward** — the OAuth client registration and test account remain the one thing only you can provide; AUTH-003B cannot responsibly start until the OAuth/RLS question is answered for real, not assumed.

Stopping at the production approval checkpoint, as instructed.
