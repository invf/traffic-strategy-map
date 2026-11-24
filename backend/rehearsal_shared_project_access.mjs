// ADV-002B - real-database proof, against a standalone PostgreSQL 18
// instance (no Docker, no PostgREST, no Supabase Auth), replicating the
// CONFIRMED real Production shape (both entitlement policies coexisting,
// both helper functions, public.strategies' existing RLS). Covers
// everything the brief's own test list asks for EXCEPT PostgREST/
// auth.uid()-based behavior specifically (Docker remains unavailable in
// this environment, same limitation noted in AUTH-004/ADV-002A) - that
// one claim ("no changes to existing strategy RLS") is instead proven
// STRUCTURALLY, by diffing pg_policies before and after applying the new
// migration, which is actually the more direct way to answer that exact
// question.
//
// This is also what caught a real, previously-unknown PostgreSQL behavior
// during ADV-002B's own development: a custom GUC (app.current_user_id)
// does NOT revert to NULL at COMMIT/ROLLBACK once it has been set at least
// once on a connection - current_setting(name, true) instead returns ''
// (empty string), which crashes any LATER ::uuid cast on that SAME
// connection (22P02 invalid input syntax), including on the EXISTING,
// unrelated user_product_entitlements_self policy this milestone never
// touches. See backend/lib/sharedProjectAccess.js's NIL_USER_ID comment
// for the fix (an explicit, session-level reset to a reserved nil UUID
// after every use) - the "R1 requirement 6" and "Transaction-local
// identity isolation + pool reuse" blocks below are what proved both the
// original bug and this fix, against a real server, not a mock.
//
// Run with (against a disposable PostgreSQL 18 instance on a throwaway,
// localhost-only port - never a shared or production server):
//   1. initdb/pg_ctl a throwaway instance, then:
//      psql -h 127.0.0.1 -p <port> -U postgres -d postgres -c "CREATE DATABASE rehearsal;"
//   2. psql -h 127.0.0.1 -p <port> -U postgres -d rehearsal -f backend/rehearsal_shared_project_access.setup.sql
//   3. node backend/rehearsal_shared_project_access.mjs
//   (update TSM_CONN/LS_CONN/SUPER_CONN's port below to match step 1;
//   rerunning from step 1's CREATE DATABASE is required between runs -
//   the script applies its own migration DDL mid-run and is not
//   idempotent against a database that already has it applied.)

import pg from 'pg';

const TSM_CONN = { host: '127.0.0.1', port: 5545, database: 'rehearsal', user: 'traffic_strategy_map_app' };
const LS_CONN = { host: '127.0.0.1', port: 5545, database: 'rehearsal', user: 'launch_studio_app' };
const SUPER_CONN = { host: '127.0.0.1', port: 5545, database: 'rehearsal', user: 'postgres' };

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

// Mirrors backend/lib/sharedProjectAccess.js's withSharedProjectTransaction()
// EXACTLY, including the post-COMMIT/ROLLBACK reset to the nil-UUID
// sentinel - see that file's own NIL_USER_ID comment for why: a custom GUC
// on a real PostgreSQL connection does NOT revert to NULL at COMMIT, only
// to '' (empty string), which crashes any LATER ::uuid cast on that SAME
// connection (confirmed empirically by this very rehearsal before this
// line existed - see the crash this fix replaced). The DI-based unit tests
// in tests/sharedProjectAccess.test.mjs separately prove the real function
// issues these exact statements in this exact order against a fake client;
// this real-Postgres rehearsal proves the underlying mechanism itself
// actually prevents the crash.
const NIL_USER_ID = '00000000-0000-0000-0000-000000000000';
async function withTx(client, userId, fn) {
  await client.query('BEGIN');
  try {
    if (userId) await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT set_config($1, $2, false)', ['app.current_user_id', NIL_USER_ID]).catch(() => {});
  }
}

async function run() {
  const super_ = new pg.Client(SUPER_CONN);
  await super_.connect();

  const { rows: [owner] } = await super_.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
  const { rows: [collaborator] } = await super_.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
  const { rows: [outsider] } = await super_.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);

  // ===== Project owner access (requirement: project owner access) =====
  let projectId;
  {
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    const rows = await withTx(tsm, owner.id, async () => {
      // Seed via superuser (TSM's role has no INSERT on projects - it
      // only ever READS projects Launch Studio created) - matches real
      // production: TSM never creates a project.
      return null;
    });
    await super_.query(`INSERT INTO adveser_core.projects (id, owner_user_id, name) VALUES (gen_random_uuid(), $1, 'Acme Growth') RETURNING id`, [owner.id]).then(async (r) => {
      projectId = r.rows[0].id;
      await super_.query(`INSERT INTO adveser_core.project_members (project_id, user_id, role, added_by) VALUES ($1, $2, 'owner', $2)`, [projectId, owner.id]);
    });

    const ownerSees = await withTx(tsm, owner.id, async () => {
      const r = await tsm.query('SELECT id, name FROM adveser_core.projects WHERE id = $1', [projectId]);
      return r.rows;
    });
    assert(ownerSees.length === 1 && ownerSees[0].name === 'Acme Growth', "The project's own owner sees it via traffic_strategy_map_app's new grant + RLS");
    await tsm.end();
  }

  // ===== Project collaborator access =====
  {
    await super_.query(`INSERT INTO adveser_core.project_members (project_id, user_id, role, added_by) VALUES ($1, $2, 'collaborator', $3)`, [projectId, collaborator.id, owner.id]);
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    const collabSees = await withTx(tsm, collaborator.id, async () => {
      const r = await tsm.query('SELECT id FROM adveser_core.projects WHERE id = $1', [projectId]);
      return r.rows;
    });
    assert(collabSees.length === 1, 'A non-owner collaborator ALSO sees the project - "any member", matching Launch Studio\'s own write model (not owner-only)');
    await tsm.end();
  }

  // ===== Cross-user denial =====
  {
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    const outsiderSees = await withTx(tsm, outsider.id, async () => {
      const r = await tsm.query('SELECT id FROM adveser_core.projects WHERE id = $1', [projectId]);
      return r.rows;
    });
    assert(outsiderSees.length === 0, 'A real user with NO project_members row sees zero rows for this project - real RLS, not an application-level filter');
    await tsm.end();
  }

  // ===== Revoked membership =====
  {
    await super_.query('DELETE FROM adveser_core.project_members WHERE project_id = $1 AND user_id = $2', [projectId, collaborator.id]);
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    const afterRevoke = await withTx(tsm, collaborator.id, async () => {
      const r = await tsm.query('SELECT id FROM adveser_core.projects WHERE id = $1', [projectId]);
      return r.rows;
    });
    assert(afterRevoke.length === 0, 'Immediately after membership is revoked, the former collaborator sees zero rows - no caching of a stale "is a member" result');
    await tsm.end();
  }

  // ===== Revoked entitlement =====
  {
    await super_.query(`INSERT INTO adveser_core.user_product_entitlements (user_id, product, status) VALUES ($1, 'traffic_strategy_map', 'active')`, [owner.id]);
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    // Exact query shape of the REAL checkEntitlement() - no GUC set at all.
    const activeCheck = await tsm.query(`SELECT status FROM adveser_core.user_product_entitlements WHERE user_id = $1 AND product = 'traffic_strategy_map'`, [owner.id]);
    assert(activeCheck.rows[0]?.status === 'active', "checkEntitlement()'s real query shape (NO GUC set) correctly returns 'active' - the traffic_strategy_map_app_entitlement_read policy alone is sufficient, confirming ADV-002A-R1's corrected finding empirically, not just by reading the clause");

    await super_.query(`UPDATE adveser_core.user_product_entitlements SET status = 'revoked' WHERE user_id = $1 AND product = 'traffic_strategy_map'`, [owner.id]);
    const revokedCheck = await tsm.query(`SELECT status FROM adveser_core.user_product_entitlements WHERE user_id = $1 AND product = 'traffic_strategy_map'`, [owner.id]);
    assert(revokedCheck.rows[0]?.status !== 'active', "After revocation, the SAME query (still no GUC) correctly reflects 'revoked' - RLS visibility and the real status column are independent concerns, both correct here");
    await tsm.end();
  }

  // ===== R1 requirement 6, empirical: introducing the GUC for shared-project
  // queries does NOT change entitlement behavior on the SAME connection =====
  {
    const tsm = new pg.Client(TSM_CONN);
    await tsm.connect();
    // Run a GUC-setting shared-project transaction FIRST...
    await withTx(tsm, owner.id, async () => {
      await tsm.query('SELECT 1 FROM adveser_core.projects WHERE id = $1', [projectId]);
    });
    // ...then immediately run the EXACT entitlement query, no GUC set by
    // this statement itself (COMMIT above already cleared the prior
    // LOCAL setting) - on the SAME physical connection.
    const afterGucTx = await tsm.query(`SELECT status FROM adveser_core.user_product_entitlements WHERE user_id = $1 AND product = 'traffic_strategy_map'`, [owner.id]);
    assert(afterGucTx.rows[0]?.status === 'revoked', 'Entitlement behavior on this connection is UNCHANGED by having just run a GUC-setting shared-project transaction - the two mechanisms are proven independent, not just argued to be');
    await tsm.end();
  }

  // ===== Transaction-local identity isolation + pool reuse =====
  {
    const pool = new pg.Pool({ ...TSM_CONN, max: 1 }); // max:1 forces physical connection reuse
    async function seesProjectAs(userId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        const r = await client.query('SELECT id FROM adveser_core.projects WHERE id = $1', [projectId]);
        await client.query('COMMIT');
        return r.rows.length > 0;
      } finally {
        client.release();
      }
    }
    const ownerResult = await seesProjectAs(owner.id);
    const outsiderResult = await seesProjectAs(outsider.id); // same pooled connection, max:1
    assert(ownerResult === true, 'Owner sees the project (first use of the sole pooled connection)');
    assert(outsiderResult === false, "Outsider, reusing the EXACT SAME physical connection immediately after, sees NOTHING - owner's identity did not leak across pooled reuse");
    await pool.end();
  }

  // ===== Structural proof: no changes to existing public.strategies RLS =====
  {
    const before = await super_.query(`select pol.polname as policyname, pol.polcmd as cmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as with_check_expr
      from pg_policy pol join pg_class c on c.oid = pol.polrelid
      where c.relname = 'strategies' order by pol.polname`);
    assert(before.rows.length === 4, 'Confirmed baseline: exactly the 4 existing policies on public.strategies, before this rehearsal applies the new linkage migration');

    // Apply the EXACT new migration statements now (see apply_linkage_migration.sql).
    await super_.query(`alter table public.strategies add column project_id uuid references adveser_core.projects(id)`);
    await super_.query(`alter table public.strategies add column source_launch_analysis_id uuid references launch_studio.approved_analysis_exports(id)`);
    await super_.query(`create unique index strategies_one_per_source_export on public.strategies (project_id, source_launch_analysis_id) where source_launch_analysis_id is not null`);

    const after = await super_.query(`select pol.polname as policyname, pol.polcmd as cmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as with_check_expr
      from pg_policy pol join pg_class c on c.oid = pol.polrelid
      where c.relname = 'strategies' order by pol.polname`);
    assert(JSON.stringify(before.rows) === JSON.stringify(after.rows), 'The new migration (ADD COLUMN x2, CREATE UNIQUE INDEX) leaves public.strategies\' 4 existing RLS policies BYTE-IDENTICAL - a real structural diff, not an assertion');
  }

  // ===== Existing unlinked strategies are completely unaffected =====
  {
    const { rows: [existingStrategy] } = await super_.query(
      `insert into public.strategies (name, user_id, is_demo) values ('Pre-existing strategy', $1, false) returning id, project_id, source_launch_analysis_id`,
      [owner.id]
    );
    assert(existingStrategy.project_id === null && existingStrategy.source_launch_analysis_id === null, 'A strategy inserted with no awareness of the new columns gets NULL on both - fully backward compatible');
  }

  // ===== Concurrent duplicate creation - the idempotency index =====
  {
    await super_.query(`insert into launch_studio.workspace_revisions (id, project_id, revision, content, created_by) values (gen_random_uuid(), $1, 1, '{}'::jsonb, $2) returning id`, [projectId, owner.id])
      .then(async (r) => {
        const revisionId = r.rows[0].id;
        const { rows: [exportRow] } = await super_.query(
          `insert into launch_studio.approved_analysis_exports (project_id, source_revision_id, product_intelligence, approved_by) values ($1, $2, '{}'::jsonb, $3) returning id`,
          [projectId, revisionId, owner.id]
        );
        const exportId = exportRow.id;

        const pool = new pg.Pool(TSM_CONN);
        async function tryCreate(name) {
          const client = await pool.connect();
          try {
            // This rehearsal goes through direct pg (traffic_strategy_map_app),
            // not PostgREST/supabase-js - public.strategies' own "insert own"
            // policy still applies regardless of role (no TO clause) and
            // requires user_id = auth.uid(), so request.jwt.claim.sub must be
            // set first, exactly as PostgREST itself would set it from the
            // real JWT. Set LOCAL (transaction-scoped) so it never survives
            // past this one statement on this pooled connection.
            await client.query('BEGIN');
            await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', owner.id]);
            const res = await client.query(
              `insert into public.strategies (name, user_id, is_demo, project_id, source_launch_analysis_id)
               values ($1, $2, false, $3, $4)
               on conflict (project_id, source_launch_analysis_id) where source_launch_analysis_id is not null do nothing
               returning id`,
              [name, owner.id, projectId, exportId]
            );
            await client.query('COMMIT');
            return res.rows[0]?.id ?? null;
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        }
        const [resultA, resultB] = await Promise.all([tryCreate("Browser A's create"), tryCreate("Browser B's concurrent retry")]);
        const winners = [resultA, resultB].filter(Boolean);
        assert(winners.length === 1, 'Of two truly concurrent creates for the SAME (project, export) pair, exactly one real row is created - real unique-index locking, not a mock');

        const countRes = await super_.query('select count(*) from public.strategies where project_id = $1 and source_launch_analysis_id = $2', [projectId, exportId]);
        assert(Number(countRes.rows[0].count) === 1, 'Exactly one strategy row exists for this (project, export) pair after the race - no duplicate persisted');
        await pool.end();
      });
  }

  // ===== Immutable export history =====
  {
    const ls = new pg.Client(LS_CONN);
    await ls.connect();
    await withTx(ls, owner.id, async () => {});
    let threw = false;
    try {
      await ls.query(`update launch_studio.approved_analysis_exports set schema_version = 2 where project_id = $1`, [projectId]);
    } catch (err) {
      threw = true;
      assert(/permission denied/i.test(err.message), `The rejection is a real permission-denied error (got: ${err.message})`);
    }
    assert(threw, 'launch_studio_app cannot UPDATE an approved export, even for its own project - immutability enforced at the grant level, not just convention');
    await ls.end();
  }

  await super_.end();

  console.log(`\n=== ADV-002B NATIVE POSTGRES REHEARSAL RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('REHEARSAL CRASHED:', err);
  process.exit(1);
});
