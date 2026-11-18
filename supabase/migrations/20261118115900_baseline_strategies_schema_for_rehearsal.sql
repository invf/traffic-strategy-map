-- AUTH-003A - reconstructs the CURRENT production shape of
-- public.strategies, for LOCAL REHEARSAL ONLY (a fresh local Supabase
-- stack has no tables at all - this repo never had a
-- supabase/migrations directory before this ticket, so the real table
-- was created by hand, outside version control, at some point).
--
-- Confirmed directly against the live production table via a safe,
-- read-only PostgREST call (select=*): these are exactly its columns.
-- Do NOT run this against the real shared project - it already has
-- this table; running CREATE TABLE there would simply fail (and if it
-- didn't, duplicating table creation is never the right move for an
-- existing table). This file exists purely so
-- 20261118120000_add_strategy_ownership.sql can be rehearsed end-to-end
-- against a disposable local stack.

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

-- Matches the empirically-confirmed current state: anon can read, and
-- the live app's own advertised (anonymous) save/delete flows imply
-- write access too - reproduced here so the rehearsal's "before" state
-- matches reality, not a guess.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategies TO anon, authenticated;

-- AUTH-003B pre-deployment audit correction: production's existing
-- access control is RLS-based (an "Allow all" policy), not bare GRANTs
-- with RLS left disabled - this rehearsal baseline previously modeled
-- only the GRANT, which made the ownership migration's own correctness
-- (it must explicitly DROP this policy, not just add new ones - RLS
-- policies for the same command are OR'd together, so a surviving
-- permissive policy would silently defeat every new owner-scoped one)
-- impossible to actually rehearse. This reproduces the real shape.
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON public.strategies
  FOR ALL
  USING (true)
  WITH CHECK (true);
