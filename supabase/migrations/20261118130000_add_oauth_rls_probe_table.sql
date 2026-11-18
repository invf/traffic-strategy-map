-- AUTH-003A-3 - an ISOLATED, disposable table for the OAuth/RLS
-- compatibility proof (supabase/oauth_rls_test.mjs). NOT YET APPLIED.
--
-- Deliberately separate from public.strategies: this proof must never
-- touch real strategies data, and this table's only purpose is to
-- answer "does auth.uid() resolve correctly from an OAuth-Server-
-- issued token" - a question about PostgREST/RLS plumbing, not about
-- this app's real schema. Safe to drop entirely once the question is
-- answered either way.

CREATE TABLE IF NOT EXISTS public.oauth_rls_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oauth_rls_probe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows only" ON public.oauth_rls_probe
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.oauth_rls_probe TO authenticated;

-- Rollback: DROP TABLE public.oauth_rls_probe; - nothing else
-- references it, nothing else depends on it existing.
