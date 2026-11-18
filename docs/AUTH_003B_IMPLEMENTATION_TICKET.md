# AUTH-003B — Traffic Strategy Map: Real SSO Frontend, Callback & Entitlement Integration

**Prepared, not started.** Everything below assumes AUTH-003A's backend hardening (auth/entitlement/quota middleware), RLS migrations, and the OAuth/RLS compatibility test have all landed and been proven — this ticket is specifically the *frontend-facing* half that was deliberately deferred.

## Prerequisites (block starting this ticket)

1. OAuth client registered (`docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`).
2. The OAuth/RLS compatibility test actually run once, for real, against a disposable test account — resolves whether `setSession()` is the right session-handling approach here or whether a Launch-Studio-style first-party session is needed instead (`docs/AUTH_003A_OAUTH_RLS_TEST.md`).
3. AUTH-003A's migrations applied to production, in the coordinated window (see `docs/AUTH_003A_COORDINATED_CUTOVER.md`), alongside this ticket's own frontend — not before, per the ticket restriction against deploying restrictive RLS ahead of a working authenticated frontend.

## Scope

### 1. SSO entry point
A "Sign in with ADVESER Account" affordance in the Traffic Strategy Map frontend, initiating the authorization-code+PKCE flow against the shared Supabase project's OAuth Server, mirroring the already-proven shape (`supabase/oauth_test/1_generate_authorize_url.mjs`'s logic, productionized).

### 2. Callback handling
A real route at the registered `redirect_uri` (currently a placeholder pointing at a page that doesn't exist yet) that completes the token exchange and establishes a session — using whichever approach prerequisite #2 above validates. If `setSession()` checks out: store the Supabase session via the SDK directly, consistent with this app's existing (if currently unauthenticated) use of `@supabase/supabase-js`. If it doesn't: a first-party session, following Launch Studio's precedent.

### 3. Authenticated frontend state
- Distinguish "your private strategies" from "public demo strategies" in the Save/Load UI (`StrategiesModal.jsx`), using the now-present `user_id`/`is_demo` columns.
- Handle the new auth-required states gracefully: signed-out users should still be able to use the canvas (read-only / local-only, matching today's experience) but Save should prompt sign-in rather than silently fail against RLS.
- Error handling for every new failure mode: RLS rejection (shouldn't happen for a legitimate owner, but must not crash if it does), entitlement 403, quota 429, auth 401.

### 4. Central ADVESER entitlement wiring
- Confirm the central gateway's `ssoStartPath` can be set for `traffic-strategy-map` in `adveser-platform`'s `lib/products.ts` once this app's own SSO entry point (item 1) is live — this is a **one-line change in a different repo**, out of scope for this ticket's own implementation but a required follow-up once this ships.
- The backend's existing `requireEntitlement` (AUTH-003A) already checks `adveser_core.user_product_entitlements` for `traffic_strategy_map` — no backend entitlement work needed here, only making sure the frontend sends a real, valid access token so that check has something to verify.

### 5. Protected OpenAI API — frontend side
`src/services/openai.js`'s fetch call needs to attach `Authorization: Bearer <access token>` once a session exists, and handle 401 (re-authenticate)/403 (not entitled)/429 (quota) responses with real UI states — today it has none of this, since the endpoint was previously unauthenticated.

## Explicitly out of scope for this ticket
- Any change to `public.strategies`' RLS policies (AUTH-003A's own scope, already landed).
- Cross-user isolation testing (covered by AUTH-003A's local rehearsal; this ticket just needs to not break it).
- Earn Studio or Launch Studio changes.
- Making `adveser-platform`'s own `ssoStartPath` change (a different repo, a one-line follow-up, not bundled here).

## Acceptance criteria
Matches the ticket's own Task 5 phrasing: an authorized ADVESER user can sign in once, open Traffic Strategy Map without a second login, create/save/reopen/modify/delete their own private strategy, use AI functionality within quota, and is prevented from accessing another user's private strategies — all of which AUTH-003A already proves at the backend/database layer; this ticket is what makes it true end-to-end for a real user.

## Suggested test plan
Reuse the existing local-rehearsal pattern (disposable Supabase stack, real signed-up test users) to drive the new frontend code against a real local backend, before ever touching the real shared project with real frontend code.
