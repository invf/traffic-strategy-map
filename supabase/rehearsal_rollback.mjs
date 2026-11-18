// AUTH-003A - EXECUTED proof of the CORRECTED post-cutover rollback
// design: suspend writes at the grant level, or fix a specific buggy
// policy - NEVER disable RLS wholesale while private data exists. Run
// against a disposable local Supabase stack, never production.
//
// Run with: node supabase/rehearsal_rollback.mjs   (after `npx supabase db reset`)

const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

async function rest(path, { method = 'GET', key = ANON_KEY, token, body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function createUser(email, password) {
  const { status, body } = await rest('/auth/v1/admin/users', { method: 'POST', key: SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
  if (status !== 200) throw new Error(`createUser failed: ${status} ${JSON.stringify(body)}`);
  return body.id;
}
async function signIn(email, password) {
  const { status, body } = await rest('/auth/v1/token?grant_type=password', { method: 'POST', key: ANON_KEY, body: { email, password } });
  if (status !== 200) throw new Error(`signIn failed: ${status} ${JSON.stringify(body)}`);
  return body.access_token;
}

// Runs raw SQL as the local superuser - standing in for "run this in
// the Supabase SQL Editor," which is how the real rollback would be
// executed against production. This script shells out to `docker exec`
// rather than needing a separate pg client dependency.
import { execSync } from 'node:child_process';
function sql(statement) {
  const escaped = statement.replace(/"/g, '\\"');
  execSync(`docker exec supabase_db_traffic-strategy-map psql -U postgres -d postgres -c "${escaped}"`, { stdio: 'pipe' });
}

async function run() {
  const userAId = await createUser('rollback-a@rehearsal.test', 'password-a-1');
  const userBId = await createUser('rollback-b@rehearsal.test', 'password-b-1');
  const tokenA = await signIn('rollback-a@rehearsal.test', 'password-a-1');
  const tokenB = await signIn('rollback-b@rehearsal.test', 'password-b-1');

  // ===== Baseline: both users have their own private strategy =====
  const { body: aRow } = await rest('/rest/v1/strategies', { method: 'POST', token: tokenA, headers: { Prefer: 'return=representation' }, body: { name: "A's private", user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] } });
  const { body: bRow } = await rest('/rest/v1/strategies', { method: 'POST', token: tokenB, headers: { Prefer: 'return=representation' }, body: { name: "B's private", user_id: userBId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] } });
  const aId = aRow[0].id, bId = bRow[0].id;
  assert(!!aId && !!bId, 'Baseline: both users have their own private strategy before any rollback action');

  // =========================================================
  // SCENARIO 1: Suspend the feature (REVOKE writes), RLS untouched
  // =========================================================
  console.log('\n--- Scenario 1: suspend writes via REVOKE, never touching RLS ---');
  sql('REVOKE INSERT, UPDATE, DELETE ON public.strategies FROM authenticated;');

  {
    const { status } = await rest('/rest/v1/strategies', { method: 'POST', token: tokenA, body: { name: 'blocked', user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] } });
    assert(status === 403 || status === 401, 'After suspension, even the LEGITIMATE owner (User A) cannot write a new strategy - the feature is genuinely offline');
  }
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${aId}&select=id`, { token: tokenA });
    assert(status === 200 && body.length === 1, "User A can STILL READ their own strategy during suspension - this is a write freeze, not a data lockout");
  }
  {
    const { status, body } = await rest(`/rest/v1/strategies?id=eq.${aId}&select=id`, { token: tokenB });
    assert(status === 200 && body.length === 0, "User B STILL CANNOT read User A's private strategy during suspension - isolation is completely unaffected by this rollback action, exactly the point");
  }
  {
    const { body } = await rest('/rest/v1/strategies?select=id');
    assert(body.length === 0, 'Anonymous access remains exactly as restrictive as before - suspension never widens access, only narrows writes');
  }

  console.log('--- Lifting the suspension ---');
  sql('GRANT INSERT, UPDATE, DELETE ON public.strategies TO authenticated;');
  {
    const { status } = await rest('/rest/v1/strategies', { method: 'POST', token: tokenA, headers: { Prefer: 'return=representation' }, body: { name: 'after lift', user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] } });
    assert(status === 201, 'After lifting the suspension, User A can write again');
  }
  {
    const { status } = await rest('/rest/v1/strategies', { method: 'POST', token: tokenB, body: { name: 'spoofed', user_id: userAId, nodes: [], edges: [], product_info: {}, ai_suggestions: [] } });
    assert(status !== 201, "Ownership isolation (WITH CHECK (user_id = auth.uid())) is still fully enforced immediately after lifting suspension - RLS was NEVER disabled, so there is nothing to restore");
  }

  // =========================================================
  // SCENARIO 2: A specific policy is buggy - fix THAT policy, never disable RLS
  // =========================================================
  console.log('\n--- Scenario 2: a deliberately-broken policy, fixed without disabling RLS ---');
  // Simulate a bug: someone accidentally ships a SELECT policy with no
  // ownership check at all (a real mistake that could happen).
  sql('DROP POLICY "read own or approved demo" ON public.strategies;');
  sql(`CREATE POLICY "BUGGY read everything" ON public.strategies FOR SELECT USING (true);`);
  {
    const { body } = await rest(`/rest/v1/strategies?id=eq.${bId}&select=id`, { token: tokenA });
    assert(body.length === 1, "Confirmed the bug is real: User A can now read User B's private strategy through the broken policy (this is the failure being rolled back FROM)");
  }

  console.log('--- Fixing the ONE broken policy, RLS stays enabled throughout ---');
  sql('DROP POLICY "BUGGY read everything" ON public.strategies;');
  sql(`CREATE POLICY "read own or approved demo" ON public.strategies FOR SELECT USING (is_demo = true OR (user_id IS NOT NULL AND user_id = auth.uid()));`);
  {
    const { body } = await rest(`/rest/v1/strategies?id=eq.${bId}&select=id`, { token: tokenA });
    assert(body.length === 0, "Fixed: User A can no longer read User B's private strategy - isolation restored by correcting the ONE broken policy, RLS itself was enabled the entire time (never disabled, never a window of full exposure beyond the deliberate bug being tested)");
  }
  {
    const { body } = await rest(`/rest/v1/strategies?id=eq.${bId}&select=id`, { token: tokenB });
    assert(body.length === 1, "User B can still read their own strategy after the fix");
  }

  // Confirm nothing was ever deleted throughout either scenario. Exactly
  // 3 legitimate rows should exist: aId, bId, and User A's post-lift
  // write - the "spoofed" insert attempt was SUPPOSED to fail (and did,
  // confirmed above), so it correctly never became a 4th row.
  const { body: finalRows } = await rest('/rest/v1/strategies?select=id', { key: SERVICE_ROLE_KEY });
  assert(finalRows.length === 3, `Exactly the 3 legitimately-created strategies still exist (got ${finalRows.length}) - neither rollback scenario deletes data, and the one rejected spoofed insert correctly never created a row`);

  console.log(`\n=== REHEARSAL RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error('Rehearsal crashed:', err); process.exit(1); });
