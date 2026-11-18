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
// AUTH-003A-3 correction: rate limiting is an in-memory Map,
// single-process only. State this plainly rather than imply it's a
// guarantee: this is NOT a production spending ceiling. It resets to
// ZERO on every process restart (Render redeploys, crashes, routine
// restarts - not a rare event), so a user's "daily limit" is really
// "limit per restart interval," which could be many times the stated
// limit over a real day depending on how often the process restarts.
// It is also correct only within a single process - Render's
// render.yaml currently defines this service as one `type: web`
// instance with no scaling config, so that specific gap isn't live
// today, but would become real the moment this service is ever scaled
// horizontally, and nothing enforces that it stays single-instance.
//
// backend/lib/quota.js is the prepared, DURABLE replacement - a single
// atomic Postgres UPSERT (INSERT ... ON CONFLICT ... DO UPDATE ...
// WHERE), proven correct under genuine concurrency in
// backend/tests/quota.concurrency.test.mjs (real concurrent Postgres
// connections, not a mock, not an argument from documentation alone).
// Survives restarts and is correct across any number of instances,
// since the lock lives in Postgres, not in this process's own memory.
// Not yet wired in as the default here - see
// docs/AUTH_003A_QUOTA_DESIGN.md for why and how to adopt it.

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
