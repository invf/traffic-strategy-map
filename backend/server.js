import dotenv from 'dotenv';
import { createApp } from './app.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createRequireEntitlement } from './middleware/requireEntitlement.js';
import { checkEntitlement, recordUsage } from './lib/entitlements.js';
dotenv.config();

// AUTH-003A: this route is gated behind requireAuth + requireEntitlement
// - see docs/AUTH_003A_SETUP_CHECKLIST.md for what must be configured
// (TRAFFIC_STRATEGY_MAP_DB_URL, the traffic_strategy_map_app role,
// TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID) before this takes effect in
// Production. Until that setup is done, requireAuth still rejects any
// request with no valid token (fails closed), so this is safe to
// deploy ahead of the entitlement wiring being fully live - it only
// makes the endpoint STRICTER, never looser, at every step.
//
// expectedClientId: without this, a valid token issued to a DIFFERENT
// OAuth client of the same shared Supabase project (e.g. Launch
// Studio's) would be accepted here too - every client's tokens share
// the same issuer/audience/signing key. Left undefined only when the
// env var genuinely isn't set yet (early rollout); once this app's own
// OAuth client is registered, this MUST be set.
const app = createApp({
  requireAuth: createRequireAuth({ expectedClientId: process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID || undefined }),
  requireEntitlement: createRequireEntitlement({ checkEntitlement }),
  openaiApiKey: process.env.OPENAI_API_KEY,
  recordUsage,
  frontendUrl: process.env.FRONTEND_URL || '*',
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
