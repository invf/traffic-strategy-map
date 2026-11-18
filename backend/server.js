import dotenv from 'dotenv';
import { createApp } from './app.js';
import { createSsoRouter, ensureValidAccessToken } from './routes/ssoRoutes.js';
import { createStrategiesRouter } from './routes/strategiesProxy.js';
import { requireSsoAuth } from './middleware/requireSsoAuth.js';
import { createRequireEntitlement } from './middleware/requireEntitlement.js';
import { createRequireProductEntitlement } from './middleware/requireProductEntitlement.js';
import { requireDisabled } from './middleware/requireDisabled.js';
import { checkEntitlement, checkQuota, recordUsage } from './lib/entitlements.js';
import { validateDailyQuota } from './lib/validateDailyQuota.js';
dotenv.config();

// AUTH-003B: FRONTEND_URL is now REQUIRED, not an optional CORS nicety
// that falls back to '*' - the SSO cookie's cross-origin delivery
// (credentials: true) is forbidden by the CORS spec when combined with
// origin: '*', and the callback route needs a real origin to redirect
// back to. Fails loudly here, with a clear message, rather than let it
// crash less legibly inside createSsoRouter.
if (!process.env.FRONTEND_URL) {
  console.error('[server] Refusing to start: FRONTEND_URL is required (the SSO cookie and callback redirect both need a real, specific frontend origin - "*" is not valid here).');
  process.exit(1);
}

// AUTH-003B: configurable, strictly-validated daily cap (AUTH-003A).
const dailyLimit = validateDailyQuota(process.env.OPENAI_DAILY_QUOTA);

// AUTH-003B: the SSO router (start/callback/session/logout) is always
// mounted - each of its own routes already handles a missing OAuth
// client configuration gracefully (redirects with sso_error=config_error,
// never a raw crash), so there's no reason to gate mounting it behind
// the same check /api/openai uses.
const ssoRouter = createSsoRouter({ frontendUrl: process.env.FRONTEND_URL });

// /api/openai: exactly two states, same principle as AUTH-003A's Final
// Security Corrections - chosen explicitly, never a silent partial
// fallback. The frontend authenticates via THIS app's own SSO cookie
// (requireSsoAuth), not a raw Bearer OAuth token - tokens never leave
// this server (see backend/auth/ssoSession.js's own header comment).
const sessionSecretConfigured = !!process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET;
const oauthClientConfigured = !!(
  process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID &&
  process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_SECRET &&
  process.env.TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI
);
// AUTH-003B pre-deployment audit fix: checkEntitlement/checkQuota both
// need a real Postgres connection (lib/entitlements.js's getPool()) -
// previously absent from this readiness check entirely, so the
// startup log could claim "/api/openai running with ... per-user
// entitlement + durable quota" while every real request actually
// 503'd the moment getPool() threw on the missing connection string.
// Now load-bearing here, not just a lazily-discovered runtime failure.
const dbUrlConfigured = !!process.env.TRAFFIC_STRATEGY_MAP_DB_URL;

let requireAuth;
let requireEntitlement;

if (oauthClientConfigured && sessionSecretConfigured && dbUrlConfigured) {
  requireAuth = requireSsoAuth;
  requireEntitlement = createRequireEntitlement({ checkEntitlement, checkQuota, ...(dailyLimit ? { dailyLimit } : {}) });
  console.log('[server] /api/openai running with full SSO cookie auth + per-user entitlement + durable quota.');
} else {
  requireAuth = requireDisabled;
  requireEntitlement = (_req, _res, next) => next(); // never reached - requireDisabled always responds first
  console.warn('[server] SSO is not fully configured (OAuth client, TRAFFIC_STRATEGY_MAP_SESSION_SECRET, and/or TRAFFIC_STRATEGY_MAP_DB_URL missing) - /api/openai is DISABLED (503 for every request, OpenAI is never called). See docs/AUTH_003A_OAUTH_CLIENT_SETUP.md and docs/AUTH_003B_IMPLEMENTATION_TICKET.md.');
}

// AUTH-003B - the strategies proxy needs a real Supabase access token
// (via ensureValidAccessToken), which in turn needs a configured OAuth
// client, PLUS the project's own URL and anon key to reach PostgREST,
// PLUS (pre-deployment audit fix) TRAFFIC_STRATEGY_MAP_DB_URL for the
// entitlement check below. Same "absent, not silently degraded"
// discipline as /api/openai above: without all of this, the routes
// are simply not mounted (404), rather than mounted and failing open
// or closed in some less legible way.
const strategiesProxyConfigured = !!(
  oauthClientConfigured &&
  sessionSecretConfigured &&
  dbUrlConfigured &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_ANON_KEY
);

let strategiesRouter;
let requireProductEntitlement;
if (strategiesProxyConfigured) {
  strategiesRouter = createStrategiesRouter({ ensureValidAccessToken });
  // AUTH-003B pre-deployment audit fix: confirming identity
  // (requireSsoAuth) is not the same as confirming this account holds
  // the traffic_strategy_map entitlement - nothing previously checked
  // that. Entitlement-only, never the OpenAI quota middleware above -
  // strategies CRUD is not a metered resource.
  requireProductEntitlement = createRequireProductEntitlement({ checkEntitlement });
  console.log('[server] /api/strategies proxy is active (authenticated, entitlement-checked strategy saving/loading via the SSO session).');
} else {
  console.warn('[server] /api/strategies proxy is NOT mounted (OAuth client, session secret, TRAFFIC_STRATEGY_MAP_DB_URL, SUPABASE_URL, and/or SUPABASE_ANON_KEY missing) - the frontend must keep using its existing direct-Supabase save/load flow until this is configured.');
}

const app = createApp({
  requireAuth,
  requireEntitlement,
  openaiApiKey: process.env.OPENAI_API_KEY,
  recordUsage,
  frontendUrl: process.env.FRONTEND_URL || '*',
  ssoRouter,
  requireSsoAuth,
  requireProductEntitlement,
  strategiesRouter,
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
