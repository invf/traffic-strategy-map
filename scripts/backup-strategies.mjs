#!/usr/bin/env node
// AUTH-003A - a verified, restorable, READ-ONLY backup of every row in
// public.strategies, taken via PostgREST with the project's own public
// anon key (the same key already shipped in the deployed frontend
// bundle - not a secret, nothing new exposed by using it here).
//
// This is a logical/row-level backup, not a pg_dump - this script has
// no direct Postgres credential, only what PostgREST's anon role can
// read. Given RLS is not yet enabled on this table (confirmed - see
// docs/AUTH_003A_SECURITY_FINDINGS.md), this captures every column of
// every row that exists right now, faithfully.
//
// Run with: node scripts/backup-strategies.mjs
// Writes a timestamped JSON file to backups/ (gitignored - this is
// production data, it must never be committed).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://eukogyljakqafnuvrfiv.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error('Set VITE_SUPABASE_ANON_KEY (the public anon/publishable key - the same one already in the deployed app) before running this.');
  process.exit(1);
}

async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/strategies?select=*&order=created_at.asc`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) {
    console.error(`Backup FAILED: PostgREST returned ${res.status}. Nothing was written - this is a hard stop, not a partial backup.`);
    process.exit(1);
  }
  const rows = await res.json();

  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(process.cwd(), 'backups', `strategies-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(rows, null, 2));

  console.log(`Backed up ${rows.length} row(s) to ${outPath}`);
  console.log('Row ids:', rows.map((r) => r.id).join(', '));
  console.log('\nThis file is sufficient to fully restore the table to its exact pre-migration state via scripts/restore-strategies.mjs if needed.');
}

main().catch((err) => {
  console.error('Backup FAILED with an unexpected error - nothing partial was written:', err);
  process.exit(1);
});
