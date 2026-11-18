# AUTH-003A — Rollback Procedures (Pre-Cutover vs Post-Cutover)

**These are two different procedures, not one.** Once real users have created real owned strategies, the original "just drop the two new columns" rollback would **destroy their ownership metadata permanently** — the rows survive (`DROP COLUMN` doesn't delete rows), but who-owns-what is gone, and those rows become indistinguishable from the pre-existing ownerless ones. Treat the cutover moment — the point the authenticated frontend starts letting real users create owned rows — as the line between these two procedures.

## Pre-cutover rollback (no real owned rows exist yet)

Safe to use any time before the authenticated save/load UI has gone live for real users — i.e., the migration is applied, but nothing has used `user_id`/`is_demo` for real yet beyond the admin's own explicit, deliberate actions (demo approval / ownership assignment via `scripts/assign-strategy-owner.mjs`).

```sql
BEGIN;
DROP POLICY IF EXISTS "read own or approved demo" ON public.strategies;
DROP POLICY IF EXISTS "insert own" ON public.strategies;
DROP POLICY IF EXISTS "update own" ON public.strategies;
DROP POLICY IF EXISTS "delete own" ON public.strategies;
ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategies DROP COLUMN user_id, DROP COLUMN is_demo;
COMMIT;
```

**Verified empirically** (not just reasoned about) against a local rehearsal stack this session: executed this exact sequence after running the migration and creating test data, and confirmed the table returns to its exact original 8-column, fully-open shape with zero row loss. See `supabase/rehearsal.mjs`.

## Post-cutover rollback (real owned strategies exist)

**Do not drop the columns.** The correct emergency response — e.g. a bug in the new auth/RLS path is blocking real users — is to disable enforcement while preserving every bit of ownership metadata, so re-enabling later needs no reconstruction:

```sql
-- Emergency: restores fully-open access immediately, loses nothing.
ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY;
```

This alone undoes the *behavioral* effect of the migration (everyone can read/write everything again, exactly like before AUTH-003A) while every row keeps its real `user_id`/`is_demo` value, ready for RLS to be re-enabled the moment the underlying bug is fixed:

```sql
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
```

**Only if the ownership feature is being permanently abandoned** (not paused) would dropping the columns ever be appropriate post-cutover — and even then:
1. Take a full backup first, specifically including `user_id`/`is_demo` (a plain `select=*` already captures them — `scripts/backup-strategies.mjs` needs no changes for this).
2. Store that backup durably (see the handoff section below) — it's the only way ownership could ever be reconstructed later if the feature is revisited.
3. Only then drop the columns.

## Data preservation — verified complete

Two independent backups taken this session, 33 minutes apart, via the existing production system (no mutation): **identical**, confirming no production changes occurred in between. Both contain exactly 3 rows, all 8 real columns (`id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at`), nothing truncated or summarized.

Latest backup: `backups/strategies-2026-11-18T12-08-14-088Z.json`
SHA-256: `c0dc09c9362ce7449c16d39f407f1474a327accb49e4c1e7db000f06768612d7`

**Secure external handoff**: this file is gitignored (never committed — it's real, if currently-public, user data) and currently sits only in this local working copy. Recommended: you copy it yourself to wherever you keep operational backups (a password-managed secure note, an encrypted drive, your own cloud storage with access control) — not something this session should do unprompted, since "secure handoff" means a destination only you control. The SHA-256 above lets you verify the copy is bit-for-bit identical to what was actually backed up, wherever you move it.

## What is NOT auto-classified or auto-assigned (confirmed, by design)

The migration's `is_demo DEFAULT false` means all 3 existing rows remain **private pending review** after it's applied — not public demo content, not assigned to anyone. Changing either requires `scripts/assign-strategy-owner.mjs`, one specific row id at a time, with an explicit `--demo` or `--owner <uuid>` flag — there is no bulk path and no email/name-matching path in this codebase at all.
