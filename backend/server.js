import dotenv from 'dotenv';
import { createApp } from './app.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createRequireEntitlement } from './middleware/requireEntitlement.js';
import { createRequireSharedSecret } from './middleware/requireSharedSecret.js';
import { checkEntitlement, recordUsage } from './lib/entitlements.js';
dotenv.config();

// AUTH-003A-3: exactly one of two modes, chosen explicitly - never a
// silent partial fallback. requireAuth itself now throws if asked to
// run without a real expectedClientId (see its own header comment), so
// there is no way to end up "sort of" protected by accident.
//
// Mode 1 (the real, intended state): TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID
// is set (the OAuth client has been registered - see
// docs/AUTH_003A_OAUTH_CLIENT_SETUP.md) -> full OAuth + per-user
// entitlement + per-user quota.
//
// Mode 2 (temporary, explicitly approved): TEMPORARY_SHARED_SECRET is
// set instead -> requireSharedSecret only (see that file's header
// comment for exactly what this does and does not provide - no user
// identity, no per-user entitlement, no per-user quota). This is the
// "temporary service restriction" the ticket allows as a stopgap
// before the OAuth client exists, NOT a substitute for Mode 1.
//
// Neither set -> refuse to start serving this route at all, rather
// than silently leaving it exactly as open as it was before this
// ticket. This is deliberately a hard, loud failure.
const clientId = process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID;
const sharedSecret = process.env.TEMPORARY_SHARED_SECRET;

let requireAuth;
let requireEntitlement;

if (clientId) {
  requireAuth = createRequireAuth({ expectedClientId: clientId });
  requireEntitlement = createRequireEntitlement({ checkEntitlement });
  console.log('[server] /api/openai running in Mode 1: full OAuth client validation + per-user entitlement + quota.');
} else if (sharedSecret) {
  requireAuth = createRequireSharedSecret({ secret: sharedSecret });
  requireEntitlement = (_req, _res, next) => next(); // no per-user concept in this mode - see requireSharedSecret.js
  console.warn('[server] /api/openai running in Mode 2: TEMPORARY shared-secret restriction only. No per-user entitlement or quota is enforced in this mode. This must not be the long-term state.');
} else {
  console.error(
    '[server] Refusing to start: neither TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID nor TEMPORARY_SHARED_SECRET is set. ' +
      '/api/openai would otherwise be exactly as open as it was before AUTH-003A. Set one of the two - see docs/AUTH_003A_SETUP_CHECKLIST.md.'
  );
  process.exit(1);
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
