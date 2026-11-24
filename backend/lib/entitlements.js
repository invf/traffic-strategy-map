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
import fs from 'node:fs';
import { checkAndIncrementQuotaAtomic } from './quota.js';

// AUTH-003C TLS fix: the prior "let the connection string's own ?sslmode=
// decide" approach (see git history) resolved `sslmode=require` to a FULL
// verify - correct in principle, but Supabase's Shared Session Pooler
// presents a chain rooted at a CA that is not in Node's default trust
// store, so full verification fails with "self-signed certificate in
// certificate chain". The fix is an explicit CA, not a weaker verification
// mode (rejectUnauthorized: false and sslmode=no-verify both disable chain
// AND hostname verification - never used here).
const SSL_QUERY_PARAM_PATTERN = /^ssl/i;

// Confirmed directly against node_modules/pg/lib/connection-parameters.js:
// `new pg.Pool({ connectionString, ssl })` runs
// `config = Object.assign({}, config, parse(connectionString))` - and
// pg-connection-string's parse() ALWAYS returns its own `ssl` key whenever
// the string has a `sslmode` param (e.g. `{}` for sslmode=require), which
// completely overwrites whatever explicit `ssl` object was passed
// alongside `connectionString`, silently discarding the CA. Stripping the
// ssl* query params before constructing the Pool is the only way an
// explicit `ssl` object survives this merge.
export function stripSslQueryParams(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    // Not URL-shaped (e.g. libpq key=value form) - nothing to strip here;
    // falls back to whatever that form's own sslmode handling does.
    return connectionString;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SSL_QUERY_PARAM_PATTERN.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

// TRAFFIC_STRATEGY_MAP_DB_CA_CERT_FILE (a mounted PEM file, e.g. a Render
// "Secret File") is preferred when set, since it needs no escaping.
// TRAFFIC_STRATEGY_MAP_DB_CA_CERT (the PEM content directly in an env var)
// is the fallback; a literal "\n" (common when a multi-line PEM is pasted
// into a single-line env var UI) is normalized to a real newline so it
// still parses as a valid certificate.
export function readCaCertificate(env = process.env) {
  const fromFile = env.TRAFFIC_STRATEGY_MAP_DB_CA_CERT_FILE;
  if (fromFile) {
    return fs.readFileSync(fromFile, 'utf8');
  }
  const inline = env.TRAFFIC_STRATEGY_MAP_DB_CA_CERT;
  if (inline) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  return null;
}

export function buildPoolConfig(connectionString, env = process.env) {
  const ca = readCaCertificate(env);
  if (!ca) {
    // No CA configured - unchanged from before this fix: TLS (if any) is
    // entirely decided by the connection string's own ?sslmode= parameter
    // via pg's own parsing. Required for this to keep working against a
    // local, non-TLS Postgres (no sslmode param present at all).
    return { connectionString, max: 5 };
  }
  // A CA is configured: verify BOTH the certificate chain (via `ca`) and
  // the hostname (pg sets `servername` from the connection host whenever
  // `rejectUnauthorized` isn't explicitly false - confirmed directly
  // against node_modules/pg/lib/connection.js's upgradeToSSL()). Never
  // rejectUnauthorized: false, never sslmode=no-verify, never
  // NODE_TLS_REJECT_UNAUTHORIZED=0.
  return {
    connectionString: stripSslQueryParams(connectionString),
    ssl: { ca, rejectUnauthorized: true },
    max: 5,
  };
}

let pool;
// ADV-002B - exported so backend/lib/sharedProjectAccess.js can reuse the
// SAME pool/connection (same role, same TLS config, same max:5 sizing)
// for the new adveser_core.projects/project_members/project_products
// queries, instead of opening a second pool to the same database as the
// same role. getPool() itself is unchanged - still lazily constructed,
// still a module-level singleton either caller can trigger first.
export function getPool() {
  if (!pool) {
    const connectionString = process.env.TRAFFIC_STRATEGY_MAP_DB_URL;
    if (!connectionString) {
      throw new Error('TRAFFIC_STRATEGY_MAP_DB_URL is not configured.');
    }
    pool = new pg.Pool(buildPoolConfig(connectionString));
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

// AUTH-003A Final Security Corrections: the real, durable quota check
// wired into requireEntitlement.js - see backend/lib/quota.js for the
// atomic SQL and backend/tests/quota.concurrency.test.mjs for the
// concurrency proof. Deliberately does NOT catch its own errors here -
// requireEntitlement.js's own try/catch treats a thrown error as "fail
// closed" (503), the same discipline as checkEntitlement above.
export async function checkQuota(userId, dailyLimit) {
  return checkAndIncrementQuotaAtomic(getPool(), userId, dailyLimit);
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
