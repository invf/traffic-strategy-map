# AUTH-003C — Production Database Migration Preparation

Continuing from `docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md` with the now-confirmed infrastructure facts (Session Pooler host/port, Render's deployment branch, `TRAFFIC_STRATEGY_MAP_DB_URL` still missing). **Nothing in this document has been executed against production.** No migration ran, no merge, no deploy, no OAuth setting changed, no entitlement granted. One real bug was found and fixed in two migration files this session — see Task 3 — and rehearsed against a real local Supabase stack before being written here.

## Task 1 — Production backup preparation

### Procedure
1. **Supabase's own backup** (the real safety net for schema *and* data together): Dashboard → Database → Backups. Confirm a recent automatic backup exists, or trigger a manual one if your plan tier supports it, immediately before Task 2 executes anything.
2. **This repo's own row-level snapshot**, additionally, for a fast human-readable diff and a second independent copy:
   ```bash
   VITE_SUPABASE_ANON_KEY=<the real anon key> node scripts/backup-strategies.mjs
   ```
   `select=*` over PostgREST — captures every column including all four JSONB fields (`nodes`, `edges`, `product_info`, `ai_suggestions`) exactly as stored, not a partial projection. Works today because RLS is not yet enabled with owner-scoped policies that would otherwise restrict what the anon key can see (the current `"Allow all"` policy permits it). Writes a timestamped JSON file to `backups/` (gitignored — production data must never be committed). Re-run once more immediately *after* Task 2's migration completes, this time via a `service_role`-authenticated query (the anon key will no longer see ownerless rows once the new policies are live) — a second confirmation point, not a replacement for the Supabase backup above.

### Read-only verification SQL
```sql
-- Row count and identifiers, captured BEFORE Task 2 runs
SELECT id, name, created_at, updated_at,
       (nodes IS NOT NULL) AS has_nodes,
       (edges IS NOT NULL) AS has_edges,
       (product_info IS NOT NULL) AS has_product_info,
       (ai_suggestions IS NOT NULL) AS has_ai_suggestions,
       jsonb_typeof(nodes) AS nodes_type,
       jsonb_typeof(edges) AS edges_type
FROM public.strategies
ORDER BY created_at;
-- Expect exactly 3 rows. Record the 3 ids verbatim - Task 2's
-- post-migration check re-runs this exact query and compares.

SELECT count(*) AS total_rows FROM public.strategies;
-- Expect 3.
```
Nothing above modifies or deletes any row — every statement in this task is a `SELECT` or an out-of-band read via PostgREST.

## Task 2 — Production migration

### Inspected, not invented
Exactly the files already in `supabase/migrations/`, inspected directly, in their current (corrected, see Task 3) form — no new filename invented:
1. `20261118120000_add_strategy_ownership.sql`
2. `20261118120100_add_openai_usage_tracking.sql` *(corrected this session)*
3. `20261118120200_provision_app_role.sql`
4. `20261118140000_add_durable_openai_quota.sql` *(corrected this session)*

`20261118130000_add_oauth_rls_probe_table.sql` remains optional/not required for production (only needed for the standalone OAuth/RLS compatibility test) and `20261118115900_baseline_strategies_schema_for_rehearsal.sql` is local-rehearsal-only and must never run against the real project (it already has `public.strategies`).

### Exact execution sequence (not yet executed)

**1. `20261118120000_add_strategy_ownership.sql`** — adds `user_id`/`is_demo`, drops the existing `"Allow all"` policy, creates the four owner-scoped policies:
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
`ADD COLUMN` only — no `UPDATE`/`DELETE` anywhere in this file. All 3 existing rows survive unchanged, getting `user_id = NULL, is_demo = false` by column default (private-pending-review, invisible to anon/authenticated until an administrator explicitly approves or assigns one — never a bulk operation).

**2. `20261118120100_add_openai_usage_tracking.sql`** (corrected — see Task 3):
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
```
No `ENABLE ROW LEVEL SECURITY` — see Task 3 for exactly why that line was removed.

**3. `20261118120200_provision_app_role.sql`**:
```sql
CREATE ROLE traffic_strategy_map_app LOGIN;
GRANT CONNECT ON DATABASE postgres TO traffic_strategy_map_app;
GRANT USAGE ON SCHEMA adveser_core TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.user_product_entitlements TO traffic_strategy_map_app;
GRANT USAGE ON SCHEMA public TO traffic_strategy_map_app;
GRANT INSERT ON public.openai_usage TO traffic_strategy_map_app;
```
**Immediately after, out of band** (SQL editor or `psql`, never in a committed file): `ALTER ROLE traffic_strategy_map_app PASSWORD '<generate one>';` — see Task 3/4.

**4. `20261118140000_add_durable_openai_quota.sql`** (corrected — see Task 3):
```sql
CREATE TABLE IF NOT EXISTS public.openai_quota (
  user_id uuid NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
REVOKE ALL ON public.openai_quota FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.openai_quota TO traffic_strategy_map_app;
```
No `ENABLE ROW LEVEL SECURITY` here either — same fix, same reason.

Nothing above touches any schema or table other than `public.strategies`, the two new `public.openai_*` tables, and one `SELECT` grant on one specific `adveser_core` table — `adveser_core`'s own schema/tables are never altered, and Launch Studio, Earn Studio, and Slovakia Operations are untouched entirely (none of their schemas appear anywhere in these files).

### Preflight SQL (run and review before executing anything above)
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'strategies' ORDER BY ordinal_position;
-- Expect exactly 8 rows (id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at).
-- If user_id or is_demo already exist, STOP - this migration assumes neither does yet.

SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'strategies';
-- Expect exactly one row: policyname = 'Allow all'. If the name differs,
-- DROP POLICY IF EXISTS "Allow all" will silently not remove it - find
-- the real name first.

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('openai_usage', 'openai_quota');
-- Expect zero rows (neither exists yet).

SELECT rolname FROM pg_roles WHERE rolname = 'traffic_strategy_map_app';
-- Expect zero rows (doesn't exist yet).
```

### Post-migration verification SQL
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'strategies' ORDER BY ordinal_position;
-- Expect 10 columns now (8 original + user_id + is_demo).

SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'strategies' ORDER BY policyname;
-- Expect exactly: delete own, insert own, read own or approved demo, update own.
-- Zero rows named "Allow all".

SELECT id, name FROM public.strategies WHERE id IN ('<id1>', '<id2>', '<id3>');
-- The exact 3 ids captured in Task 1 - all 3 present, name unchanged.

SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'traffic_strategy_map_app' ORDER BY table_schema, table_name, privilege_type;
-- Expect exactly 5 rows: adveser_core.user_product_entitlements (SELECT),
-- public.openai_usage (INSERT), public.openai_quota (SELECT, INSERT, UPDATE).

SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname IN ('openai_usage', 'openai_quota');
-- Expect relrowsecurity = false for BOTH - see Task 3 for why RLS is
-- deliberately NOT enabled on these two tables.
```

**STOP HERE. Explicit approval is required before any statement in Task 2 runs against the real project.**

## Task 3 — PostgreSQL application role

Inspected `supabase/migrations/20261118120200_provision_app_role.sql` directly:

| Question | Answer |
|---|---|
| Exact role name | `traffic_strategy_map_app` |
| LOGIN permission | Yes — `CREATE ROLE traffic_strategy_map_app LOGIN;` |
| Password configured | **No** — deliberately out of band, by design (the file only creates the role; the comment inside it says so explicitly). This is the one missing piece, and it's missing *on purpose* — setting it is a manual step for you, not a migration bug |
| Required privileges | `CONNECT` on the database; `USAGE` on `adveser_core` + `SELECT` on `adveser_core.user_product_entitlements`; `USAGE` on `public` + `INSERT` on `openai_usage` + (from the quota migration) `SELECT`/`INSERT`/`UPDATE` on `openai_quota`. Nothing on `public.strategies` at all — that table's authorization is RLS via `auth.uid()`, a different mechanism for a different kind of query, never this role |
| Can connect through Supabase Session Pooler | Yes, structurally — Supabase's pooler accepts any role with `LOGIN` and the correct password, routed by a project-qualified username (Task 4). Not independently verified against the real pooler this session (no network path to it) |
| Can access the required entitlement and quota structures | **No — not as shipped. Found and fixed a real bug.** See below |

### Bug found and fixed (rehearsed locally, not just inspected)

Both `20261118120100_add_openai_usage_tracking.sql` and `20261118140000_add_durable_openai_quota.sql` previously also ran `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with **no policy at all**, reasoning (per each file's own original comment) that this would give anon/authenticated zero rows as "defense in depth" on top of the `REVOKE ALL FROM anon, authenticated` already in the same file. That reasoning has a real flaw: **Postgres RLS applies to every non-owner, non-superuser role — including `traffic_strategy_map_app` itself**, the one role actually meant to write to these tables via its own `GRANT`. The `REVOKE` already fully and unconditionally blocks `anon`/`authenticated` regardless of RLS (PostgREST always connects as one of those two) — RLS was always redundant for them, while silently defeating the one real access path.

**Proven, not assumed**: rehearsed against a real local Supabase stack, connecting AS the real `traffic_strategy_map_app` role (password set locally for the test only) through the real `backend/lib/entitlements.js` code — `checkQuota()` failed with `new row violates row-level security policy for table "openai_quota"`, and `recordUsage()` failed identically against `openai_usage`. **Fixed** by removing the `ENABLE ROW LEVEL SECURITY` line from both files (the `REVOKE` alone is sufficient and correct). Re-rehearsed after the fix: `checkEntitlement()` correctly distinguished an entitled user (`active`) from a non-entitled one (`none`) through a real connection, `checkQuota()` correctly reserved quota (`{ allowed: true, remaining: 49 }`), and `recordUsage()` inserted successfully — all via the real role, the real grants, no code change needed beyond the two migration files.

Worth noting why `backend/tests/quota.concurrency.test.mjs` never caught this: it connects as the Postgres `postgres` superuser on its own disposable container, and superusers bypass RLS entirely — its own proof (atomic upsert correctness under real concurrency) remains valid and unaffected by this fix, but it was never positioned to catch a least-privilege-role-specific RLS misconfiguration like this one. Only rehearsing as the real dedicated role surfaced it.

## Task 4 — Render connection string

**Never the `postgres` administrator role for application traffic** — confirmed: the connection string below authenticates as `traffic_strategy_map_app` only, the same least-privilege role Task 3 just verified.

```
TRAFFIC_STRATEGY_MAP_DB_URL=postgresql://traffic_strategy_map_app.eukogyljakqafnuvrfiv:<PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
```

- **Username format**: `<role>.<project-ref>` — `traffic_strategy_map_app.eukogyljakqafnuvrfiv`, not a bare role name. This is how Supabase's pooler routes the connection to the correct project *before* Postgres itself ever authenticates it; only the part before the first `.` is the actual role Postgres authorizes as.
- **Session Pooler, port 5432** (not the Transaction pooler's 6543) — the right choice for this backend specifically: a long-running Render process with its own small, stable connection pool (`max: 5` in `lib/entitlements.js`), not a serverless many-short-lived-connections shape the Transaction pooler is built for.
- **TLS**: `sslmode=require` is required in the connection string itself, not configured in code. Confirmed directly by inspecting `pg`'s own connection-string parser: `sslmode=require` resolves to a full certificate-chain verification automatically (no `rejectUnauthorized: false` anywhere in this codebase, and none was added — an earlier draft of this fix tried exactly that and a local rehearsal proved it breaks every non-TLS connection, including local development, since it was hardcoded unconditionally rather than left to the connection string). Omitting `sslmode` entirely would leave the connection unencrypted against a pooler that is expected to require TLS.
- **Compatible with the backend's `pg` client**: confirmed — `pg.Pool({ connectionString, max: 5 })` in `backend/lib/entitlements.js` takes the connection string as-is; no other code change is needed for this to work once the password is set.

The password itself is never printed here, was never typed into this session, and must be generated and set out of band (Task 3) — only this template, with `<PASSWORD>` left as a literal placeholder, goes into Render's Environment tab.

## Task 5 — Final checkpoint

1. **Backup procedure and verification** — Task 1, in full.
2. **Exact ordered migration files** — Task 2's four files, in the stated order (the 5th, probe table, optional; the baseline file never runs against production).
3. **SQL preflight and post-migration checks** — Task 2's two query blocks.
4. **Dedicated PostgreSQL role setup** — Task 3: role exists in the migration as designed, correctly least-privilege, LOGIN-capable; password is the one deliberately-manual step; the RLS bug is now fixed and re-rehearsed clean.
5. **Render connection-string template, no credentials** — Task 4's exact line, `<PASSWORD>` as the only placeholder.
6. **Rollback procedure, RLS never disabled** — unchanged from `docs/AUTH_003A_ROLLBACK_PROCEDURES.md` (the stale comment recommending otherwise was already removed from the migration file in the prior commit this ticket continues from): (A) `REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;` to suspend writes while reads/isolation stay intact, or (B) fix one specific broken policy in place. Neither ever touches `ENABLE`/`DISABLE ROW LEVEL SECURITY`.
7. **GO / NO-GO**:

   **GO** — the migration plan is now more correct than it was at the start of this ticket (a real bug found and fixed, not just inspected), rehearsed clean end to end against a real local stack: **182 backend assertions, 48 real-local-Supabase-stack assertions** (3 rehearsal scripts, each on its own fresh reset), all passing after the fix. The connection-string template and role setup are fully specified.

   **NO-GO, pending exactly these, none of which this session can do**:
   - Generate and set the `traffic_strategy_map_app` role's real production password (`ALTER ROLE ... PASSWORD ...`, out of band, immediately after migration 3).
   - Assemble and set the real `TRAFFIC_STRATEGY_MAP_DB_URL` in Render using Task 4's template with that real password.
   - Take Task 1's fresh verified backup.
   - Explicit approval to execute Task 2's SQL against the real project.
   - (Carried over from the prior release plan, still unresolved) Confirm/merge whichever branch Render's `master` deployment actually needs, before any deploy — not part of this migration-specific ticket's own scope, but still a precondition for the backend ever running this corrected code at all.

Stopping at the first production-changing operation, as instructed: **executing any statement in Task 2 against the real Supabase project** is the exact action requiring your approval next.
