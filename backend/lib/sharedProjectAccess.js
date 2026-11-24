// ADV-002B - direct-Postgres access to the shared adveser_core schema
// (projects, project_members, project_products), reusing the SAME
// traffic_strategy_map_app pool backend/lib/entitlements.js already
// maintains - never a second connection to the same database as the same
// role.
//
// Deliberately the SAME shape as invf/adveser-launch-studio's own
// server/db/pg.ts withUserTransaction() - same BEGIN / parameterized
// transaction-local set_config / COMMIT-or-ROLLBACK structure, reusing a
// mechanism already reviewed and proven there rather than inventing a new
// one. See that file's own TRUST BOUNDARY comment for the full reasoning,
// reproduced in short form here:
//
// app.current_user_id is a RELAY of trust established earlier in the
// request (this app's own SSO session verification -> req.userId), never
// an independent identity source. It is what adveser_core's RLS policies
// (is_project_member/is_project_owner-based) read to decide what this
// role can see - a PostgreSQL GRANT alone is NOT sufficient; without this
// GUC set, correctly, every query against these RLS-protected tables
// returns zero rows for a role that isn't the table owner (confirmed
// directly in ADV-002A against entitlements.js's own checkEntitlement(),
// which works ONLY because its one table has a second, GUC-independent
// policy - adveser_core.projects/project_members/project_products have
// no such shortcut: per-user, per-project membership cannot be reduced to
// a static column value the way "does this role see any row for this
// product" can).
//
// set_config($1, $2, true) - the literal `true` third argument - is what
// makes this TRANSACTION-LOCAL (SQL's LOCAL semantics): automatically
// cleared at COMMIT or ROLLBACK, before this function's own `finally`
// ever releases the connection back to the pool. This is what makes
// pooled-connection reuse safe: a later request on this same physical
// connection can never observe a previous request's identity, because
// nothing of it survives past this function's own COMMIT/ROLLBACK.
//
// Every query against adveser_core.projects/project_members/
// project_products from this backend MUST go through this function -
// there is no other sanctioned entry point, mirroring Launch Studio's own
// "every query through withUserTransaction()" discipline exactly.

import { getPool as realGetPool } from './entitlements.js';

// getPool is injectable (defaulting to the real one) purely so a unit
// test can exercise the BEGIN/set_config/COMMIT/ROLLBACK sequencing
// against a fake client, same DI convention as createStrategiesRouter's
// own injectable fetchImpl - never used with anything but the default in
// real server code (server.js never passes this option).
// A reserved, never-real-user sentinel. Confirmed empirically (real
// PostgreSQL 18, see the rehearsal under scratchpad/adv002b_pg): once a
// custom GUC like app.current_user_id has been set via set_config(..., true)
// at least once on a connection, it does NOT revert to a true NULL at
// COMMIT/ROLLBACK - current_setting(name, true) instead returns '' (empty
// string), because Postgres gives a custom GUC's "touched" placeholder a
// reset value of '' the first time it's referenced in a session, not NULL.
// '' fails every ::uuid cast with 22P02 (invalid input syntax), so any LATER
// query on that SAME pooled connection whose RLS policy casts this GUC to
// uuid (e.g. adveser_core.user_product_entitlements_self, which this file
// does not own and must not modify) would crash outright instead of safely
// evaluating its USING clause to false - not an identity leak, but a
// connection "poisoned" for any unrelated query sharing this pool.
// NIL_USER_ID is cast-safe (never throws) and never matches any real user
// (RFC 4122/Postgres gen_random_uuid() never produces it), so explicitly
// setting the GUC to it after every use leaves the connection in a state
// that is both inert (no real identity survives) and safe for whatever
// query happens to run on this connection next.
const NIL_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function withSharedProjectTransaction(userId, fn, { getPool = realGetPool } = {}) {
  // Fails closed BEFORE any connection is even opened - never trusts a
  // caller that forgot to resolve identity first. The caller is always a
  // route handler sourcing this from req.userId (set by requireSsoAuth
  // from the verified session), never from req.body/req.query - this
  // function takes userId as a plain parameter specifically so there is
  // nothing here that could misuse a client-supplied value; it has no
  // access to the request at all.
  if (!userId) {
    throw new Error('withSharedProjectTransaction: userId is required.');
  }

  const client = await getPool().connect();
  // ADV-002B-R1 - tracks whether we can still VOUCH for this connection's
  // transaction state. Once true, nothing more is attempted on it (not
  // even the GUC reset below) - it is destroyed outright in `finally`.
  // Set in exactly two places: a failed COMMIT (ambiguous - committed?
  // aborted? mid-way? never guess), and a failed ROLLBACK after some
  // other failure (the connection may already be unusable, or may still
  // be sitting inside an open transaction we can no longer close safely).
  let transactionStateUncertain = false;
  try {
    await client.query('BEGIN');
    // Parameterized, never string-concatenated - the one place in this
    // file identity is ever written into a session variable.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    const result = await fn(client);
    try {
      await client.query('COMMIT');
    } catch (commitErr) {
      transactionStateUncertain = true;
      throw commitErr;
    }
    return result;
  } catch (err) {
    if (!transactionStateUncertain) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ROLLBACK itself failed (or there was nothing to roll back
        // because BEGIN never succeeded) - the connection's state can no
        // longer be proven clean.
        transactionStateUncertain = true;
      }
    }
    // The ORIGINAL error (err) always wins - a rollback/commit failure
    // caught above is never thrown in its place, and is never what the
    // caller sees.
    throw err;
  } finally {
    if (transactionStateUncertain) {
      // Never attempt more SQL on a connection whose transaction outcome
      // we can't vouch for - not even the GUC reset below. Destroy it
      // outright via node-postgres's documented release(err) mechanism: a
      // truthy argument removes the client from the pool and closes it,
      // rather than returning it for reuse. This is what guarantees no
      // later request can ever check out a connection carrying an
      // unverified identity.
      client.release(true);
    } else {
      // Runs on every clean exit, success or a cleanly-rolled-back
      // failure, BEFORE the connection goes back to the pool. Deliberately
      // session-level (third arg false, not true/LOCAL) and OUTSIDE any
      // transaction - this is what's left behind for whichever request
      // (this app's own, or a totally unrelated one, e.g.
      // checkEntitlement()) next checks out this same connection.
      try {
        await client.query('SELECT set_config($1, $2, false)', ['app.current_user_id', NIL_USER_ID]);
        client.release();
      } catch {
        // The reset itself failed - we can no longer prove this
        // connection is safe to reuse, even though the transaction above
        // committed/rolled back cleanly. Destroy it too, for the same
        // reason: never hand back a connection we can't vouch for.
        client.release(true);
      }
    }
  }
}
