// AUTH-003A - entitlement check + per-user rate limit for /api/openai.
// Dependency-injected (checkEntitlement) so the policy itself is unit-
// testable without a real Postgres connection - same convention used
// throughout this engagement (resolveProductGateway.ts's GatewayDeps,
// ssoRoutes.ts's SsoRouterDeps).
//
// This is the actual spending-prevention mechanism - a best-effort
// usage LOG (see lib/entitlements.js's recordUsage, called separately
// from server.js AFTER the OpenAI call resolves) must never be mistaken
// for this. The two are deliberately decoupled: this counter increments
// synchronously, before any async OpenAI call starts, specifically so
// a burst of concurrent requests can't all read the same "not yet at
// limit" state before any of them is recorded - in JS's single-threaded
// event loop, checkAndIncrementRateLimit's own body has no `await` in
// it, so two concurrent calls for the same user can never interleave
// inside it; the second one always observes the first's increment.
// Logging usage only AFTER a real OpenAI response, by contrast, would
// let N concurrent requests all start before any of them count -
// exactly the race this function exists to prevent.
//
// Rate limiting is an in-memory Map, single-process only - the same
// documented trade-off Launch Studio's SSO session store already
// accepts for this deployment's scale. A multi-instance deployment
// would need a shared store (Redis, or a Postgres-backed counter with
// its own atomic increment, e.g. UPDATE ... SET count = count + 1
// RETURNING count under the same transaction as the check); noted, not
// solved here - Render's render.yaml for this service is a single
// `type: web` instance with no scaling config, so this limitation is
// not currently live, but would become real the moment this service is
// ever scaled horizontally.

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

    // Usage LOGGING (as opposed to the rate-limit COUNTING above) is
    // deliberately NOT done here - see server.js, which calls
    // recordUsage() itself after the OpenAI call actually resolves, so
    // the log reflects what really happened (success/failure/status),
    // not merely that a request was attempted. The rate limit above has
    // already been charged regardless, which is what actually prevents
    // overspend; the log is observability only.

    return next();
  };
}
