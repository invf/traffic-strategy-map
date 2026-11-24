-- ADV-002B - links a cloud strategy to the specific approved Launch Studio
-- analysis export it was created from, and adds the database-level
-- idempotency constraint that prevents a retried/concurrent "Create
-- Traffic Strategy from Launch Analysis" (ADV-004's own future flow) from
-- ever producing a duplicate row.
--
-- CROSS-REPOSITORY PREREQUISITE, explicit: this file's REFERENCES clause
-- target - launch_studio.approved_analysis_exports - is created by
-- invf/adveser-launch-studio's OWN migration
-- (server/db/migrations/0007_approved_analysis_exports.sql). That
-- migration MUST be applied to the same Production database BEFORE this
-- one, or the ALTER TABLE below will fail outright with an undefined-table
-- error - a loud, immediate, safe failure (never a silent partial
-- application), not a risk to guard against separately.
--
-- Resolves ADV-001's original three-field-vs-two-field inconsistency,
-- per ADV-002A-R1 §8: the idempotency key is (project_id,
-- source_launch_analysis_id) - two fields, not three - because the
-- export's own id already uniquely encodes its source revision (via
-- approved_analysis_exports' own unique(project_id, source_revision_id)
-- constraint), so a separate "version" field here would be redundant.
--
-- The index is PARTIAL (WHERE source_launch_analysis_id IS NOT NULL) so
-- it constrains ONLY strategies created through the future automatic
-- flow - every existing row, and every future manual "Save"/"Save as New"
-- (AUTH-004B, completely untouched), has this column NULL and never
-- participates in the uniqueness check at all. "Save as New" on an
-- already-linked strategy likewise never sets this column on the NEW
-- row it creates, so intentional variants remain fully possible - this
-- constraint only ever blocks the exact same (project, export) pair from
-- producing a second row by accident.
--
-- NOT YET APPLIED TO PRODUCTION - review and apply only after:
--   (a) the ADV-002B approval checkpoint, AND
--   (b) invf/adveser-launch-studio's 0007 migration is confirmed applied
--       to the same Production database.

ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS source_launch_analysis_id uuid REFERENCES launch_studio.approved_analysis_exports(id);

CREATE UNIQUE INDEX IF NOT EXISTS strategies_one_per_source_export
  ON public.strategies (project_id, source_launch_analysis_id)
  WHERE source_launch_analysis_id IS NOT NULL;

-- ============================================================================
-- Rollback (manual, safe only if no real strategy has used this column -
-- check first):
--   SELECT count(*) FROM public.strategies WHERE source_launch_analysis_id IS NOT NULL;
--   -- if 0:
--   DROP INDEX IF EXISTS public.strategies_one_per_source_export;
--   ALTER TABLE public.strategies DROP COLUMN IF EXISTS source_launch_analysis_id;
--   -- if > 0: do not roll back without a deliberate decision - those
--   -- strategies would lose their provenance link to the analysis that
--   -- created them.
-- ============================================================================
