import dotenv from 'dotenv';
import { createApp } from './app.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createRequireEntitlement } from './middleware/requireEntitlement.js';
import { requireDisabled } from './middleware/requireDisabled.js';
import { checkEntitlement, checkQuota, recordUsage } from './lib/entitlements.js';
dotenv.config();

// AUTH-003A Final Security Corrections: configurable daily cap, durable
// (Postgres-backed) quota - see backend/lib/quota.js and
// docs/AUTH_003A_QUOTA_DESIGN.md.
const dailyLimit = process.env.OPENAI_DAILY_QUOTA ? Number(process.env.OPENAI_DAILY_QUOTA) : undefined;

// AUTH-003A Final Security Corrections: exactly two states, chosen
// explicitly - never a silent partial fallback.
//
// State 1 (the real, intended state): TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID
// is set (the OAuth client has been registered - see
// docs/AUTH_003A_OAUTH_CLIENT_SETUP.md) -> full OAuth + per-user
// entitlement + per-user quota.
//
// State 2 (until then): the endpoint is DISABLED - every request gets
// a clear 503, OpenAI is never called. This replaces the earlier
// "Mode 2" shared-secret design, which turned out to be unsafe for
// THIS app's actual architecture: the frontend is a static SPA that
// calls this endpoint directly from the browser
// (src/services/openai.js) - any secret it would need to attach gets
// inlined into the public JS bundle at build time, the same way
// VITE_API_URL already is. A "secret" readable by anyone who opens the
// bundle is not a restriction - see
// docs/AUTH_003A_SHARED_SECRET_REVIEW.md for the full review and why
// "temporarily disable paid AI requests until OAuth SSO is
// operational" (the ticket's own explicit alternative) is the correct
// choice here, not a lesser one.
const clientId = process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID;

let requireAuth;
let requireEntitlement;

if (clientId) {
  requireAuth = createRequireAuth({ expectedClientId: clientId });
  requireEntitlement = createRequireEntitlement({ checkEntitlement, checkQuota, ...(dailyLimit ? { dailyLimit } : {}) });
  console.log('[server] /api/openai running with full OAuth client validation + per-user entitlement + quota.');
} else {
  requireAuth = requireDisabled;
  requireEntitlement = (_req, _res, next) => next(); // never reached - requireDisabled always responds first
  console.warn('[server] TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID is not set - /api/openai is DISABLED (503 for every request, OpenAI is never called) until the OAuth client is registered. See docs/AUTH_003A_OAUTH_CLIENT_SETUP.md.');
}

const app = createApp({
  requireAuth,
  requireEntitlement,
  openaiApiKey: process.env.OPENAI_API_KEY,
  recordUsage,
  frontendUrl: process.env.FRONTEND_URL || '*',
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
