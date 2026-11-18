// AUTH-003A - staging rehearsal, executed against a local, disposable
// Supabase stack (supabase start) - never production. Proves the
// ownership migration + RLS policies behave as designed, with real
// signed-up test users, not just a read of the SQL.
//
// Run with: node supabase/rehearsal.mjs   (after `npx supabase start`)

const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
// Both are the Supabase CLI's own published local-dev defaults - the
// same for anyone running `supabase start` locally, not a secret.

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

async function rest(path, { method = 'GET', key = ANON_KEY, token, body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function createUser(email, password) {
  const { status, body } = await rest('/auth/v1/admin/users', {
    method: 'POST',
    key: SERVICE_ROLE_KEY,
    body: { email, password, email_confirm: true },
  });
  if (status !== 200) throw new Error(`createUser failed: ${status} ${JSON.stringify(body)}`);
  return body.id;
}

async function signIn(email, password) {
  const { status, body } = await rest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: ANON_KEY,
    body: { email, password },
  });
  if (status !== 200) throw new Error(`signIn failed: ${status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function run() {
  // ===== Setup: two real users, signed in with real access tokens =====
  const userAId = await createUser('user-a@rehearsal.test', 'correct-password-1');
  const userBId = await createUser('user-b@rehearsal.test', 'correct-password-2');
  const tokenA = await signIn('user-a@rehearsal.test', 'correct-password-1');
  const tokenB = await signIn('user-b@rehearsal.test', 'correct-password-2');
  console.log(`Created test users: A=${userAId} B=${userBId}\n`);

  // ===== Baseline: 3 "existing, ownerless" strategies, inserted as service_role, matching production's real state =====
  const existingIds = [];
  for (const name of ['Sentipulse — Strategy', 'Sentipulse — Strategy (2)', 'My own SaaS — Strategy']) {
    const { status, body } = await rest('/rest/v1/strategies', {
      method: 'POST',
      key: SERVICE_ROLE_KEY,
      headers: { Prefer: 'return=representation' },
      body: { name, nodes: [], edges: [], product_info: {}, ai_suggestions: [] },
    });
    assert(status === 201, `Seeding one ownerless existing row ("${name}") succeeds`);
    existingIds.push(body[0].id);
  }

  // ===== Test 1: anon can no longer read the ownerless rows (they are NOT auto-classified as demo) =====
  {
    const { status, body } = await rest('/rest/v1/strategies?select=id');
    assert(status === 200, 'Anonymous SELECT still succeeds (not blocked entirely)');
    assert(Array.isArray(body) && body.length === 0, 'But returns ZERO rows - the 3 ownerless existing strategies are private pending review, not auto-public, exactly as required');
  }

  // ===== Test 2: User A creates their OWN strategy =====
  let userAStrategyId;
  {
    const { status, body } = await rest('/rest/v1/strategies', {
      method: 'POST',
      token: tokenA,
      headers: { Prefer: 'return=representation' },
      body: { name: "A's private strategy", user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] },
    });
    assert(status === 201, 'User A can create a strategy owned by themselves');
    userAStrategyId = body[0].id;
  }

  // ===== Test 3: User A can read their own strategy; User B cannot =====
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${userAStrategyId}&select=id`, { token: tokenA });
    assert(status === 200 && body.length === 1, "User A can read their own strategy");
  }
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${userAStrategyId}&select=id`, { token: tokenB });
    assert(status === 200 && body.length === 0, "User B CANNOT read User A's private strategy - RLS returns zero rows, not an error, not the data");
  }

  // ===== Test 4: User B cannot update User A's strategy =====
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${userAStrategyId}`, {
      method: 'PATCH', token: tokenB, headers: { Prefer: 'return=representation' }, body: { name: 'HIJACKED' },
    });
    assert(status === 200 && Array.isArray(body) && body.length === 0, "User B's attempt to update User A's strategy affects ZERO rows - silently rejected by RLS, the strategy is unchanged");
  }

  // ===== Test 5: User B cannot delete User A's strategy =====
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${userAStrategyId}`, {
      method: 'DELETE', token: tokenB, headers: { Prefer: 'return=representation' },
    });
    assert(status === 200 && Array.isArray(body) && body.length === 0, "User B's attempt to delete User A's strategy affects ZERO rows");
    const check = await rest(`/rest/v1/strategies?id=eq.${userAStrategyId}&select=id`, { key: SERVICE_ROLE_KEY });
    assert(check.body.length === 1, "User A's strategy still exists afterward, fully intact");
  }

  // ===== Test 6: User B CANNOT insert a row claiming to be owned by User A =====
  {
    const { status } = await rest('/rest/v1/strategies', {
      method: 'POST', token: tokenB,
      body: { name: 'spoofed', user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] },
    });
    assert(status !== 201, "User B cannot insert a row with user_id spoofed to User A's id - WITH CHECK (user_id = auth.uid()) rejects it");
  }

  // ===== Test 7: User B CANNOT mark their own row as a demo (is_demo is service_role-only in practice) =====
  {
    const { status: insertStatus, body: insertBody } = await rest('/rest/v1/strategies', {
      method: 'POST', token: tokenB, headers: { Prefer: 'return=representation' },
      body: { name: "B's own row", user_id: userBId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] },
    });
    assert(insertStatus === 201, "User B can create their own normal (non-demo) row");
    const bOwnId = insertBody[0].id;
    const { status: patchStatus, body: patchBody } = await rest(`/rest/v1/strategies?id=eq.${bOwnId}`, {
      method: 'PATCH', token: tokenB, headers: { Prefer: 'return=representation' }, body: { is_demo: true },
    });
    // Postgres RLS behavior, confirmed by this exact call: a WITH CHECK
    // violation on UPDATE raises 42501, not a silent 200-with-zero-rows
    // (that silent shape only happens when USING excludes the row from
    // being targeted at all, e.g. the cross-user cases above - a
    // DIFFERENT and less loud failure mode than this one).
    assert(patchStatus === 403 && patchBody?.code === '42501', "User B cannot flip their own row to is_demo=true - the update policy's WITH CHECK requires is_demo = false, rejected with an explicit RLS violation error");
  }

  // ===== Test 8: admin (service_role) explicitly approves ONE existing ownerless row as public demo =====
  {
    const targetId = existingIds[0];
    const { status } = await rest(`/rest/v1/strategies?id=eq.${targetId}`, {
      method: 'PATCH', key: SERVICE_ROLE_KEY, body: { is_demo: true },
    });
    assert(status === 204 || status === 200, 'Admin can explicitly approve one specific existing row as a public demo');

    const { body: anonView } = await rest('/rest/v1/strategies?select=id');
    assert(anonView.length === 1 && anonView[0].id === targetId, "After approval, anon sees EXACTLY that one row - not the other 2 still-ownerless rows, not User A's or B's private rows");
  }

  // ===== Test 9: admin explicitly assigns an owner to one of the remaining ownerless rows =====
  {
    const targetId = existingIds[1];
    const { status } = await rest(`/rest/v1/strategies?id=eq.${targetId}`, {
      method: 'PATCH', key: SERVICE_ROLE_KEY, body: { user_id: userAId },
    });
    assert(status === 204 || status === 200, 'Admin can explicitly assign one specific existing ownerless row to a real user');

    const { body: aView } = await rest(`/rest/v1/strategies?id=eq.${targetId}&select=id`, { token: tokenA });
    assert(aView.length === 1, 'User A can now read the row the admin explicitly assigned to them');
    const { body: bView } = await rest(`/rest/v1/strategies?id=eq.${targetId}&select=id`, { token: tokenB });
    assert(bView.length === 0, "User B still cannot see it - assigning ownership to A did not make it public");
  }

  // ===== Test 10: the one remaining ownerless, non-demo row is still private to everyone (including both test users) =====
  {
    const targetId = existingIds[2];
    const { body: aView } = await rest(`/rest/v1/strategies?id=eq.${targetId}&select=id`, { token: tokenA });
    const { body: bView } = await rest(`/rest/v1/strategies?id=eq.${targetId}&select=id`, { token: tokenB });
    assert(aView.length === 0 && bView.length === 0, 'The 3rd existing row, still neither approved as demo nor assigned an owner, remains invisible to every real user - exactly "private pending review"');
    const { body: adminView } = await rest(`/rest/v1/strategies?id=eq.${targetId}&select=id`, { key: SERVICE_ROLE_KEY });
    assert(adminView.length === 1, 'But the admin (service_role) can always still see and manage it - nothing is lost or inaccessible to review');
  }

  // ===== Test 11: openai_usage table - REVOKE ALL means a hard permission error, not a quiet empty result =====
  {
    const { status, body } = await rest('/rest/v1/openai_usage?select=id', { token: tokenA });
    assert(status === 403 && body?.code === '42501', 'openai_usage is unreachable via a real authenticated user - a hard 403/permission-denied, not a silent empty array, confirming the REVOKE ALL FROM anon, authenticated actually took effect');
  }
  {
    const { status, body } = await rest('/rest/v1/openai_usage', {
      method: 'POST', token: tokenA, body: { user_id: userAId, path: '/api/openai' },
    });
    assert(status === 403 && body?.code === '42501', 'A regular authenticated user cannot write to openai_usage either - only the dedicated app role (never exercised via PostgREST/RLS at all) can');
  }

  console.log(`\n=== REHEARSAL RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Rehearsal crashed:', err);
  process.exit(1);
});
