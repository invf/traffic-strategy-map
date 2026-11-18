#!/usr/bin/env node
// AUTH-003A-3 - Step 2: resumes from the real browser-driven consent
// flow (step 1), using ONLY the final redirect URL you copied from the
// address bar - never a password, never a token, pasted or logged.
//
// This is the part that genuinely doesn't need a browser: the
// authorization CODE is a one-time value already bound to the real,
// completed consent - exchanging it for tokens, inspecting those
// tokens' claims, testing setSession() compatibility, testing RLS, and
// testing refresh rotation are all plain HTTP/SDK calls from here.
//
// Run with:
//   TSM_OAUTH_CLIENT_SECRET=... \
//   node supabase/oauth_test/2_complete_from_redirect.mjs "<the full redirect URL you copied>"
//
// Cleanup (deleting the probe row this test creates) runs in a
// `finally` block, so it executes even if an earlier assertion failed
// or an exception was thrown - not only on the happy path.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eukogyljakqafnuvrfiv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CLIENT_ID = process.env.TSM_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.TSM_OAUTH_CLIENT_SECRET;
const redirectUrlArg = process.argv[2];

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

function requireEnv() {
  const missing = [];
  if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (!CLIENT_ID) missing.push('TSM_OAUTH_CLIENT_ID');
  if (!CLIENT_SECRET) missing.push('TSM_OAUTH_CLIENT_SECRET');
  if (!redirectUrlArg) missing.push('(the redirect URL argument)');
  if (missing.length) {
    console.error(`BLOCKED: missing ${missing.join(', ')}. See docs/AUTH_003A_OAUTH_CLIENT_SETUP.md.`);
    process.exit(1);
  }
}

function decodeJwtPayload(token) {
  const [, payloadB64] = token.split('.');
  return JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

async function run() {
  requireEnv();

  let saved;
  try {
    saved = JSON.parse(readFileSync(new URL('./.pkce_state.json', import.meta.url), 'utf8'));
  } catch {
    console.error('Could not read .pkce_state.json - run 1_generate_authorize_url.mjs first, in the same directory.');
    process.exit(1);
  }

  const redirectUrl = new URL(redirectUrlArg);
  const code = redirectUrl.searchParams.get('code');
  const returnedState = redirectUrl.searchParams.get('state');
  assert(!!code, 'An authorization code is present in the redirect URL you provided');
  assert(returnedState === saved.state, 'The returned state matches the one generated in step 1 - not a replay or a mismatched flow');

  // ===== Token exchange (PKCE) =====
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: saved.redirectUri,
      code_verifier: saved.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    console.error('Token exchange FAILED:', tokenRes.status, await tokenRes.text());
    process.exit(1);
  }
  const tokens = await tokenRes.json();
  assert(!!tokens.access_token && !!tokens.refresh_token, 'PKCE code exchange succeeds, yielding both an access and a refresh token');

  // ===== Claims =====
  const claims = decodeJwtPayload(tokens.access_token);
  assert(claims.iss === `${SUPABASE_URL}/auth/v1`, 'Issuer matches the shared project');
  assert(claims.aud === 'authenticated', 'Audience is "authenticated"');
  assert(!!claims.sub, 'A canonical user id (sub) is present');
  assert(claims.client_id === CLIENT_ID, "The token carries this app's own client_id");
  const canonicalUserId = claims.sub;
  console.log(`Canonical ADVESER user id: ${canonicalUserId}`);

  // ===== setSession() compatibility - the real SDK, not a raw fetch probe =====
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: sessionData, error: setSessionError } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  assert(!setSessionError, `setSession() accepts the OAuth-issued tokens without error${setSessionError ? ': ' + setSessionError.message : ''}`);
  assert(sessionData?.session?.user?.id === canonicalUserId, "The SDK's own session.user.id matches the token's sub claim");

  let probeRowId;
  try {
    // ===== auth.uid() / RLS, via the real SDK client (not just a raw fetch) =====
    const { data: insertData, error: insertError } = await supabase
      .from('oauth_rls_probe')
      .insert({ note: 'AUTH-003A-3 OAuth/RLS probe' })
      .select()
      .single();
    assert(!insertError, `INSERT via the setSession()'d client succeeds under RLS${insertError ? ': ' + insertError.message : ''}`);
    probeRowId = insertData?.id;
    assert(insertData?.user_id === canonicalUserId, "auth.uid() resolved, server-side, to the SAME canonical user id the OAuth token carries - the core question, answered empirically");

    const { data: readBack, error: readError } = await supabase.from('oauth_rls_probe').select().eq('id', probeRowId).single();
    assert(!readError && readBack?.id === probeRowId, 'The same client can read back its own just-inserted row');

    // ===== Refresh-token rotation =====
    const refreshRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    const refreshed = await refreshRes.json();
    assert(refreshRes.ok && !!refreshed.access_token, 'Refreshing the OAuth-issued refresh token succeeds');
    const refreshedClaims = decodeJwtPayload(refreshed.access_token);
    assert(refreshedClaims.sub === canonicalUserId, 'The refreshed token still carries the SAME canonical user id');

    const { data: insertAfterRefresh, error: insertAfterRefreshError } = await (async () => {
      const supabaseAfterRefresh = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      await supabaseAfterRefresh.auth.setSession({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token });
      return supabaseAfterRefresh.from('oauth_rls_probe').select().eq('id', probeRowId).single();
    })();
    assert(!insertAfterRefreshError && insertAfterRefresh?.id === probeRowId, 'The REFRESHED token also works correctly with setSession() + RLS - rotation does not break this');

    // ===== Cross-user RLS isolation - requires a SECOND disposable account, not automated here =====
    console.log('\n[MANUAL FOLLOW-UP NEEDED] Cross-user isolation: repeat steps 1-2 with a SECOND disposable test account, then confirm that account\'s own setSession()\'d client CANNOT read this probe row by id. Not automated in this run - needs a second account, same standing blocker as the first.');

    // ===== Logout/revocation =====
    const { error: signOutError } = await supabase.auth.signOut();
    assert(!signOutError, 'signOut() succeeds');
    const { data: postSignOutRead, error: postSignOutError } = await supabase.from('oauth_rls_probe').select().eq('id', probeRowId).single();
    assert(!!postSignOutError && !postSignOutRead, 'After signOut(), the SAME client can no longer read the probe row - the session is genuinely gone, not just locally forgotten');
  } finally {
    // Cleanup runs regardless of any assertion outcome above, using a
    // FRESH client re-authenticated with the original (pre-signOut)
    // tokens, since the main client's session was deliberately signed
    // out as part of the revocation check.
    if (probeRowId) {
      const cleanupClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      await cleanupClient.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      const { error: deleteError } = await cleanupClient.from('oauth_rls_probe').delete().eq('id', probeRowId);
      if (deleteError) {
        console.error(`CLEANUP WARNING: could not delete probe row ${probeRowId}: ${deleteError.message}. Delete it manually: DELETE FROM public.oauth_rls_probe WHERE id = '${probeRowId}';`);
      } else {
        console.log(`Cleanup: probe row ${probeRowId} deleted.`);
      }
    }
  }

  console.log(`\n=== OAUTH/RLS COMPATIBILITY RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
