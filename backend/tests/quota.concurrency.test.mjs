// AUTH-003A-3 - EXECUTED proof that checkAndIncrementQuotaAtomic is
// genuinely atomic under real concurrency, against a REAL local
// Postgres (not a mock, not reasoning from documentation alone).
//
// Requires a disposable local Postgres with the openai_quota table
// already created - see docs/AUTH_003A_QUOTA_DESIGN.md for the exact
// setup used to produce this result.
//
// Run with: QUOTA_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:15432/postgres node backend/tests/quota.concurrency.test.mjs

import pg from 'pg';
import crypto from 'node:crypto';
import { checkAndIncrementQuotaAtomic } from '../lib/quota.js';

const DB_URL = process.env.QUOTA_TEST_DB_URL;
if (!DB_URL) {
  console.error('Set QUOTA_TEST_DB_URL to a disposable local Postgres with the openai_quota table already created.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

async function run() {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 25 });

  try {
    // ===== Sequential sanity check first =====
    {
      const userId = crypto.randomUUID();
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await checkAndIncrementQuotaAtomic(pool, userId, 3));
      assert(results.filter((r) => r.allowed).length === 3, 'Sequential: exactly 3 of 5 allowed under a limit of 3');
    }

    // ===== THE REAL TEST: 50 genuinely concurrent requests, same user, limit of 10 =====
    // Each call uses its own connection from the pool (max: 25 above,
    // so real parallelism, not queued-and-effectively-sequential) and
    // all 50 are issued before any of them is awaited individually -
    // Promise.all fires them together.
    {
      const userId = crypto.randomUUID();
      const limit = 10;
      const concurrency = 50;
      const results = await Promise.all(
        Array.from({ length: concurrency }, () => checkAndIncrementQuotaAtomic(pool, userId, limit))
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      assert(allowedCount === limit, `EXACTLY ${limit} of ${concurrency} truly concurrent requests for the SAME user were allowed, never more - this is the atomicity claim, proven against a real Postgres, not asserted from documentation (got ${allowedCount})`);

      const { rows } = await pool.query('SELECT count FROM public.openai_quota WHERE user_id = $1', [userId]);
      assert(rows[0]?.count === limit, `The stored count in Postgres is exactly ${limit} - no lost updates, no double-counting (got ${rows[0]?.count})`);
    }

    // ===== Repeat the race multiple times to rule out a lucky single run =====
    {
      let allCorrect = true;
      for (let trial = 0; trial < 5; trial++) {
        const userId = crypto.randomUUID();
        const results = await Promise.all(Array.from({ length: 30 }, () => checkAndIncrementQuotaAtomic(pool, userId, 7)));
        const allowedCount = results.filter((r) => r.allowed).length;
        if (allowedCount !== 7) {
          allCorrect = false;
          console.error(`  trial ${trial}: expected 7 allowed, got ${allowedCount}`);
        }
      }
      assert(allCorrect, 'Repeated 5 times with fresh users and different concurrency/limit numbers (30 concurrent, limit 7) - exactly correct every single time, not just once');
    }

    // ===== Different users racing at the same time never affect each other's count =====
    {
      const userA = crypto.randomUUID();
      const userB = crypto.randomUUID();
      const [resultsA, resultsB] = await Promise.all([
        Promise.all(Array.from({ length: 20 }, () => checkAndIncrementQuotaAtomic(pool, userA, 5))),
        Promise.all(Array.from({ length: 20 }, () => checkAndIncrementQuotaAtomic(pool, userB, 5))),
      ]);
      assert(resultsA.filter((r) => r.allowed).length === 5, 'User A, racing concurrently with User B, still gets exactly their own limit of 5');
      assert(resultsB.filter((r) => r.allowed).length === 5, "User B's own limit is entirely unaffected by User A's simultaneous race");
    }

    // ===== AUTH-003A Final Security Corrections: durable across a SIMULATED backend restart =====
    // "Restart" here means exactly what it would for the real Render
    // service: the Node process's own in-memory state - including its
    // pg.Pool object - is gone, and a brand new process starts with a
    // brand new Pool, knowing nothing about what came before except
    // what's in Postgres. Proven by literally closing one pool and
    // connecting a second, independent one to the SAME database -
    // nothing in this test carries the count across in JS memory.
    {
      const userId = crypto.randomUUID();
      const limit = 5;

      // "Process 1" uses some of the quota, then "crashes"/redeploys.
      const poolBeforeRestart = new pg.Pool({ connectionString: DB_URL, max: 5 });
      const before = [];
      before.push(await checkAndIncrementQuotaAtomic(poolBeforeRestart, userId, limit));
      before.push(await checkAndIncrementQuotaAtomic(poolBeforeRestart, userId, limit));
      before.push(await checkAndIncrementQuotaAtomic(poolBeforeRestart, userId, limit));
      assert(before.every((r) => r.allowed), 'Before the simulated restart, 3 requests are allowed (under the limit of 5)');
      await poolBeforeRestart.end(); // the "process" is gone - this Pool object no longer exists anywhere

      // "Process 2" - a BRAND NEW pool, a brand new connection, no
      // shared JS object or module state with the one above (this is
      // why the in-memory Map limiter COULD NOT pass this test - it
      // would reset to zero here; this one must not).
      const poolAfterRestart = new pg.Pool({ connectionString: DB_URL, max: 5 });
      try {
        const after1 = await checkAndIncrementQuotaAtomic(poolAfterRestart, userId, limit);
        assert(after1.allowed === true && after1.remaining === 1, `After the "restart," the NEW pool still sees the count from before it (got remaining=${after1.remaining}, expected 1 of 5 left after this, the 4th overall request) - the limit survived the process boundary, proven by actually crossing it, not argued from the schema`);
        const after2 = await checkAndIncrementQuotaAtomic(poolAfterRestart, userId, limit);
        assert(after2.allowed === true && after2.remaining === 0, 'The 5th request overall exactly fills the limit of 5 - still allowed, with zero remaining');
        const after3 = await checkAndIncrementQuotaAtomic(poolAfterRestart, userId, limit);
        assert(after3.allowed === false, 'The 6th request overall - the first to actually exceed the limit of 5 - is rejected. The restart did not grant a fresh allowance at any point: 5 real requests were allowed total, spanning both "processes," never more.');
      } finally {
        await poolAfterRestart.end();
      }
    }

    // ===== Subsequent day is a fresh bucket (PRIMARY KEY (user_id, day)) =====
    {
      const userId = crypto.randomUUID();
      await checkAndIncrementQuotaAtomic(pool, userId, 1);
      const second = await checkAndIncrementQuotaAtomic(pool, userId, 1);
      assert(second.allowed === false, "Same user, same day, limit of 1: the second request today is rejected");
      // Simulate "yesterday" directly - DB-level day boundary, not
      // reliant on wall-clock timing in this test run.
      await pool.query(`UPDATE public.openai_quota SET day = current_date - interval '1 day' WHERE user_id = $1`, [userId]);
      const today = await checkAndIncrementQuotaAtomic(pool, userId, 1);
      assert(today.allowed === true, "A new day is a fresh bucket - yesterday's count never carries over");
    }
  } finally {
    await pool.end();
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
