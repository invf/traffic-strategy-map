#!/usr/bin/env node
// AUTH-003A-3 - Step 1 of the corrected, browser-assisted OAuth test.
//
// The original single-script harness tried to fake the ADVESER
// Platform session by passing a raw Supabase access token as a Bearer
// header to the /authorize endpoint. That endpoint does not look at
// Authorization headers to determine whether the browser is logged in
// - it unconditionally redirects to <Site URL><Authorization Path>,
// and it's that DESTINATION page (ADVESER Platform's own
// /oauth/consent, a Next.js Server Component) that checks the
// browser's actual session COOKIE (set by @supabase/ssr's own
// multi-chunk cookie format when a real sign-in happens through the
// real UI). A script cannot fake that cookie without reimplementing
// @supabase/ssr's exact internal format - fragile and pointless when
// a real browser already does this correctly. Hence: browser-assisted.
//
// This script only does the parts that don't need a browser: generate
// PKCE values and the exact authorize URL to open. It saves the
// verifier/state to a local, gitignored file for step 3 to use -
// NEVER prints or logs them in a way that could end up in a shared
// terminal transcript beyond what's needed to copy the URL.
//
// Run with: node supabase/oauth_test/1_generate_authorize_url.mjs

import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eukogyljakqafnuvrfiv.supabase.co';
const CLIENT_ID = process.env.TSM_OAUTH_CLIENT_ID;
const REDIRECT_URI = process.env.TSM_OAUTH_REDIRECT_URI || 'https://traffic-strategy-map-drab.vercel.app/auth/callback';

if (!CLIENT_ID) {
  console.error('Set TSM_OAUTH_CLIENT_ID first - see docs/AUTH_003A_OAUTH_CLIENT_SETUP.md. Nothing to generate without it.');
  process.exit(1);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const codeVerifier = base64url(crypto.randomBytes(32));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const authorizeUrl = new URL(`${SUPABASE_URL}/auth/v1/oauth/authorize`);
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', CLIENT_ID);
authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('code_challenge', codeChallenge);
authorizeUrl.searchParams.set('code_challenge_method', 'S256');
authorizeUrl.searchParams.set('scope', 'openid email');

// Gitignored (see supabase/oauth_test/.gitignore) - contains the PKCE
// verifier, which is sensitive for the duration of this one flow (not
// a long-lived secret, but still never committed).
writeFileSync(new URL('./.pkce_state.json', import.meta.url), JSON.stringify({ codeVerifier, state, redirectUri: REDIRECT_URI }, null, 2));

console.log('1. Open this URL in a real browser, signed in (or sign in when prompted) as your disposable test account:\n');
console.log(authorizeUrl.toString());
console.log('\n2. Approve the consent screen when it appears.');
console.log('3. The browser will try to navigate to the redirect_uri above and likely show an error page (no real callback route exists at that URL yet) - that is expected. Copy the FULL resulting URL from the address bar.');
console.log('4. Run: node supabase/oauth_test/2_complete_from_redirect.mjs "<the full URL you copied>"');
