// AUTH-003A - entitlement check + durable quota reservation for
// /api/openai. Dependency-injected (checkEntitlement, checkQuota) so
// the policy itself is unit-testable without a real Postgres
// connection - same convention used throughout this engagement
// (resolveProductGateway.ts's GatewayDeps, ssoRoutes.ts's SsoRouterDeps).
//
// AUTH-003A Final Security Corrections: checkQuota is now the durable,
// atomic, Postgres-backed implementation (backend/lib/quota.js),
// wired in by server.js - not the earlier in-memory Map, which was
// honestly documented as NOT a production spending guarantee (reset on
// every restart, correct only within one process). The durable version
// survives restarts and is correct across any number of instances,
// proven under genuine concurrency in
// backend/tests/quota.concurrency.test.mjs (real concurrent Postgres
// connections, not a mock).
//
// checkQuota is called and must reserve the quota ATOMICALLY BEFORE
// next() - synchronously relative to the OpenAI call, which hasn't
// started yet at this point - so a burst of concurrent requests can't
// all read "not yet at limit" before any of them is recorded. Usage
// LOGGING (as opposed to this quota RESERVATION) happens separately,
// in app.js, AFTER the OpenAI call resolves, reflecting the real
// outcome - the two remain deliberately decoupled, as before.
//
// Fails CLOSED if quota enforcement itself is unavailable (e.g. the
// database is unreachable) - a thrown error from checkQuota is treated
// as "cannot verify, so do not allow" (503), the same discipline
// already applied to checkEntitlement. An unavailable quota check must
// never be silently treated as "no limit."

const DEFAULT_DAILY_LIMIT = 50;

export function createRequireEntitlement({
  checkEntitlement, // (userId) => Promise<'active' | 'none' | 'error'>
  checkQuota, // (userId, dailyLimit) => Promise<{ allowed: boolean, remaining: number }>
  dailyLimit = DEFAULT_DAILY_LIMIT,
}) {
  if (typeof checkEntitlement !== 'function') {
    throw new Error('createRequireEntitlement: checkEntitlement is required.');
  }
  if (typeof checkQuota !== 'function') {
    throw new Error('createRequireEntitlement: checkQuota is required (the durable, atomic quota check - see backend/lib/quota.js). There is no in-memory fallback.');
  }

  return async function requireEntitlement(req, res, next) {
    if (!req.userId) {
      // requireAuth must run first - this is a programming error, not a
      // user-facing case, so it's a 500, not a 401/403.
      return res.status(500).json({ error: { message: 'Entitlement check ran before authentication.' } });
    }

    let status;
    try {
      status = await checkEntitlement(req.userId);
    } catch (err) {
      console.error('[requireEntitlement] Entitlement check failed (infrastructure):', err?.message ?? err);
      return res.status(503).json({ error: { message: 'Could not verify access right now. Try again shortly.' } });
    }

    if (status === 'error') {
      // Distinguished from a real denial, same discipline as
      // lib/entitlements/types.ts's EntitlementStatus in adveser-platform.
      return res.status(503).json({ error: { message: 'Could not verify access right now. Try again shortly.' } });
    }
    if (status !== 'active') {
      return res.status(403).json({ error: { message: 'Your account does not have access to Traffic Strategy Map.' } });
    }

    let quota;
    try {
      quota = await checkQuota(req.userId, dailyLimit);
    } catch (err) {
      // Fail CLOSED: quota enforcement being unavailable is never
      // treated as "no limit, let it through" - it is treated exactly
      // like an entitlement-check infrastructure failure.
      console.error('[requireEntitlement] Quota check failed (infrastructure):', err?.message ?? err);
      return res.status(503).json({ error: { message: 'Could not verify your usage limit right now. Try again shortly.' } });
    }

    if (!quota.allowed) {
      return res.status(429).json({ error: { message: 'Daily AI request limit reached. Try again tomorrow.' } });
    }
    res.setHeader('X-RateLimit-Remaining', String(quota.remaining));

    return next();
  };
}
