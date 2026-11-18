-- AUTH-003A - usage tracking for the hardened /api/openai endpoint.
-- NOT YET APPLIED TO PRODUCTION - prepared and rehearsed locally only.
--
-- Write-only from the app's perspective (via the dedicated
-- traffic_strategy_map_app role - see docs/AUTH_003A_SETUP_CHECKLIST.md).
-- No RLS needed here: this table is never read via PostgREST/anon/
-- authenticated at all, only via the app's own direct Postgres
-- connection - revoke those roles explicitly so that remains true even
-- if someone adds this table to a future "expose everything" habit.

CREATE TABLE IF NOT EXISTS public.openai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  path text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS openai_usage_user_id_requested_at_idx
  ON public.openai_usage (user_id, requested_at DESC);

REVOKE ALL ON public.openai_usage FROM anon, authenticated;
ALTER TABLE public.openai_usage ENABLE ROW LEVEL SECURITY;
-- No policies created: with RLS enabled and no policy, anon/authenticated
-- get zero rows either way (defense in depth on top of the REVOKE above).
