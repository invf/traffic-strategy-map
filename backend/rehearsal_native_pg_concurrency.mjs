// AUTH-004 - real-database proof for requirement 3 ("verify that
// conditional PATCH using expected_updated_at is truly atomic and
// prevents concurrent lost updates AT THE DATABASE LEVEL") plus a
// direct re-confirmation that RLS still wins over the new conditional
// filter for a cross-user attempt - both against a REAL standalone
// PostgreSQL server (no Docker, no PostgREST, no Supabase Auth/GoTrue),
// using the exact schema and RLS policies from supabase/migrations/
// 20261118120000_add_strategy_ownership.sql, verbatim.
//
// WHY THIS, NOT JUST THE MOCKED backend/tests/strategiesProxy.test.mjs
// cases: a mocked fetchImpl only proves the ROUTE builds the right
// query string and handles the right response shapes - it can't prove
// anything about actual concurrent execution, because the "two
// requests" in a mock are just two sequential JS calls, never two real
// TCP connections racing the same row inside the same database server.
// This script opens TWO real pg.Client connections and fires the exact
// conditional UPDATE SQL the route constructs (see postgrestRequest's
// query building in backend/routes/strategiesProxy.js's PATCH handler)
// from both AT THE SAME TIME via Promise.all - whether Postgres's own
// row-level locking actually serializes them, rather than letting both
// "win," is the one thing a mock structurally cannot demonstrate.
//
// WHY NOT THE FULL rehearsal_strategies_proxy.mjs (real PostgREST/
// Supabase Auth) HERE: that script needs Docker (a local Supabase
// stack) for GoTrue/PostgREST specifically - this environment's Docker
// Desktop would not start even after a WSL reset (see this session's
// own report). A real, standalone PostgreSQL 18 installation WAS
// available on this machine outside Docker, so this script verifies
// the one thing Docker's absence was blocking that matters most (true
// database-level concurrency) using that instead. It intentionally
// does NOT claim to verify PostgREST's own HTTP-to-SQL translation or
// Supabase Auth's real JWT issuance - run rehearsal_strategies_proxy.mjs
// for that once Docker (or any reachable Supabase/PostgREST stack) is
// available; nothing else needs to change for it to run then.
//
// Run with (see this file's own matching setup.sql, applied once by
// hand against a disposable `initdb`-created PostgreSQL 18 instance on
// a throwaway, localhost-only port - never a shared or production
// server):
//   node backend/rehearsal_native_pg_concurrency.mjs

import pg from 'pg';

const CONNECTION = {
  host: '127.0.0.1',
  port: 5544,
  database: 'postgres',
  user: 'app_role',
};
const SUPERUSER_CONNECTION = { ...CONNECTION, user: 'postgres' };

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

// A real, separate TCP connection/backend process, with its session
// GUC set to a specific user id - exactly the trust boundary
// PostgREST's own `authenticated` role + auth.uid() rely on, just set
// directly here instead of via a real JWT (see this file's own setup.sql
// for the auth.uid() stub, which reads this exact GUC).
async function connectAs(userId) {
  const client = new pg.Client(CONNECTION);
  await client.connect();
  if (userId) await client.query(`SET request.jwt.claim.sub = '${userId}'`);
  return client;
}

// The EXACT query shape backend/routes/strategiesProxy.js's PATCH
// handler produces once PostgREST's `id=eq.<id>&updated_at=eq.<ts>`
// filters are translated to SQL (PostgREST ANDs query-string filters
// into the UPDATE's WHERE clause - this is that same WHERE clause,
// written directly).
async function conditionalPatch(client, { id, name, expectedUpdatedAt }) {
  if (expectedUpdatedAt !== undefined) {
    return client.query(
      `UPDATE public.strategies SET name = $1, updated_at = now() WHERE id = $2 AND updated_at = $3 RETURNING *`,
      [name, id, expectedUpdatedAt]
    );
  }
  return client.query(
    `UPDATE public.strategies SET name = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [name, id]
  );
}

async function run() {
  const superuser = new pg.Client(SUPERUSER_CONNECTION);
  await superuser.connect();
  const { rows: [userA] } = await superuser.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
  const { rows: [userB] } = await superuser.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);

  const asA = await connectAs(userA.id);
  const asB = await connectAs(userB.id);

  // ===== Requirement 3: real concurrent conditional UPDATEs, same row, TWO separate real connections =====
  {
    // updated_at is fetched as TEXT, not left for node-postgres to parse
    // into a JS Date - a JS Date only has millisecond precision, which
    // would silently truncate Postgres's microsecond-precision
    // timestamptz and break the equality check for reasons that have
    // nothing to do with the real bug this test exists to catch. The
    // REAL frontend/backend never parses this value into a Date either
    // (see src/store/useStore.js's activeCloudUpdatedAt and
    // backend/routes/strategiesProxy.js's expected_updated_at - both
    // just relay the JSON string PostgREST itself produced, untouched)
    // - casting to text here matches that real data path exactly.
    const insertRes = await asA.query(
      `INSERT INTO public.strategies (name, user_id, is_demo) VALUES ('Original', $1, false) RETURNING id, updated_at::text AS updated_at`,
      [userA.id]
    );
    const strategyId = insertRes.rows[0].id;
    const t0 = insertRes.rows[0].updated_at;

    // Two SEPARATE real connections, both "browser 1" and "browser 2"
    // for the SAME signed-in user, both holding the SAME t0 - exactly
    // the ticket's own concurrent-edit scenario. Opened as two more
    // distinct connections (not asA/asB above) so this is unambiguous.
    const browser1 = await connectAs(userA.id);
    const browser2 = await connectAs(userA.id);

    const [res1, res2] = await Promise.all([
      conditionalPatch(browser1, { id: strategyId, name: "Browser 1's edit", expectedUpdatedAt: t0 }),
      conditionalPatch(browser2, { id: strategyId, name: "Browser 2's edit", expectedUpdatedAt: t0 }),
    ]);

    const winners = [res1, res2].filter((r) => r.rowCount === 1);
    const losers = [res1, res2].filter((r) => r.rowCount === 0);
    assert(winners.length === 1, 'Exactly ONE of the two truly concurrent conditional UPDATEs succeeds - real row-level locking, not a mock, decided this');
    assert(losers.length === 1, 'The other gets zero rows affected - a real lost-update is prevented, not merely a sequential check');

    const finalRow = await superuser.query(`SELECT name FROM public.strategies WHERE id = $1`, [strategyId]);
    const winnerName = winners[0].rows[0].name;
    assert(finalRow.rows[0].name === winnerName, "The persisted row matches exactly the WINNING update - never a corrupted/merged value from both racing writers");

    // A hypothetical third holder of the same stale t0 still loses, no matter how many are racing.
    const browser3Res = await conditionalPatch(browser2, { id: strategyId, name: "Browser 3's edit", expectedUpdatedAt: t0 });
    assert(browser3Res.rowCount === 0, 'A third stale holder of the original t0 also gets zero rows - the check is against the REAL current state, not a one-shot race');

    await browser1.end();
    await browser2.end();
  }

  // ===== RLS still wins over the new conditional filter, at the true database level =====
  {
    const insertRes = await asA.query(
      `INSERT INTO public.strategies (name, user_id, is_demo) VALUES ('A-only', $1, false) RETURNING id, updated_at::text AS updated_at`,
      [userA.id]
    );
    const strategyId = insertRes.rows[0].id;
    const t0 = insertRes.rows[0].updated_at;

    const crossUserRes = await conditionalPatch(asB, { id: strategyId, name: 'hijacked', expectedUpdatedAt: t0 });
    assert(crossUserRes.rowCount === 0, "User B's conditional UPDATE on A's row affects ZERO rows - RLS's USING clause filters it out at the database level, regardless of the updated_at match");

    const selectAsB = await asB.query(`SELECT * FROM public.strategies WHERE id = $1`, [strategyId]);
    assert(selectAsB.rowCount === 0, "User B's SELECT on A's row returns zero rows - real RLS SELECT policy enforcement, not an application-layer filter");

    const selectAsA = await asA.query(`SELECT name FROM public.strategies WHERE id = $1`, [strategyId]);
    assert(selectAsA.rows[0]?.name === 'A-only', "User A's own row is completely unaffected by User B's attempt");
  }

  // ===== RLS WITH CHECK rejects a cross-user INSERT at the database level, independent of the backend's own user_id override =====
  {
    let threw = false;
    try {
      await asB.query(
        `INSERT INTO public.strategies (name, user_id, is_demo) VALUES ('spoofed', $1, false)`,
        [userA.id]
      );
    } catch (err) {
      threw = true;
      assert(/row-level security/i.test(err.message), `The rejection is a real RLS WITH CHECK violation (got: ${err.message})`);
    }
    assert(threw, "User B cannot INSERT a row claiming to be User A's, even via raw SQL bypassing the backend's own user_id-from-session logic entirely - defense in depth confirmed at the database, not just the application");
  }

  await asA.end();
  await asB.end();
  await superuser.end();

  console.log(`\n=== NATIVE POSTGRES REHEARSAL RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
