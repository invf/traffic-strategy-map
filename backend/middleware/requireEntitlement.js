// AUTH-003A - entitlement check + per-user rate limit + usage tracking
// for /api/openai. Dependency-injected (checkEntitlement, recordUsage)
// so the policy itself is unit-testable without a real Postgres
// connection - same convention used throughout this engagement
// (resolveProductGateway.ts's GatewayDeps, ssoRoutes.ts's SsoRouterDeps).
//
// Rate limiting is an in-memory Map, single-process only - the same
// documented trade-off Launch Studio's SSO session store already
// accepts for this deployment's scale. A multi-instance deployment
// would need a shared store (Redis, or a Postgres-backed counter);
// noted, not solved here.

const DEFAULT_DAILY_LIMIT = 50;
const usageByUser = new Map(); // userId -> { count, resetAt }

export function __resetRateLimiterForTests() {
  usageByUser.clear();
}

function checkAndIncrementRateLimit(userId, dailyLimit) {
  const now = Date.now();
  const entry = usageByUser.get(userId);
  if (!entry || entry.resetAt <= now) {
    usageByUser.set(userId, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return { allowed: true, remaining: dailyLimit - 1 };
  }
  if (entry.count >= dailyLimit) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: dailyLimit - entry.count };
}

export function createRequireEntitlement({
  checkEntitlement, // (userId) => Promise<'active' | 'none' | 'error'>
  recordUsage = async () => {}, // (userId, meta) => Promise<void> - best-effort, never blocks the response
  dailyLimit = DEFAULT_DAILY_LIMIT,
}) {
  if (typeof checkEntitlement !== 'function') {
    throw new Error('createRequireEntitlement: checkEntitlement is required.');
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

    const { allowed, remaining } = checkAndIncrementRateLimit(req.userId, dailyLimit);
    if (!allowed) {
      return res.status(429).json({ error: { message: 'Daily AI request limit reached. Try again tomorrow.' } });
    }
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    // Fire-and-forget: a logging failure must never block or fail the
    // actual request it's describing.
    void recordUsage(req.userId, { path: req.path, at: new Date().toISOString() }).catch((err) => {
      console.error('[requireEntitlement] Usage recording failed (non-fatal):', err?.message ?? err);
    });

    return next();
  };
}
