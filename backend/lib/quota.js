// AUTH-003A-3 - durable, atomic replacement for the in-memory rate
// limiter (backend/middleware/requireEntitlement.js's
// checkAndIncrementRateLimit). Pluggable via the same shape so adopting
// it is a drop-in change, not a rewrite - see that file's own comment
// for why the in-memory version is NOT a guaranteed production
// spending ceiling (resets to zero on every restart, and is correct
// only within a single process).
//
// The atomicity: a single INSERT ... ON CONFLICT ... DO UPDATE ...
// WHERE statement. Postgres acquires a row-level lock on the
// conflicting (user_id, day) row before evaluating the WHERE clause,
// so two concurrent transactions for the SAME user necessarily
// serialize on that lock - one genuinely waits for the other, there is
// no window where both can read "count < limit" before either writes.
// If the WHERE condition is false (already at the limit), the UPDATE
// branch simply does not apply and RETURNING yields no row - that
// absence of a row IS the "not allowed" signal, not an error.
//
// Proven, not just argued from documentation: see
// backend/tests/quota.concurrency.test.mjs, which fires genuinely
// concurrent requests from multiple real Postgres connections against
// a real local database and confirms exactly N succeed under a limit
// of N, never N+1, across repeated runs.

export async function checkAndIncrementQuotaAtomic(pool, userId, dailyLimit) {
  const { rows } = await pool.query(
    `INSERT INTO public.openai_quota (user_id, day, count)
     VALUES ($1, current_date, 1)
     ON CONFLICT (user_id, day) DO UPDATE
       SET count = public.openai_quota.count + 1
       WHERE public.openai_quota.count < $2
     RETURNING count`,
    [userId, dailyLimit]
  );
  if (rows.length === 0) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: dailyLimit - rows[0].count };
}
