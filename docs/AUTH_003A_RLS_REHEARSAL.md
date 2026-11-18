# AUTH-003A — Local RLS Rehearsal (executed, not just designed)

A full local Supabase stack (Docker + Supabase CLI, `supabase start`) was run this session — never against production — to actually execute the ownership migration and its RLS policies, not just reason about them.

## Setup

1. A baseline migration (`20261118115900_baseline_strategies_schema_for_rehearsal.sql`) reconstructs the table's real production shape locally — a fresh local stack has no tables at all, since this repo never had a `supabase/migrations` directory before this ticket (the real table was created by hand, outside version control, at some point).
2. The role-provisioning migration (`20261118120200_provision_app_role.sql`) was temporarily moved out of `supabase/migrations/` for this run — it references `adveser_core`, a schema that exists only in the real shared project, not a disposable local stack. Restored to its normal location immediately after.
3. `npx supabase start`, then `node supabase/rehearsal.mjs`.

## Results — 23/23 assertions passed

Two real signed-up test users (via the local stack's own Auth admin API), plus 3 seeded "existing ownerless" rows matching production's real state:

- Ownerless rows invisible to `anon` and to both test users after the migration (not auto-classified as demo).
- Each user can create, read, update, and delete only their own rows.
- Cross-user read returns zero rows (silent); cross-user update/delete affect zero rows (silent) — the target row is untouched.
- A user cannot insert a row with `user_id` spoofed to someone else's id — rejected by `WITH CHECK`.
- A user cannot flip their own row to `is_demo = true` — rejected with an explicit `403`/`42501` RLS-violation error (not a silent no-op — verified by hand, since the first test run's assumption about the response shape was wrong and corrected before trusting the result).
- An admin (`service_role`, bypasses RLS entirely) can approve one specific row as a public demo, or assign one specific row to one specific user — in both cases, only that exact row changes visibility.
- The remaining untouched ownerless row stays invisible to every real user, confirming "private pending review" by construction, not convention.
- `public.openai_usage` is completely unreachable via `anon`/`authenticated` — confirmed as a hard `403`/`42501` permission-denied, not a quiet empty result.

## Rollback — also executed, not just written

The pre-cutover rollback SQL (drop both columns, drop all 4 policies, disable RLS) was run against this same rehearsal stack via `docker exec -i <container> psql` and verified afterward: the table returned to its exact original 8-column shape, with all 5 rows (3 seeded + 2 test users' own) now universally visible again, exactly matching production's current behavior.

## Re-running this

```bash
docker info          # confirm Docker Desktop is running
npx supabase init    # if supabase/config.toml doesn't exist yet
npx supabase start
node supabase/rehearsal.mjs
npx supabase stop
```

Nothing here was ever run against the real shared project.
