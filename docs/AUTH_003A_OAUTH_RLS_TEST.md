# AUTH-003A-3 — OAuth/RLS Compatibility: Evidence Gathered, Empirical Proof Still Blocked

## The question

Does `auth.uid()`/RLS treat a token issued by Supabase's OAuth 2.1 Server identically to a normal (password/magic-link) session token? This matters because Traffic Strategy Map's planned SSO integration (unlike Launch Studio's, which deliberately avoids `supabase-js`'s own session/RLS path entirely) would rely on exactly this working.

## Documented evidence (read directly from Supabase's own docs, not memory)

From `https://supabase.com/docs/guides/auth/oauth-server/token-security`:
- An OAuth access token's claims: `sub`, `role: "authenticated"`, `aud: "authenticated"`, `user_id`, `email`, `client_id`, `aal`, `amr`, `session_id`, `iss` (`https://<project-ref>.supabase.co/auth/v1`), `iat`, `exp` — the same standard claim set as a regular session token, plus `client_id`.
- The docs state plainly: *"This means your existing RLS policies continue to work."*
- **But**: real, open GitHub issues report `auth.uid()` returning `NULL` for OAuth-issued bearer tokens under specific conditions (a custom access-token hook interfering; an ES256 signing-algorithm mismatch causing PostgREST to silently fall back to the `anon` role). Neither is proven to still reproduce, but neither is proven fixed either.
- `setSession()` specifically: **not mentioned in either official OAuth Server doc page at all** — a genuine documentation gap.

## What was verified empirically this session

`backend/tests/requireAuth.test.mjs` proves this app's *own* JWT-verification middleware correctly accepts a token carrying the exact documented OAuth claim shape (signed with a real key pair, verified against a real local JWKS server) and correctly extracts `sub` as the canonical user id. **This tests this app's own code, not Supabase's real PostgREST/GoTrue stack** — it cannot, by itself, prove the open question above.

## What still requires a real test (not yet run)

`supabase/oauth_rls_test.mjs` is written and ready: it performs the real authorization-code + PKCE flow against the real shared project, decodes the real issued token's claims, and attempts a real RLS-gated INSERT with it against an isolated probe table (`public.oauth_rls_probe`, never `public.strategies`). **Blocked on two things neither Claude can provide**: an OAuth client registered for Traffic Strategy Map (doesn't exist yet) and a disposable test account (the standing blocker across this entire engagement). Exact setup steps: `docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`.

## Recommendation

Treat this as **GO, with the empirical test as an explicit prerequisite** for the SSO integration specifically (not for the already-rehearsed-and-proven ownership RLS, which only needs a regular session token and has nothing to do with this question). Don't assume either way until `oauth_rls_test.mjs` actually runs.
