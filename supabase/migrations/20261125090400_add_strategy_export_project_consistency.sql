-- ADV-002B-R1 - cross-project export integrity, part 2 (TSM-owned half;
-- see invf/adveser-launch-studio's 0008_approved_analysis_exports_project_
-- unique.sql for part 1, which this migration depends on).
--
-- PROBLEM FOUND IN REVIEW: public.strategies.project_id and
-- public.strategies.source_launch_analysis_id are two independent nullable
-- FKs - nothing today stops a strategy claiming project_id = A from
-- referencing an approved export that actually belongs to project B.
--
-- FIX - two constraints, both fully declarative (no trigger):
--   1. A CHECK: if source_launch_analysis_id is set, project_id MUST also
--      be set - closes the gap where a caller could set the export link
--      alone and skip the composite FK below entirely (a standard SQL FK
--      with MATCH SIMPLE, the only mode Postgres supports, is NOT
--      enforced when any of its own columns is NULL).
--   2. A COMPOSITE foreign key (source_launch_analysis_id, project_id)
--      REFERENCES launch_studio.approved_analysis_exports(id, project_id)
--      - this is what makes a project-mismatched export reference
--      physically impossible to insert: the referenced row in
--      approved_analysis_exports must have THIS EXACT project_id, not
--      merely exist.
--
-- CROSS-REPOSITORY PREREQUISITE, explicit: the composite FK's target -
-- the UNIQUE(id, project_id) constraint on
-- launch_studio.approved_analysis_exports - is added by
-- invf/adveser-launch-studio's OWN migration (server/db/migrations/
-- 0008_approved_analysis_exports_project_unique.sql). That migration MUST
-- be applied to the same Production database BEFORE this one, or the
-- ALTER TABLE below will fail outright with an undefined-object error - a
-- loud, immediate, safe failure, not a silent partial application.
--
-- Backward compatible: every existing/unlinked strategy has both columns
-- NULL, which satisfies the CHECK (its left side is true) and is skipped
-- entirely by the composite FK (MATCH SIMPLE skips the check when any FK
-- column is NULL) - nothing about today's Save/Save-as-New/cloud-sync
-- behavior changes. The existing idempotency index
-- (strategies_one_per_source_export) is untouched.
--
-- NOT VALID + VALIDATE CONSTRAINT: public.strategies is a live table with
-- real rows. ADD CONSTRAINT ... NOT VALID takes only a brief, fast
-- ACCESS EXCLUSIVE lock (no table scan); the follow-up VALIDATE
-- CONSTRAINT takes a much weaker SHARE UPDATE EXCLUSIVE lock (does not
-- block concurrent reads/writes) while it scans existing rows. Standard,
-- minimal-downtime pattern for adding a constraint to a live Production
-- table.
--
-- NOT YET APPLIED TO PRODUCTION - review and apply only after:
--   (a) the ADV-002B-R1 approval checkpoint, AND
--   (b) invf/adveser-launch-studio's 0008 migration is confirmed applied
--       to the same Production database, AND
--   (c) this repository's own 20261125090100_.../20261125090200_...
--       migrations (the project_id/source_launch_analysis_id columns
--       themselves) are already applied.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_source_export_requires_project'
      AND conrelid = 'public.strategies'::regclass
  ) THEN
    ALTER TABLE public.strategies
      ADD CONSTRAINT strategies_source_export_requires_project
      CHECK (source_launch_analysis_id IS NULL OR project_id IS NOT NULL)
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.strategies
  VALIDATE CONSTRAINT strategies_source_export_requires_project;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_source_export_project_fk'
      AND conrelid = 'public.strategies'::regclass
  ) THEN
    ALTER TABLE public.strategies
      ADD CONSTRAINT strategies_source_export_project_fk
      FOREIGN KEY (source_launch_analysis_id, project_id)
      REFERENCES launch_studio.approved_analysis_exports (id, project_id)
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.strategies
  VALIDATE CONSTRAINT strategies_source_export_project_fk;

-- ============================================================================
-- Rollback (manual, safe only if no real strategy has used either column -
-- check first, same guard as 20261125090200's own rollback):
--   SELECT count(*) FROM public.strategies WHERE source_launch_analysis_id IS NOT NULL;
--   -- if 0:
--   ALTER TABLE public.strategies DROP CONSTRAINT IF EXISTS strategies_source_export_project_fk;
--   ALTER TABLE public.strategies DROP CONSTRAINT IF EXISTS strategies_source_export_requires_project;
--   -- if > 0: do not roll back without a deliberate decision - this
--   -- would remove the one thing preventing a project/export mismatch
--   -- for rows that already rely on the link.
-- ============================================================================
