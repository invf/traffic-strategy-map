-- Setup for backend/rehearsal_native_pg_concurrency.mjs - run this once
-- against a disposable, localhost-only PostgreSQL 18+ instance before
-- running that script. See that script's own header comment for the
-- full rationale (why this exists alongside rehearsal_strategies_proxy.mjs,
-- which needs Docker for a real Supabase/PostgREST stack - this one
-- needs only a plain `postgres` binary, nothing else).
--
-- Reproduces, verbatim, the real schema/RLS from:
--   supabase/migrations/20261118115900_baseline_strategies_schema_for_rehearsal.sql
--   supabase/migrations/20261118120000_add_strategy_ownership.sql
-- The one non-literal part is auth.uid() itself: Supabase's real
-- implementation reads the same `request.jwt.claim.sub` GUC that
-- PostgREST sets per-request from the caller's real JWT - this stub
-- reads that same, real, documented GUC directly (set by hand in the
-- rehearsal script instead of via an actual JWT), not an invented
-- mechanism.
--
-- Example, against a throwaway `initdb`-created instance on a
-- localhost-only custom port (NEVER a shared or production server):
--   initdb -D <tmp-dir> -U postgres -A trust --encoding=UTF8 --locale=C
--   pg_ctl -D <tmp-dir> -l <tmp-dir>/server.log \
--     -o "-p 5544 -c listen_addresses=127.0.0.1" start
--   psql -h 127.0.0.1 -p 5544 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f backend/rehearsal_native_pg_concurrency.setup.sql
--   node backend/rehearsal_native_pg_concurrency.mjs
--   pg_ctl -D <tmp-dir> stop -m fast   # then delete <tmp-dir>

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ── Baseline (20261118115900_baseline_strategies_schema_for_rehearsal.sql) ──
CREATE TABLE public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  nodes jsonb,
  edges jsonb,
  product_info jsonb,
  ai_suggestions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Ownership/RLS (20261118120000_add_strategy_ownership.sql, VERBATIM) ──
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

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

-- A non-superuser, non-owner role - RLS does not apply to a table
-- owner or a superuser, so the rehearsal's connections must use a role
-- that is neither, same as PostgREST's real `authenticated` role.
CREATE ROLE app_role LOGIN;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategies TO app_role;
GRANT USAGE ON SCHEMA auth TO app_role;
