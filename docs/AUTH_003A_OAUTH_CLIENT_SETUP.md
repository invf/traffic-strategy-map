# AUTH-003A-3 — OAuth Client Registration & Test Account Setup

Two things block running `supabase/oauth_rls_test.mjs` for real. Neither can be done by Claude — both require direct Supabase dashboard access and a decision only you can make (which real or disposable account to authorize for testing).

## 1. Register Traffic Strategy Map as an OAuth client

Supabase Dashboard → the shared project (`eukogyljakqafnuvrfiv`) → **Authentication → OAuth Apps** (or **OAuth Server**, naming varies by dashboard version) → **Create OAuth Client** (or equivalent "Add application"):

1. **Name**: `Traffic Strategy Map` (or similar, clearly distinguishing it from Launch Studio's own existing client).
2. **Redirect URI**: `https://traffic-strategy-map-drab.vercel.app/auth/callback` — or whatever this app's real callback route ends up being once AUTH-003A-4 builds it (not yet built — if it doesn't exist yet, this step can still be done with the planned URL; it just won't be reachable until that route exists).
3. **Grant types**: Authorization Code with PKCE (same as Launch Studio's client).
4. **Scopes**: `openid email` is sufficient — this app only needs identity, not broader profile data.
5. Save, then copy the generated **Client ID** and **Client Secret**. The secret is shown once — store it the same way Launch Studio's own client secret is stored (an env var on the hosting platform, never committed, never pasted into chat).

Once done, set in Render (`traffic-strategy-backend`'s environment, and/or wherever the frontend's OAuth start flow will read it from):
```
TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID=<the client id>
```
The client secret is needed only by `supabase/oauth_rls_test.mjs` itself (as `TSM_OAUTH_CLIENT_SECRET`, set locally in your own shell when you run it — never committed) and by whichever server-side code eventually performs the token exchange in AUTH-003A-4.

## 2. A disposable test account

The test script signs in with a real email+password (AUTH-002A's password login) to get a real, canonical ADVESER user id to check everything against. This has been the standing blocker across this entire engagement — no target email has ever been authorized for testing.

**Recommend**: create one throwaway account specifically for this (e.g. `auth003a-test@<your domain>`), with:
- A password set (via AUTH-002A's "set a password" flow, or directly if you have admin access to set one).
- A `traffic_strategy_map` entitlement granted (so later steps of the coordinated release can also be checked with the same account) — **not required for this specific test**, which only checks OAuth/RLS plumbing, not entitlement.

Once you have it, run:
```bash
SUPABASE_ANON_KEY=<the project's public anon key> \
TSM_OAUTH_CLIENT_ID=<from step 1> \
TSM_OAUTH_CLIENT_SECRET=<from step 1> \
TSM_TEST_EMAIL=<the throwaway account's email> \
TSM_TEST_PASSWORD=<its password> \
node supabase/oauth_rls_test.mjs
```

## 3. Apply the isolated probe table first

```sql
-- supabase/migrations/20261118130000_add_oauth_rls_probe_table.sql
```
This is a tiny, disposable table (`public.oauth_rls_probe`) — not `public.strategies` — so the proof touches no real data. Drop it afterward with `DROP TABLE public.oauth_rls_probe;` once the question is answered either way.

## What this unblocks

Once run, `oauth_rls_test.mjs` answers every item in Task 2 empirically: issuer/audience/subject/client_id claims, whether `setSession()`-equivalent bearer-token use is accepted by PostgREST, whether `auth.uid()` resolves to the canonical user id, and whether RLS's own-row logic holds for an OAuth-issued token specifically (not just a regular session token, already proven separately in the local rehearsal). Steps 8 (cross-user rejection) and the refresh/revocation checks (items 7–8 of Task 2) need a **second** disposable account and a short wait for a token to approach expiry respectively — noted in the script, not yet built out, since the first account alone already answers the single highest-uncertainty question (RLS compatibility) before it's worth investing in the rest.

**Stopping here, at this configuration checkpoint** — nothing above has been done by this session; these are exact instructions for you to execute.
