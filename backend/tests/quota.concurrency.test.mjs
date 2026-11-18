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
