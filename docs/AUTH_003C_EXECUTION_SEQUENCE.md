# AUTH-003C — Exact Production Execution Sequence

The authoritative, step-by-step runbook for the four already-approved migration files, with the role → password → `TRAFFIC_STRATEGY_MAP_DB_URL` dependency made explicit. **Nothing in this document has been executed.** Each step below is a separate approval checkpoint — execute one, confirm its verification query, then come back for the next. Nothing here merges a branch, deploys Render or Vercel, disables RLS, or touches any schema other than `public`'s two new/one modified table and one `SELECT` grant on `adveser_core.user_product_entitlements`.

## The dependency chain, stated once

```
Migration 2 (creates public.openai_usage)
        │
        ▼
Migration 3 (creates the role; GRANTs INSERT on openai_usage - needs it to already exist)
        │
        ├──► Out-of-band: set the role's password (not a migration file)
        │            │
        │            ▼
        │     Render: set TRAFFIC_STRATEGY_MAP_DB_URL (not deployed yet)
        │
        ▼
Migration 4 (creates public.openai_quota; GRANTs to the role - needs it to already exist)

Migration 1 (public.strategies ownership + RLS) has no dependency on
any of the above - it only touches public.strategies. Kept first in
the sequence below, matching the order already reviewed in
docs/AUTH_003C_MIGRATION_PREPARATION.md.
```

**One timing consideration, not a blocker**: migration 1 is the only one of the four with any immediate user-facing effect — once it runs, the *old* anonymous frontend's Save/Load starts failing RLS checks (no `user_id` to satisfy `WITH CHECK`) until the new frontend is deployed. Migrations 2–4 are entirely inert until the backend code that uses them is deployed. If you'd rather minimize that window, migrations 2→3→4→1 is equally valid dependency-wise (1 has no prerequisite, so it can move anywhere in the sequence) — your call; the sequence below keeps the already-reviewed 1→2→3→4 order unless you say otherwise.

---

## Step 1 — `supabase/migrations/20261118120000_add_strategy_ownership.sql`

**Prerequisites**: none beyond what's already confirmed true today (8-column `public.strategies`, the `"Allow all"` policy present, 3 existing rows — all independently reconfirmed in `docs/AUTH_003C_MIGRATION_PREPARATION.md`'s Task 2 preflight queries; re-run them now if any time has passed since).

**Exact SQL** (verbatim from the file, nothing added or removed):
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

**Verification query** (run immediately after):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'strategies' ORDER BY ordinal_position;
-- Expect 10 columns now (8 original + user_id + is_demo).

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'strategies' ORDER BY policyname;
-- Expect exactly 4 rows: delete own, insert own, read own or approved
-- demo, update own. Zero rows named "Allow all" - this is the one
-- result that matters most: if "Allow all" is still listed, STOP and
-- do not proceed to Step 2 until you've worked out why the DROP
-- didn't take effect (e.g. the real policy name differs from exactly
-- "Allow all").
```

**Effect on the 3 existing strategies**: unchanged (`ADD COLUMN` only, no `UPDATE`/`DELETE` anywhere in this file) — they get `user_id = NULL, is_demo = false` by column default. Their preservation is no longer a release requirement either way (confirmed disposable test data), but nothing in this statement touches them regardless.

---

## Step 2 — `supabase/migrations/20261118120100_add_openai_usage_tracking.sql`

**Prerequisites**: none (creates a brand-new table; doesn't reference the role, which doesn't exist yet at this point).

**Exact SQL**:
```sql
CREATE TABLE IF NOT EXISTS public.openai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  path text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  upstream_status integer
);

CREATE INDEX IF NOT EXISTS openai_usage_user_id_requested_at_idx
  ON public.openai_usage (user_id, requested_at DESC);

REVOKE ALL ON public.openai_usage FROM anon, authenticated;
```
No `ENABLE ROW LEVEL SECURITY` here — see `docs/AUTH_003C_MIGRATION_PREPARATION.md`'s Task 3 for why that line was deliberately removed (it would otherwise block the dedicated app role's own granted access, not just `anon`/`authenticated`; the `REVOKE` alone is sufficient and correct).

**Verification query**:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'openai_usage';
-- Expect 1 row.

SELECT relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname = 'openai_usage';
-- Expect false.

SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'openai_usage' AND grantee IN ('anon', 'authenticated');
-- Expect zero rows - confirms the REVOKE took effect.
```

---

## Step 3 — `supabase/migrations/20261118120200_provision_app_role.sql`

**Prerequisites**: Step 2 complete (`public.openai_usage` must already exist — this file's own `GRANT INSERT ON public.openai_usage TO traffic_strategy_map_app;` would fail with `relation "public.openai_usage" does not exist` otherwise).

**Exact SQL**:
```sql
CREATE ROLE traffic_strategy_map_app LOGIN;

GRANT CONNECT ON DATABASE postgres TO traffic_strategy_map_app;

GRANT USAGE ON SCHEMA adveser_core TO traffic_strategy_map_app;
GRANT SELECT ON adveser_core.user_product_entitlements TO traffic_strategy_map_app;

GRANT USAGE ON SCHEMA public TO traffic_strategy_map_app;
GRANT INSERT ON public.openai_usage TO traffic_strategy_map_app;
```

**Immediately after this statement, in the same session, a separate statement — NOT in any file, never committed anywhere**:
```sql
ALTER ROLE traffic_strategy_map_app PASSWORD '<generate one now, e.g. via your password manager or `openssl rand -base64 32`>';
```
This is the step the ticket's dependency warning is about: the role created above has `LOGIN` but no password yet — nothing can actually authenticate as it until this runs. Do this in the same sitting as the `CREATE ROLE` above, before moving on, so the role never sits in a "exists but unusable" state for longer than necessary. **Do not paste the generated password into this chat or any file** — copy it directly into Render's Environment tab in the next sub-step, or hold it in your password manager until you do.

**Then, separately (does not require Step 4 to have run first)**: assemble `TRAFFIC_STRATEGY_MAP_DB_URL` and set it in Render's Environment tab, using the password just generated:
```
TRAFFIC_STRATEGY_MAP_DB_URL=postgresql://traffic_strategy_map_app.eukogyljakqafnuvrfiv:<the password you just generated>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
```
Per the restrictions on this ticket, **do not click deploy** after saving it — Render's "saved but not deployed" state (the same one already confirmed for the OAuth/Supabase variables) is exactly what's wanted here too.

**Verification query** (for the role/grants; password correctness can only be verified by actually connecting, which this session cannot do):
```sql
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'traffic_strategy_map_app';
-- Expect rolcanlogin = true.

SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'traffic_strategy_map_app' ORDER BY table_schema, table_name, privilege_type;
-- Expect exactly 2 rows at this point (before Step 4):
--   adveser_core.user_product_entitlements | SELECT
--   public.openai_usage                    | INSERT
```

---

## Step 4 — `supabase/migrations/20261118140000_add_durable_openai_quota.sql`

**Prerequisites**: Step 3 complete (`traffic_strategy_map_app` must already exist — this file's `GRANT ... TO traffic_strategy_map_app;` would fail with `role "traffic_strategy_map_app" does not exist` otherwise). Does **not** require the password to already be set — granting privileges to a role doesn't need that role to be able to log in yet.

**Exact SQL**:
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
Same RLS correction as Step 2 — no `ENABLE ROW LEVEL SECURITY` (it would block the app role's own just-granted access).

**Verification query**:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'openai_quota';
-- Expect 1 row.

SELECT relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname = 'openai_quota';
-- Expect false.

SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'traffic_strategy_map_app' ORDER BY table_schema, table_name, privilege_type;
-- Expect exactly 5 rows now:
--   adveser_core.user_product_entitlements | SELECT
--   public.openai_quota                    | INSERT
--   public.openai_quota                    | SELECT
--   public.openai_quota                    | UPDATE
--   public.openai_usage                    | INSERT
-- This is the full, final grant set - nothing on public.strategies at
-- all (that table's authorization is RLS via auth.uid(), never this role).
```

---

## After all four steps

Database state matches what `backend/server.js` needs to activate `/api/openai` and `/api/strategies` (once also deployed — not part of this checklist): OAuth client + session secret + `SUPABASE_URL`/`SUPABASE_ANON_KEY` already confirmed entered, `TRAFFIC_STRATEGY_MAP_DB_URL` now set from Step 3. Still not deployed. The remaining steps (merge, deploy, smoke test, central gateway activation) are `docs/AUTH_003C_PRODUCTION_RELEASE_PLAN.md`'s Steps 3–4 — separate approval checkpoints, not part of this migration sequence.

## Restrictions honored in this plan

Nothing executed automatically — every one of the four `ALTER`/`CREATE`/`GRANT`/`REVOKE` statements above, plus the one out-of-band `ALTER ROLE ... PASSWORD`, is presented for you to run and approve individually, in order. No unrelated schema is touched (confirmed again: only `public.strategies`, `public.openai_usage`, `public.openai_quota`, the role itself, and one `SELECT` grant on one `adveser_core` table). RLS is never disabled anywhere in this sequence. No branch is merged, no Render/Vercel deploy is triggered — Step 3's Render env var save is explicitly "saved, not deployed," matching the state the OAuth/Supabase variables are already in.
