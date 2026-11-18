-- AUTH-003A - usage tracking for the hardened /api/openai endpoint.
-- NOT YET APPLIED TO PRODUCTION - prepared and rehearsed locally only.
--
-- Write-only from the app's perspective (via the dedicated
-- traffic_strategy_map_app role - see docs/AUTH_003A_SETUP_CHECKLIST.md).
-- No RLS needed here: this table is never read via PostgREST/anon/
-- authenticated at all, only via the app's own direct Postgres
-- connection - revoke those roles explicitly so that remains true even
-- if someone adds this table to a future "expose everything" habit.

-- status/upstream_status: recorded AFTER the OpenAI call resolves (see
-- backend/server.js), not at the moment the request was merely
-- attempted - that distinction is the whole point of this table's
-- existence as a SEPARATE thing from the in-memory rate limiter
-- (backend/middleware/requireEntitlement.js), which counts attempts
-- for spending-control purposes and is the actual enforcement
-- mechanism, never this best-effort log.
CREATE TABLE IF NOT EXISTS public.openai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  path text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL, -- 'success' | 'upstream_error' | 'request_failed' | 'not_configured'
  upstream_status integer -- OpenAI's own HTTP status, when a response was received at all
);

CREATE INDEX IF NOT EXISTS openai_usage_user_id_requested_at_idx
  ON public.openai_usage (user_id, requested_at DESC);

REVOKE ALL ON public.openai_usage FROM anon, authenticated;
-- AUTH-003C correction: this file previously ALSO enabled RLS with no
-- policy at all, on the reasoning that anon/authenticated would then
-- get zero rows as defense-in-depth on top of the REVOKE above. Local
-- rehearsal (as the dedicated traffic_strategy_map_app role, over a
-- real connection, with its own real GRANT INSERT already in place)
-- proved that reasoning wrong: RLS with zero policies blocks EVERY
-- non-owner, non-superuser role - including traffic_strategy_map_app
-- itself, the one role actually meant to write here. The real error
-- observed: "new row violates row-level security policy for table
-- openai_usage". The REVOKE above already fully and correctly blocks
-- anon/authenticated (PostgREST always connects as one of those two;
-- a REVOKE is unconditional regardless of RLS) - RLS here would only
-- ever have been redundant for them, while actively breaking the one
-- real write path. Not enabling RLS on this table at all.
