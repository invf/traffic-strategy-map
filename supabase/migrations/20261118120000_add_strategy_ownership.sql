-- AUTH-003A - add ownership to public.strategies, without reclassifying
-- or deleting any existing row.
--
-- NOT YET APPLIED TO PRODUCTION. Prepared and rehearsed against a local
-- Supabase stack (see docs/AUTH_003A_RLS_REHEARSAL.md) - this file is a
-- reviewable artifact, not something this session ran against the real
-- shared project.
--
-- AUTH-003A-3 correction: dropping these two columns is ONLY safe
-- BEFORE real users have created real owned rows ("pre-cutover") - once
-- they have, dropping the columns destroys their ownership metadata
-- permanently (the rows survive, but who-owns-what does not). See
-- docs/AUTH_003A_ROLLBACK_PROCEDURES.md for the pre-cutover vs post-
-- cutover procedures - the short version: pre-cutover, drop the
-- columns; post-cutover, `ALTER TABLE public.strategies DISABLE ROW
-- LEVEL SECURITY;` ALONE (never drop the columns) restores fully-open
-- access immediately while preserving every row's real ownership,
-- ready to re-enable once whatever prompted the rollback is fixed.
-- No row is ever deleted by either procedure.
--
-- is_demo DEFAULT false (not true): the ticket is explicit that existing
-- ownerless records must NOT be auto-classified as public demo content.
-- The 3 current rows get user_id = NULL, is_demo = false - private
-- pending review, invisible to anon/authenticated (service_role still
-- sees everything, RLS never applies to it) until an administrator
-- EXPLICITLY does one of:
--   UPDATE public.strategies SET is_demo = true WHERE id = '<specific id>';          -- approve as public demo
--   UPDATE public.strategies SET user_id = '<specific auth.users.id>' WHERE id = '<specific id>'; -- assign an owner
-- Never a bulk UPDATE with no WHERE id = ..., and never driven by
-- matching email or strategy name - see scripts/assign-strategy-owner.mjs.

ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- AUTH-003B pre-deployment audit correction: production's existing
-- "Allow all" RLS policy MUST be dropped explicitly, not just left in
-- place alongside the new owner-scoped policies below. Postgres RLS
-- policies for the same command are OR'd together - a surviving
-- USING (true) policy would make every row readable/writable by
-- anyone regardless of how correct the new policies are, silently
-- defeating the entire point of this migration. IF EXISTS makes this
-- safe to run even in an environment where that policy's exact name
-- differs or it was never created (e.g. the local rehearsal baseline,
-- supabase/migrations/20261118115900_baseline_strategies_schema_for_rehearsal.sql,
-- which now reproduces this same policy so this DROP can actually be
-- rehearsed end-to-end, not just asserted correct by inspection).
DROP POLICY IF EXISTS "Allow all" ON public.strategies;

ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

-- A row is readable only if it's an explicitly-approved demo, or it
-- belongs to the requesting user. An ownerless, non-demo row (the
-- current state of all 3 existing rows) is readable by NEITHER anon
-- NOR any authenticated user - only service_role (bypasses RLS
-- entirely, used only by the admin script) can see it. This is the
-- "treat ownerless records as private pending review" requirement,
-- enforced at the database level, not just by app-code convention.
CREATE POLICY "read own or approved demo" ON public.strategies
  FOR SELECT
  USING (is_demo = true OR (user_id IS NOT NULL AND user_id = auth.uid()));

-- A demo row is never writable by a regular user (only by service_role,
-- i.e. the admin tooling) - an authenticated user can only insert a row
-- that is immediately theirs and not a demo.
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
