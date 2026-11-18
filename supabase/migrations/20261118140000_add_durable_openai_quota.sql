-- AUTH-003A-3 - a DURABLE, atomic replacement for the in-memory rate
-- limiter in backend/middleware/requireEntitlement.js. NOT YET WIRED
-- IN - prepared and proven (see backend/lib/quota.js and
-- backend/tests/quota.concurrency.test.mjs) as the recommended design,
-- not yet the production default, since TRAFFIC_STRATEGY_MAP_DB_URL
-- itself isn't configured in Production yet either.
--
-- Survives a process restart (unlike the in-memory Map) and is correct
-- across multiple instances (unlike the in-memory Map, which is
-- per-process) - the two limitations that make the in-memory checker
-- NOT a guaranteed production spending ceiling, only a same-process
-- safety net.
--
-- One row per (user, day). The atomicity comes from
-- INSERT ... ON CONFLICT ... DO UPDATE ... WHERE - see quota.js's own
-- comment for exactly how, and backend/tests/quota.concurrency.test.mjs
-- for an EXECUTED proof (real concurrent Postgres connections, not
-- just an argument from documentation) that exactly N requests succeed
-- under a limit of N, never N+1, regardless of how many requests race.

CREATE TABLE IF NOT EXISTS public.openai_quota (
  user_id uuid NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

REVOKE ALL ON public.openai_quota FROM anon, authenticated;
ALTER TABLE public.openai_quota ENABLE ROW LEVEL SECURITY;
-- No policies: RLS enabled with none means zero access via PostgREST
-- for anon/authenticated regardless (defense in depth on the REVOKE).

-- Same dedicated role from 20261118120200_provision_app_role.sql -
-- needs SELECT+INSERT+UPDATE here (the atomic upsert in quota.js is a
-- single INSERT ... ON CONFLICT ... DO UPDATE statement, which needs
-- both INSERT and UPDATE privilege; SELECT lets it also report the
-- current count without a separate query if ever needed).
GRANT SELECT, INSERT, UPDATE ON public.openai_quota TO traffic_strategy_map_app;

-- Rollback: DROP TABLE public.openai_quota; - nothing else references it.
