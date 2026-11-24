-- ADV-002B - links a cloud strategy to a shared ADVESER Project. Nullable
-- and fully additive: every existing row (the entire current production
-- dataset, and every future "Quick Strategy"/Save-as-New row that never
-- goes through the future ADV-004 "Create Traffic Strategy from Launch
-- Analysis" flow) gets NULL here and is completely unaffected.
--
-- A REAL cross-schema foreign key, not just a bare uuid column: confirmed
-- (per ADV-002B's own manually-verified Production findings) that
-- adveser_core.projects already exists in the SAME Postgres database as
-- public.strategies (one shared Supabase project, two schemas) - a real
-- FK is possible and is used, per ADV-002A-R1's own recommendation to
-- prefer one over an unenforced pointer where the target is confirmed to
-- exist.
--
-- Deliberately does NOT touch any existing policy, column, or row on
-- public.strategies - user_id ownership, the 4 existing RLS policies
-- (read own or approved demo / insert own / update own / delete own),
-- and every AUTH-004/AUTH-004B behavior (cloud sync, optimistic
-- concurrency, Save vs Save as New, duplicate-name prevention) are all
-- untouched by this file.
--
-- NOT YET APPLIED TO PRODUCTION - review and apply only after the
-- ADV-002B approval checkpoint, and only after confirming (via the
-- verification script in ADV-002A-R1 / this ticket's own confirmed
-- findings) that adveser_core.projects is really there.

ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES adveser_core.projects(id);

-- No RLS change: the existing 4 policies on public.strategies already
-- apply to every column of a row, including this new one - project
-- membership is NOT a new access channel to a strategy (see
-- ADV-002A-R1 §4's authorization matrix: a project collaborator who is
-- not the strategy's own user_id gets no new access via this column).

-- ============================================================================
-- Rollback (manual, safe only if no real strategy has been linked yet -
-- check first):
--   SELECT count(*) FROM public.strategies WHERE project_id IS NOT NULL;
--   -- if 0: ALTER TABLE public.strategies DROP COLUMN project_id;
--   -- if > 0: back up those rows' project_id values before dropping, or
--   -- do not roll back - those strategies would silently lose their
--   -- project linkage, which may be real user-relied-upon data by then.
-- ============================================================================
