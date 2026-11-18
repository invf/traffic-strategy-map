-- AUTH-003A - add ownership to public.strategies, without reclassifying
-- or deleting any existing row.
--
-- NOT YET APPLIED TO PRODUCTION. Prepared and rehearsed against a local
-- Supabase stack (see docs/AUTH_003A_RLS_REHEARSAL.md) - this file is a
-- reviewable artifact, not something this session ran against the real
-- shared project.
--
-- Both new columns are additive and nullable/defaulted, so this is
-- reversible with:
--   ALTER TABLE public.strategies DROP COLUMN user_id, DROP COLUMN is_demo;
--   ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY; -- if desired
--   DROP POLICY IF EXISTS "read own or approved demo" ON public.strategies;
--   DROP POLICY IF EXISTS "insert own" ON public.strategies;
--   DROP POLICY IF EXISTS "update own" ON public.strategies;
--   DROP POLICY IF EXISTS "delete own" ON public.strategies;
-- No row is deleted or overwritten by either direction.
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
