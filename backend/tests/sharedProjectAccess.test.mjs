// ADV-002B - backend/lib/sharedProjectAccess.js's withSharedProjectTransaction():
// proves the BEGIN/set_config/COMMIT/ROLLBACK sequencing itself, against
// a fake pool/client (the same DI convention as strategiesProxy.test.mjs's
// fetchImpl). The real RLS/identity-isolation claims this mechanism
// exists to serve are proven separately, against a real PostgreSQL
// instance, in rehearsal_shared_project_access.mjs - a mock cannot prove
// those, only that this function calls the right statements in the right
// order and handles success/failure correctly.
//
// Run with: node backend/tests/sharedProjectAccess.test.mjs

import { withSharedProjectTransaction } from '../lib/sharedProjectAccess.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function fakeClient(queryImpl) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return queryImpl ? queryImpl(text, params) : { rows: [] };
    },
  };
}

function fakePool(client) {
  let released = false;
  return {
    connect: async () => client,
    get released() { return released; },
    _markReleased: () => { released = true; },
  };
}

async function run() {
  // ===== Fails closed BEFORE connecting at all, with no userId =====
  {
    let connectCalled = false;
    const getPool = () => ({ connect: async () => { connectCalled = true; throw new Error('should never be reached'); } });
    let threw = false;
    try {
      await withSharedProjectTransaction(null, async () => {}, { getPool });
    } catch (err) {
      threw = true;
      assert(/userId is required/i.test(err.message), 'The thrown error clearly names the missing userId, not a generic failure');
    }
    assert(threw, 'withSharedProjectTransaction(null, ...) throws synchronously-ish, before any connection');
    assert(!connectCalled, 'getPool().connect() is never called when userId is falsy - fails closed before opening anything');
  }

  // ===== Success path: BEGIN, parameterized set_config, fn, COMMIT, release =====
  {
    const client = fakeClient();
    let released = false;
    const pool = { connect: async () => client, release: () => {} };
    client.release = () => { released = true; };
    const getPool = () => pool;

    const result = await withSharedProjectTransaction('user-123', async (c) => {
      assert(c === client, 'The callback receives the SAME client instance withSharedProjectTransaction itself used for BEGIN/set_config');
      return 'the-callback-result';
    }, { getPool });

    assert(result === 'the-callback-result', "The wrapper returns exactly the callback's own return value");
    const texts = client.calls.map((c) => c.text);
    assert(texts[0] === 'BEGIN', 'First statement is BEGIN');
    assert(texts[1] === 'SELECT set_config($1, $2, true)', 'Second statement is the parameterized, LOCAL (third-arg true) set_config - never string-concatenated');
    assert(JSON.stringify(client.calls[1].params) === JSON.stringify(['app.current_user_id', 'user-123']), 'set_config is called with the exact key app.current_user_id and the real caller-supplied userId');
    assert(texts[2] === 'COMMIT', 'Third statement is COMMIT (the callback itself ran between set_config and COMMIT, not as a captured query)');
    assert(texts[3] === 'SELECT set_config($1, $2, false)', 'After COMMIT, the GUC is reset to a session-level (non-LOCAL) sentinel BEFORE release - see NIL_USER_ID header comment: a custom GUC never truly reverts to NULL on this connection once touched, only to an empty string that crashes a later ::uuid cast, so this leaves the connection cast-safe for whatever unrelated query runs on it next');
    assert(JSON.stringify(client.calls[3].params) === JSON.stringify(['app.current_user_id', '00000000-0000-0000-0000-000000000000']), 'The reset value is the reserved nil UUID - cast-safe, and never matching any real user');
    assert(released, 'The client is released back to the pool after a successful run');
  }

  // ===== Failure path: ROLLBACK runs, release still happens, original error propagates =====
  {
    const client = fakeClient();
    let released = false;
    client.release = () => { released = true; };
    const getPool = () => ({ connect: async () => client });

    let thrown = null;
    try {
      await withSharedProjectTransaction('user-123', async () => {
        throw new Error('callback blew up');
      }, { getPool });
    } catch (err) {
      thrown = err;
    }
    assert(thrown?.message === 'callback blew up', "The ORIGINAL callback error propagates to the caller, not a generic wrapper error");
    const texts = client.calls.map((c) => c.text);
    assert(texts.includes('ROLLBACK'), 'ROLLBACK is issued when the callback throws');
    assert(!texts.includes('COMMIT'), 'COMMIT is never reached on the failure path');
    assert(texts[texts.length - 1] === 'SELECT set_config($1, $2, false)', 'The GUC is reset to the nil-UUID sentinel on the FAILURE path too - a connection must never be left poisoned just because this particular use ended in a ROLLBACK');
    assert(released, 'The client is still released even though the transaction failed - no connection leak');
  }

  // ===== A failed reset itself never masks the real result or error, and release still happens =====
  {
    const client = fakeClient(async (text) => {
      if (text === 'SELECT set_config($1, $2, false)') throw new Error('reset failed - connection already dead');
      return { rows: [] };
    });
    let released = false;
    client.release = () => { released = true; };
    const getPool = () => ({ connect: async () => client });

    const result = await withSharedProjectTransaction('user-123', async () => 'real-result', { getPool });
    assert(result === 'real-result', 'A failed best-effort reset after COMMIT never masks the real, already-returned callback result');
    assert(released, 'release() still runs even when the post-transaction reset itself throws');
  }

  // ===== A failed ROLLBACK itself never masks the original error =====
  {
    const client = fakeClient(async (text) => {
      if (text === 'ROLLBACK') throw new Error('connection already dead');
      return { rows: [] };
    });
    let released = false;
    client.release = () => { released = true; };
    const getPool = () => ({ connect: async () => client });

    let thrown = null;
    try {
      await withSharedProjectTransaction('user-123', async () => {
        throw new Error('the real, original failure');
      }, { getPool });
    } catch (err) {
      thrown = err;
    }
    assert(thrown?.message === 'the real, original failure', "The original error wins even when ROLLBACK itself also fails - a failed rollback is swallowed, never thrown in its place");
    assert(released, 'The client is still released even when ROLLBACK itself throws');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
