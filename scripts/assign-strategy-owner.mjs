#!/usr/bin/env node
// AUTH-003A - the ONLY sanctioned way to give an existing, ownerless
// strategy an owner, or to approve it as a public demo. Deliberately
// one row at a time, by explicit id, never a bulk operation, never
// driven by matching email or strategy name - the ticket's own
// restriction. An administrator runs this by hand, after looking at
// the specific row, for the specific person.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (never hardcoded, never passed on
// the command line - set it as an env var in your own shell first).
//
// Usage:
//   node scripts/assign-strategy-owner.mjs <strategy_id> --owner <auth.users.id>
//   node scripts/assign-strategy-owner.mjs <strategy_id> --demo
//
// Either flag is exclusive and explicit - this script refuses to guess
// which one you meant, and refuses to run against more than one id per
// invocation.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eukogyljakqafnuvrfiv.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [strategyId, flag, value] = process.argv.slice(2);

function usageError(message) {
  console.error(message);
  console.error('Usage: node scripts/assign-strategy-owner.mjs <strategy_id> --owner <auth.users.id>');
  console.error('   or: node scripts/assign-strategy-owner.mjs <strategy_id> --demo');
  process.exit(1);
}

if (!SERVICE_ROLE_KEY) usageError('Set SUPABASE_SERVICE_ROLE_KEY first.');
if (!strategyId || !/^[0-9a-f-]{36}$/i.test(strategyId)) usageError('First argument must be the exact strategy row id (a UUID).');
if (flag !== '--owner' && flag !== '--demo') usageError('Specify exactly one of --owner <uuid> or --demo.');
if (flag === '--owner' && (!value || !/^[0-9a-f-]{36}$/i.test(value))) usageError('--owner requires a valid auth.users.id (UUID).');

async function getRow(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/strategies?id=eq.${id}&select=id,name,user_id,is_demo,created_at`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Lookup failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function main() {
  const before = await getRow(strategyId);
  if (!before) {
    console.error(`No strategy with id ${strategyId} exists. Nothing changed.`);
    process.exit(1);
  }
  console.log('Current row:', before);

  const patch = flag === '--demo' ? { is_demo: true } : { user_id: value };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/strategies?id=eq.${strategyId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error(`Update FAILED: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const [after] = await res.json();
  console.log('Updated row:', after);
  console.log(flag === '--demo' ? 'Approved as a public demo strategy.' : `Assigned to user ${value}.`);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
