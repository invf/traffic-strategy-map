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

## Post-cutover rollback (real owned strategies exist) — CORRECTED

**Earlier versions of this document recommended `ALTER TABLE public.strategies DISABLE ROW LEVEL SECURITY;` as the post-cutover emergency response. This was wrong and has been removed.** Disabling RLS while private user data exists makes every user's private strategy readable and writable by anyone, including anonymously — a far worse outcome than almost any bug this would be rolling back from. **Never recommend or use this once real private rows exist.**

Instead, two corrected procedures, both **executed and verified against a disposable local Supabase stack** (`supabase/rehearsal_rollback.mjs`, 11/11 assertions passed) — never against production:

### A. Suspend the feature (the default emergency response)

If something is broken and real users are affected, freeze **writes only**, at the grant level — RLS, and therefore all isolation, is never touched:

```sql
REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;
```

**Proven empirically**: after this, even the legitimate owner of a row cannot create or modify strategies (the feature is genuinely offline) — but reads continue working exactly as before, with full isolation intact (a second user still cannot read the first user's private row; anonymous access is not widened at all). Lift it the moment the underlying issue is fixed:

```sql
GRANT INSERT, UPDATE, DELETE ON public.strategies TO authenticated;
```

Verified: ownership `WITH CHECK` enforcement is immediately active again on lift — because RLS was never disabled, there is nothing to "restore."

### B. A specific RLS policy is the bug — fix that one policy, never disable RLS to do it

If the actual defect is in a policy's own logic (e.g., a `USING` clause that's accidentally too permissive), replace **only that policy**:

```sql
DROP POLICY "read own or approved demo" ON public.strategies;
CREATE POLICY "read own or approved demo" ON public.strategies
  FOR SELECT USING (is_demo = true OR (user_id IS NOT NULL AND user_id = auth.uid()));
```

**Proven empirically**: the rehearsal deliberately introduced a broken policy (`USING (true)` — reads everything), confirmed the resulting real exposure (one test user could read another's private row), then fixed it by dropping and recreating *only* that policy — isolation was restored immediately, and RLS itself was enabled the entire time, including during the deliberately-broken window (the exposure came from the policy's own logic, never from RLS being off).

### If a secure rollback genuinely isn't possible

Suspend the feature (procedure A) and leave it suspended while a proper fix is prepared, rather than reach for anything that disables RLS. A write freeze with full read isolation intact is always available as a safe holding state — there is no scenario where disabling RLS is the only option.

### Only if the ownership feature is being permanently abandoned (not paused, not a bug response)

Even then, do not disable RLS to get there — change the policies to something durably safe instead (e.g., a service-role-only `USING (false)` policy for `authenticated`/`anon`, making every row admin-only rather than world-readable), and only consider dropping the `user_id`/`is_demo` columns after taking a full backup that specifically includes them (`scripts/backup-strategies.mjs`'s plain `select=*` already captures both).

## Data preservation — verified complete

Two independent backups taken this session, 33 minutes apart, via the existing production system (no mutation): **identical**, confirming no production changes occurred in between. Both contain exactly 3 rows, all 8 real columns (`id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at`), nothing truncated or summarized.

Latest backup: `backups/strategies-2026-11-18T12-08-14-088Z.json`
SHA-256: `c0dc09c9362ce7449c16d39f407f1474a327accb49e4c1e7db000f06768612d7`

**Secure external handoff**: this file is gitignored (never committed — it's real, if currently-public, user data) and currently sits only in this local working copy. Recommended: you copy it yourself to wherever you keep operational backups (a password-managed secure note, an encrypted drive, your own cloud storage with access control) — not something this session should do unprompted, since "secure handoff" means a destination only you control. The SHA-256 above lets you verify the copy is bit-for-bit identical to what was actually backed up, wherever you move it.

## What is NOT auto-classified or auto-assigned (confirmed, by design)

The migration's `is_demo DEFAULT false` means all 3 existing rows remain **private pending review** after it's applied — not public demo content, not assigned to anyone. Changing either requires `scripts/assign-strategy-owner.mjs`, one specific row id at a time, with an explicit `--demo` or `--owner <uuid>` flag — there is no bulk path and no email/name-matching path in this codebase at all.
