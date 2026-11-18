#!/usr/bin/env node
// AUTH-003A - restores public.strategies from a backup-strategies.mjs
// JSON file via upsert-on-id. Requires the SERVICE ROLE key (never
// requested via chat, never hardcoded here - read from an env var the
// operator sets locally) because a restore after RLS is enabled must
// bypass it (this script repairs the table, it doesn't act as any one
// user).
//
// Run with: SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-strategies.mjs backups/strategies-<timestamp>.json
//
// Upsert, never delete-then-insert: if something else was legitimately
// written to the table between the backup and the restore, this never
// destroys it - it only guarantees the backed-up rows are present with
// their backed-up values.

import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eukogyljakqafnuvrfiv.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupPath = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (never pass it on the command line, never commit it) before running this.');
  process.exit(1);
}
if (!backupPath) {
  console.error('Usage: node scripts/restore-strategies.mjs <path-to-backup.json>');
  process.exit(1);
}

async function main() {
  const rows = JSON.parse(readFileSync(backupPath, 'utf8'));
  console.log(`Restoring ${rows.length} row(s) from ${backupPath} via upsert (never delete-then-insert)...`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/strategies`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    console.error(`Restore FAILED: PostgREST returned ${res.status}:`, await res.text());
    process.exit(1);
  }
  const restored = await res.json();
  console.log(`Restored ${restored.length} row(s): ${restored.map((r) => r.id).join(', ')}`);
}

main().catch((err) => {
  console.error('Restore FAILED with an unexpected error:', err);
  process.exit(1);
});
