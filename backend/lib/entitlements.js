// AUTH-003A - the real (non-test) implementation of checkEntitlement()
// and recordUsage(), injected into requireEntitlement middleware.
//
// Uses a DEDICATED, narrowly-scoped Postgres role
// (traffic_strategy_map_app), never the anon/service_role keys - same
// pattern as invf/adveser-launch-studio's launch_studio_app role
// (SELECT-only on adveser_core.user_product_entitlements). That role
// does not exist yet; provisioning it (plus GRANT SELECT on
// adveser_core.user_product_entitlements, GRANT INSERT on this app's
// own new openai_usage table) is a REQUIRED SETUP STEP before this
// file's exports can be wired into backend/server.js for real - see
// docs/AUTH_003A_SETUP_CHECKLIST.md. This file is prepared and
// reviewable now; it has no effect until that role exists and
// TRAFFIC_STRATEGY_MAP_DB_URL is set.
//
// Direct Postgres, not PostgREST/RLS, for the SAME reason Launch Studio
// uses one: this is a cross-schema, privileged read (another product's
// own entitlement table), not a query scoped to the calling user's own
// rows - RLS is the wrong tool for it.

import pg from 'pg';

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.TRAFFIC_STRATEGY_MAP_DB_URL;
    if (!connectionString) {
      throw new Error('TRAFFIC_STRATEGY_MAP_DB_URL is not configured.');
    }
    pool = new pg.Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function checkEntitlement(userId) {
  try {
    const { rows } = await getPool().query(
      `SELECT status FROM adveser_core.user_product_entitlements WHERE user_id = $1 AND product = 'traffic_strategy_map'`,
      [userId]
    );
    if (rows.length === 0) return 'none';
    return rows[0].status === 'active' ? 'active' : 'none';
  } catch (err) {
    console.error('[entitlements] checkEntitlement query failed:', err?.message ?? err);
    return 'error';
  }
}

// Called from server.js AFTER the OpenAI call resolves (success or
// failure) - this is why `status`/`upstreamStatus` are required fields,
// not optional metadata: this table's whole purpose is to say what
// actually happened, not merely that a request was attempted (the
// rate limiter in requireEntitlement.js is what counts attempts, for
// spending-control purposes; this is observability on top of that,
// best-effort, never load-bearing).
export async function recordUsage(userId, { path, at, status, upstreamStatus = null }) {
  // Best-effort only - the caller already treats a rejection here as
  // non-fatal (see server.js's fire-and-forget call).
  await getPool().query(
    `INSERT INTO public.openai_usage (user_id, path, requested_at, status, upstream_status) VALUES ($1, $2, $3, $4, $5)`,
    [userId, path, at, status, upstreamStatus]
  );
}
