# AUTH-003A — OAuth Client Registration & Test Account Setup

**Reconfirmed this session** (re-read the test scripts directly — both still exist, unchanged, and still require exactly these inputs): two things block running the OAuth/RLS compatibility test for real. Neither can be done by Claude — both require direct Supabase dashboard access and a decision only you can make (which real or disposable account to authorize for testing).

## Minimum manual Supabase configuration required

Just these three dashboard/account actions — nothing else:

1. **One OAuth client registration** (Authentication → OAuth Apps → Create OAuth Client) — name, redirect URI, Authorization Code + PKCE grant type, `openid email` scope. Yields a client ID and secret.
2. **One SQL statement** applied via the SQL Editor: `supabase/migrations/20261118130000_add_oauth_rls_probe_table.sql` (creates one small, disposable, RLS-protected table — never touches `public.strategies`).
3. **One disposable test account** with a password set (via AUTH-002A's existing password flow — no new mechanism needed).

Everything else — PKCE generation, the authorize URL, the token exchange, `setSession()`, the RLS probe, refresh rotation, sign-out — is already-written, already-reviewed code (`supabase/oauth_test/`), not something that needs further Supabase configuration.

## Why the test is now two steps, not one

The first version of this test tried to fake an ADVESER Platform session by passing a raw Supabase access token as a Bearer header to the `/authorize` endpoint. That doesn't work: `/authorize` doesn't inspect Authorization headers to decide whether the browser is logged in — it unconditionally redirects to `<Site URL><Authorization Path>`, and it's that *destination* page (ADVESER Platform's own `/oauth/consent`, a Next.js Server Component) that checks the browser's real session **cookie** — set by `@supabase/ssr`'s own specific multi-chunk format when a real sign-in happens through the real UI. A script can't fake that cookie without reimplementing `@supabase/ssr` internals. So: the interactive, browser-dependent part (sign in, approve consent) is now genuinely done in a real browser; everything after that (the authorization code is a one-time value already bound to the completed consent) is plain scriptable HTTP/SDK calls.

## 1. Register Traffic Strategy Map as an OAuth client

Supabase Dashboard → the shared project (`eukogyljakqafnuvrfiv`) → **Authentication → OAuth Apps** (or **OAuth Server**, naming varies by dashboard version) → **Create OAuth Client**:

1. **Name**: `Traffic Strategy Map`.
2. **Redirect URI**: `https://traffic-strategy-map-drab.vercel.app/auth/callback` — or whatever this app's real callback route ends up being once AUTH-003A-4 builds it (fine to register now even if unreachable yet).
3. **Grant types**: Authorization Code with PKCE.
4. **Scopes**: `openid email`.
5. Save, copy the **Client ID** and **Client Secret** (shown once) — store the secret as an env var, never committed, never pasted into chat.

```
TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID=<the client id>
```

## 2. Apply the isolated probe table

```sql
-- supabase/migrations/20261118130000_add_oauth_rls_probe_table.sql
```
A tiny, disposable table (`public.oauth_rls_probe`) — never `public.strategies` — so the proof touches no real data.

## 3. A disposable test account

The standing blocker across this entire engagement — no target email has ever been authorized for testing. Create one throwaway account with a password set (AUTH-002A's flow).

## 4. Run the test — two steps

**Step 1** (no browser needed yet):
```bash
SUPABASE_URL=https://eukogyljakqafnuvrfiv.supabase.co \
TSM_OAUTH_CLIENT_ID=<from step 1 above> \
node supabase/oauth_test/1_generate_authorize_url.mjs
```
This prints a URL and saves the PKCE verifier/state locally (gitignored).

**Step 2** (the browser-assisted part — do this yourself, or hand it to me in a later turn if you want me to drive it via the built-in browser pane):
1. Open the printed URL in a real browser.
2. Sign in as the disposable test account if not already.
3. Approve the consent screen.
4. The browser will try to navigate to the redirect URI and likely show an error page — expected, since no real callback route exists yet. Copy the **full** resulting URL from the address bar.

**Step 3** (back to the terminal):
```bash
SUPABASE_URL=https://eukogyljakqafnuvrfiv.supabase.co \
SUPABASE_ANON_KEY=<the project's public anon key> \
TSM_OAUTH_CLIENT_ID=<from step 1> \
TSM_OAUTH_CLIENT_SECRET=<from step 1> \
node supabase/oauth_test/2_complete_from_redirect.mjs "<the full URL you copied>"
```

## What this answers

Token exchange with PKCE, issuer/audience/subject/client_id claims, **`setSession()` compatibility (the real SDK, not a raw-fetch proxy for it)**, whether `auth.uid()`/RLS resolves to the canonical user id for an OAuth-issued token, refresh-token rotation (confirms the *refreshed* token still works with `setSession()` + RLS), and `signOut()`/revocation (confirms the session is genuinely gone server-side, not just forgotten locally). Cleanup of the probe row runs in a `finally` block — executes even if an assertion above it failed.

**Cross-user RLS isolation** is not automated in this run — it needs a **second** disposable account repeating steps 1–4, then confirming that account's own client cannot read the first account's probe row. The script prints this as an explicit manual follow-up rather than skipping it silently.

**Stopping here, at this configuration checkpoint** — nothing above has been done by this session; these are exact instructions for you to execute, or for me to help drive interactively in the browser pane in a future turn once you've done steps 1–3.
