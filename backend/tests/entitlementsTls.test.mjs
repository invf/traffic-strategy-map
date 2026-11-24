// AUTH-003C TLS fix - backend/lib/entitlements.js's buildPoolConfig():
// proves (a) a configured CA produces an explicit, verifying `ssl` object
// - never rejectUnauthorized: false - and (b) that object actually
// survives `pg`'s own connectionString-merge instead of being silently
// discarded, which is the exact bug this fix addresses (see entitlements.js's
// own comment on stripSslQueryParams for how that merge works).
// Run with: node backend/tests/entitlementsTls.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ConnectionParameters from 'pg/lib/connection-parameters.js';
import { buildPoolConfig, readCaCertificate, stripSslQueryParams, assertSessionPoolerMode } from '../lib/entitlements.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

const REAL_SHAPED_URL =
  'postgresql://traffic_strategy_map_app.eukogyljakqafnuvrfiv:CHANGE_ME@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require';

async function run() {
  // ===== stripSslQueryParams =====
  {
    const stripped = stripSslQueryParams(REAL_SHAPED_URL);
    assert(!stripped.includes('sslmode'), 'sslmode is removed from the connection string');
    assert(stripped.includes('traffic_strategy_map_app.eukogyljakqafnuvrfiv'), 'the username is preserved unchanged');
    assert(stripped.includes('aws-0-eu-west-1.pooler.supabase.com'), 'the host is preserved unchanged');
    assert(stripped.includes(':5432'), 'the port is preserved unchanged');
    assert(stripped.includes('/postgres'), 'the database name is preserved unchanged');
  }
  {
    const notAUrl = 'host=localhost dbname=postgres';
    assert(stripSslQueryParams(notAUrl) === notAUrl, 'a non-URL-shaped (libpq key=value) connection string is returned unchanged, not thrown on');
  }

  // ===== readCaCertificate =====
  {
    assert(readCaCertificate({}) === null, 'no CA configured at all returns null');
  }
  {
    const ca = readCaCertificate({ TRAFFIC_STRATEGY_MAP_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----' });
    assert(ca.includes('\n') && !ca.includes('\\n'), 'a CA with real newlines is passed through unchanged');
  }
  {
    const ca = readCaCertificate({ TRAFFIC_STRATEGY_MAP_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----' });
    assert(ca.includes('\n') && !ca.includes('\\n'), 'a CA pasted with literal \\n (single-line env var UI) is normalized to real newlines');
  }
  {
    const file = path.join(os.tmpdir(), `tsm-ca-test-${process.pid}.pem`);
    fs.writeFileSync(file, '-----BEGIN CERTIFICATE-----\nFROM-FILE\n-----END CERTIFICATE-----\n');
    try {
      const ca = readCaCertificate({ TRAFFIC_STRATEGY_MAP_DB_CA_CERT_FILE: file, TRAFFIC_STRATEGY_MAP_DB_CA_CERT: 'should-not-be-used' });
      assert(ca.includes('FROM-FILE'), 'TRAFFIC_STRATEGY_MAP_DB_CA_CERT_FILE is read from disk and takes priority over the inline env var');
    } finally {
      fs.unlinkSync(file);
    }
  }

  // ===== buildPoolConfig: no CA configured -> unchanged legacy behavior =====
  {
    const config = buildPoolConfig(REAL_SHAPED_URL, {});
    assert(config.connectionString === REAL_SHAPED_URL, 'with no CA configured, the connection string is passed through completely untouched (sslmode intact)');
    assert(!('ssl' in config), 'with no CA configured, no explicit ssl object is set - local non-TLS Postgres must keep working');
  }

  // ===== buildPoolConfig: CA configured -> explicit, verifying ssl object =====
  {
    const env = { TRAFFIC_STRATEGY_MAP_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----' };
    const config = buildPoolConfig(REAL_SHAPED_URL, env);
    assert(!config.connectionString.includes('sslmode'), 'with a CA configured, sslmode is stripped from the connection string before it reaches pg');
    assert(typeof config.ssl === 'object' && config.ssl !== null, 'with a CA configured, an explicit ssl object is set');
    assert(config.ssl.ca === env.TRAFFIC_STRATEGY_MAP_DB_CA_CERT, 'the ssl object carries the configured CA certificate');
    assert(config.ssl.rejectUnauthorized === true, 'rejectUnauthorized is explicitly true - chain AND hostname verification stay on, never bypassed');
  }

  // ===== The critical regression this fix exists to catch: the explicit =====
  // ===== ssl object must actually survive pg's own connectionString merge =====
  {
    const env = { TRAFFIC_STRATEGY_MAP_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\nSURVIVES\n-----END CERTIFICATE-----' };
    const config = buildPoolConfig(REAL_SHAPED_URL, env);
    const merged = new ConnectionParameters(config);
    assert(
      merged.ssl && merged.ssl.ca === env.TRAFFIC_STRATEGY_MAP_DB_CA_CERT && merged.ssl.rejectUnauthorized === true,
      "the CA survives pg's ConnectionParameters merge intact - proves stripping sslmode actually prevents the silent-override bug this fix addresses"
    );
  }
  {
    // Without the fix (ssl passed alongside a connectionString that STILL
    // has sslmode in it), pg-connection-string's parse() returns its own
    // `ssl` key and silently wipes out the CA - this is the exact bug.
    // Documented here as a negative control so a future refactor that
    // reintroduces it is caught by this same test file.
    const buggyConfig = {
      connectionString: REAL_SHAPED_URL, // sslmode NOT stripped
      ssl: { ca: 'SHOULD-BE-LOST', rejectUnauthorized: true },
      max: 5,
    };
    const merged = new ConnectionParameters(buggyConfig);
    assert(
      !merged.ssl || merged.ssl.ca !== 'SHOULD-BE-LOST',
      'negative control: passing ssl alongside an UN-stripped sslmode connection string reproduces the silent-override bug - confirms stripSslQueryParams is load-bearing, not redundant'
    );
  }

  // ===== ADV-002B-R1: assertSessionPoolerMode =====
  {
    let threw = false;
    try { assertSessionPoolerMode(REAL_SHAPED_URL); } catch { threw = true; }
    assert(!threw, 'The real, documented Production URL (session pooler, port 5432) never throws');
  }
  {
    const transactionPoolerUrl = 'postgresql://traffic_strategy_map_app.eukogyljakqafnuvrfiv:CHANGE_ME@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
    let thrown = null;
    try { assertSessionPoolerMode(transactionPoolerUrl); } catch (err) { thrown = err; }
    assert(thrown !== null, "Supabase's TRANSACTION pooler (pooler.supabase.com, port 6543) is rejected outright, before any pool is ever constructed");
    assert(/transaction pooler/i.test(thrown?.message ?? ''), 'The error clearly names WHAT is wrong (the transaction pooler), not a generic connection failure');
    assert(/6543/.test(thrown?.message ?? ''), 'The error names the specific offending port, for a fast diagnosis');
  }
  {
    // Scoped NARROWLY to Supabase's own pooler hostname convention - an
    // unrelated service that happens to use port 6543 for some other
    // reason (or a local rehearsal database on an arbitrary port) is
    // never rejected by this check.
    const unrelatedServiceOn6543 = 'postgresql://someuser:pw@example.com:6543/somedb';
    let threw = false;
    try { assertSessionPoolerMode(unrelatedServiceOn6543); } catch { threw = true; }
    assert(!threw, 'A non-Supabase-pooler host on port 6543 is NOT rejected - this check targets the one real, documented risk, not every use of that port number');
  }
  {
    const localRehearsalUrl = 'postgresql://traffic_strategy_map_app@127.0.0.1:5545/rehearsal';
    let threw = false;
    try { assertSessionPoolerMode(localRehearsalUrl); } catch { threw = true; }
    assert(!threw, 'A local disposable rehearsal database on an arbitrary port is never rejected');
  }
  {
    const notAUrl = 'host=localhost dbname=postgres';
    let threw = false;
    try { assertSessionPoolerMode(notAUrl); } catch { threw = true; }
    assert(!threw, 'A non-URL-shaped (libpq key=value) connection string is let through unchanged, not thrown on - same convention as stripSslQueryParams');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
