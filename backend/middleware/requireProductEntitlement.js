// AUTH-003B - fixes the confirmed authorization gap in /api/strategies
// (docs/AUTH_003B_PRE_DEPLOYMENT_AUDIT.md's Task 4 finding):
// requireSsoAuth only confirms a real, signed-in ADVESER account - it
// never checked whether that account actually holds the
// traffic_strategy_map entitlement, so any signed-in account could use
// the strategies feature regardless of product ownership.
//
// Deliberately NOT createRequireEntitlement (backend/middleware/
// requireEntitlement.js) reused as-is: that middleware's constructor
// REQUIRES a checkQuota function and always calls it - correct for
// /api/openai (a metered, spending-control resource), wrong here.
// Strategies CRUD has no notion of a daily quota; forcing one through
// would mean either a meaningless fake checkQuota or, worse, actually
// consuming /api/openai's own daily cap on a request that never calls
// OpenAI at all. This is the standalone entitlement-only half of that
// same policy, reusing the same checkEntitlement() implementation
// (backend/lib/entitlements.js) - one source of truth for "does this
// user have the entitlement," two different middlewares for two
// different resources' own enforcement shape.
export function createRequireProductEntitlement({ checkEntitlement }) {
  if (typeof checkEntitlement !== 'function') {
    throw new Error('createRequireProductEntitlement: checkEntitlement is required.');
  }

  return async function requireProductEntitlement(req, res, next) {
    if (!req.userId) {
      // requireSsoAuth must run first - this is a programming error,
      // not a user-facing case, so it's a 500, not a 401/403. Same
      // discipline as requireEntitlement.js's own guard.
      return res.status(500).json({ error: { message: 'Entitlement check ran before authentication.' } });
    }

    let status;
    try {
      status = await checkEntitlement(req.userId);
    } catch (err) {
      // Never reached by the real checkEntitlement() (it catches its
      // own errors and resolves to 'error'), but an injected fake in
      // a test, or any future implementation, might throw - an
      // infrastructure failure here is NEVER treated as permission
      // granted, fails closed exactly like checkEntitlement()'s own
      // 'error' branch below.
      console.error('[requireProductEntitlement] Entitlement check failed (infrastructure):', err?.message ?? err);
      return res.status(503).json({ error: { message: 'Could not verify access right now. Try again shortly.' } });
    }

    if (status === 'error') {
      // Distinguished from a real denial - an outage must never look
      // like a real access decision.
      return res.status(503).json({ error: { message: 'Could not verify access right now. Try again shortly.' } });
    }
    if (status !== 'active') {
      return res.status(403).json({ error: { message: 'Your account does not have access to Traffic Strategy Map.' } });
    }

    return next();
  };
}
