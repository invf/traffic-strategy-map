# AUTH-003B — Pre-Production SSO Architecture Verification

Continuation of AUTH-003B on `invf/traffic-strategy-map` (`feature/auth-003a-security-and-sso-prep`) and `invf/adveser-platform` (`feature/auth-003b-traffic-map-sso-prep`). No production data, Supabase configuration, or entitlements were touched. Launch Studio, Earn Studio, and Slovakia Operations were not touched.

## Task 1 — Verified committed state

Both branches exist on their remotes (pushed this session; they previously existed only locally) and were independently re-confirmed via `git ls-remote`, not just trusted from push output.

**`invf/traffic-strategy-map` — `feature/auth-003a-security-and-sso-prep`** (remote tip confirmed = local HEAD):
```
9d9fe66f35819fa1ae3e8397650a4eacc0701926  AUTH-003B: add frontend auth tests (Vitest), drop unused Supabase client dep
bade0e9d536245f6d7cc5b6868c1791a6ecadbff  AUTH-003B: update release docs for the real shared-secret-free design
a6bc45f6df7bc63069da010459457306f73820b0  AUTH-003B: wire frontend to the SSO backend and strategies proxy
0e1ea766af52499bf5d40e527b08405f167d9521  AUTH-003B: implement SSO backend (OAuth/PKCE, session, strategies proxy)
b823850                                    AUTH-003A: safe post-cutover rollback, quota validation, restart proof   (base, previously pushed)
```
Plus this audit's own corrections, committed after the above (see "Commits from this audit" below).

**`invf/adveser-platform` — `feature/auth-003b-traffic-map-sso-prep`** (remote tip confirmed = local HEAD):
```
d5543b6aacc4c7471bf2cb3d03ae64d9cff70b57  AUTH-003B: prepare /go/traffic-strategy-map for a split-origin SSO backend
```

## Task 2 — Cross-origin session reliability

**Finding: `SameSite=None; Secure` does not make the current split-origin design (Vercel frontend + Render backend) reliable across real browsers.** This was verified against current (2026) browser behavior, not assumed:

- **Chrome**: third-party cookies remain enabled by default — Google abandoned the Privacy Sandbox cookie-deprecation plan in 2025 and is retiring the Sandbox APIs rather than blocking cookies ([SecurityWeek](https://www.securityweek.com/google-will-keep-third-party-cookies-in-chrome/amp/), [Digiday](https://digiday.com/marketing/after-years-of-uncertainty-google-says-it-wont-be-deprecating-third-party-cookies-in-chrome)). **Works today in default Chrome.** Does **not** work in Chrome Incognito (blocks third-party cookies by default) or for any user who has toggled "Block third-party cookies" themselves.
- **Safari/WebKit** (this means every iOS browser, Chrome-on-iOS included, since Apple mandates WebKit): Intelligent Tracking Prevention blocks **all** third-party cookies unconditionally. A WebKit engineer confirmed directly that `SameSite=None` has never created an exception to this blocking ([WebKit tracking-prevention page](https://webkit.org/?p=10865), [WebKit mailing list](https://lists.webkit.org/pipermail/webkit-unassigned/2022-February/1019883.html)). **This fails completely, for 100% of Safari/iOS users**, regardless of any cookie attribute.
- **Firefox**: Total Cookie Protection, the default since Firefox 103 (2022), partitions cookie storage per top-level site ([Mozilla](https://www.firefox.com/features/total-cookie-protection/)). A cookie set while `backend.onrender.com` is briefly the top-level site (during the OAuth redirect) lands in a partition keyed to that top-level site; a later cross-site `fetch()` from `frontend.vercel.app` looks in a *different* partition and finds nothing. **This fails by default for Firefox users**, not just a hardened-privacy subset.

**Concretely**: the OAuth callback *does* complete and *does* set the cookie (confirmed working in this session's local verification), but on Safari and default Firefox, the very next cross-origin `fetch()` from the frontend — loading the session on page refresh, saving a strategy, calling `/api/openai` — will silently not carry the cookie. The user appears signed in for an instant, then immediately appears signed out again. **Acceptance criteria 3, 4, and 5 (remain signed in after refresh; save/reopen a private strategy; access protected AI functionality) will fail on Safari and default Firefox under the current architecture**, which the ticket's own instruction to "test with third-party cookies blocked" was clearly anticipating.

### Option A vs. Option B

**A. Current: Vercel frontend + Render backend, separate domains.** Already built, already tested, works in default Chrome only. Not reliable for a real user base that includes Safari/iOS (commonly 15–30%+ of consumer traffic) or Firefox.

**B. Same-origin: frontend and backend under one ADVESER-controlled domain, with `/api/*` and `/auth/*` reverse-proxied to Render.** When a Vercel rewrite proxies these paths to the Render backend server-side, the browser never contacts the Render origin directly — it only ever talks to the one ADVESER domain. A `Set-Cookie` response with no explicit `Domain` attribute is host-scoped to whatever origin the browser's request actually went to, which after the proxy is the ADVESER domain, not Render. There is no third party left for any browser's blocking/partitioning policy to apply to. The browser-engine behavior above (not a workaround for it) is the standard, documented fix — MDN's own guidance for this exact situation is "serve the API from the same site" ([MDN: Third-party cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/third-party_cookies)).

**Recommendation: Option B.** It is strictly more reliable (works identically in every browser, not contingent on Chrome's current, historically-reversed policy choices) and strictly more secure (the cookie can use `SameSite=Lax` instead of `None`, which is real CSRF protection by itself, not just "the minimum needed to survive being cross-origin").

### What Option B requires (not yet done — infrastructure/DNS decisions, correctly out of this session's scope)

1. An ADVESER-controlled domain or subdomain assigned to this product in Vercel (e.g. `traffic-map.adveser.com`), with DNS pointed at Vercel.
2. `vercel.json` rewrites added, evaluated **before** the existing SPA-fallback rule:
   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://traffic-strategy-backend.onrender.com/api/:path*" },
       { "source": "/auth/:path*", "destination": "https://traffic-strategy-backend.onrender.com/auth/:path*" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```
3. Once live: `VITE_API_URL` becomes the frontend's own domain (empty path prefix, since `/api`/`/auth` are now same-origin); `FRONTEND_URL`/`TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI` on the backend become that same domain's `/auth/sso/callback`; and `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=Lax` is set (see Task 3's fix below — this is now a one-env-var flip, not a code change).

This is a deployment/DNS decision, not a code change this session can safely make — not implemented, per "no production configuration changes yet."

## Task 3 — Backend security review

| Item | Status |
|---|---|
| Every protected API independently enforces identity + entitlement | **Confirmed** — `requireSsoAuth`/`requireAuth` + `requireEntitlement` on every protected route; `strategiesProxy.js` ignores any client-supplied `user_id`, using only the verified session's own id |
| Strategies proxy uses the correct user-scoped token | **Confirmed** — `ensureValidAccessToken()` returns the signed-in user's own real, cached/refreshed Supabase access token; never a shared/app token |
| No service-role bypass of RLS | **Confirmed** — grepped the full backend; the only direct-Postgres role (`traffic_strategy_map_app`, in `lib/entitlements.js`) is narrowly scoped to `adveser_core.user_product_entitlements` (SELECT) and this app's own `openai_usage`/`openai_quota` tables; it never touches `public.strategies`, which is reached only via the user's own real token through PostgREST/RLS |
| Token refresh safe under concurrent requests | **Confirmed, newly proven under genuine concurrency** — `backend/tests/ssoSession.concurrency.test.mjs` (new, 10/10 passing) uses real `Promise.all` with a deliberately slow operation to prove 5 simultaneous callers for the same session coalesce into exactly one real refresh, different sessions never cross-contaminate, and a failed refresh doesn't poison later calls |
| Session cookies cannot be forged | **Confirmed** — HMAC-SHA256 signed, timing-safe comparison |
| Sessions expire and can be invalidated | **Confirmed** — 15-minute token lifetime + `isSessionActive()` checked on every authenticated request (AUTH-001 Phase 4B pattern); logout deletes the server-side record immediately |
| CSRF protection on state-changing cookie-authenticated requests | **Two real gaps found and fixed** — see below |
| OAuth tokens/secrets never reach browser JS or logs | **Confirmed** — every `console.error` in the backend logs only `err.message`/`err.code`/`err.name`, never raw tokens, headers, or bodies; grepped the full backend for this |

### Security fixes applied this audit

1. **OAuth login-CSRF (the real finding, previously unprotected)**: `pkce.js`'s `isValidState()` was imported into `ssoRoutes.js` but **never actually called anywhere** — the OAuth `state` parameter was checked only for existence/single-use/TTL, never bound to the browser that initiated the flow. This allows a textbook login-CSRF: an attacker completes their own real consent, captures their own valid `code`+`state` from their own browser's address bar, and sends that exact callback URL to a victim — the victim's browser would complete the callback and be signed into the *attacker's* account, with no indication anything was wrong. **Fixed**: a new short-lived `tsm_oauth_csrf` cookie (`SameSite=Lax`, `HttpOnly`, `Path=/auth/sso`) is set at `/auth/sso/start` and bound to that flow's `state` server-side; `/auth/sso/callback` now verifies it via the previously-dead `isValidState()` before proceeding, and clears it on every exit path. 6 new assertions in `ssoRoutes.test.mjs` cover missing and mismatched cookies.
2. **Forced-logout CSRF**: `POST /auth/sso/logout` has no JSON body and no non-simple method, so — unlike the strategies proxy's POST/PATCH/DELETE, which already force a CORS preflight via their JSON `Content-Type` or method — a plain cross-site `<form method="POST">` or bodyless `fetch()` from an attacker's page could reach it with the `SameSite=None` cookie attached, logging the victim out. **Fixed**: logout now requires an `X-Requested-With: XMLHttpRequest` header, which forces a CORS preflight (blocked for any non-frontend origin by the existing strict-origin CORS config) and which a plain HTML form cannot set at all. The frontend's `signOut()` was updated to send it. 2 new assertions cover the missing-header rejection and confirm the real session survives a forgery attempt.
3. **Real functional CORS bug, caught by this audit, not a security issue by itself but directly relevant to "CORS configuration" review**: `app.js`'s CORS config listed `methods: ['GET', 'POST', 'OPTIONS']` — missing `PATCH` and `DELETE`, which the strategies proxy's own edit/delete routes use. A real browser's preflight would have rejected those requests outright before they ever reached the server, breaking edit/delete in production despite passing every existing test (supertest calls routes directly, bypassing real preflight enforcement entirely). **Fixed**: both methods added, plus an explicit `allowedHeaders` list (`Content-Type`, `X-Requested-With`) so the new CSRF header doesn't itself fail preflight.
4. **Session reliability (not a security issue, a correctness gap relevant to acceptance criterion 3/5)**: the session cookie's 15-minute lifetime was never refreshed in the background; a tab left open longer than that would 401 on its next save/load/AI request even though the underlying OAuth refresh token was still valid, forcing an unnecessary full re-login. **Fixed**: `src/lib/api.js`'s `apiFetch` (used by the strategies proxy) and `src/services/openai.js`'s `/api/openai` call now retry exactly once on a 401, via a silent `GET /auth/sso/session` refresh attempt first — never looping, never retrying a 403/429/503 (those are final answers from an otherwise-valid session), never recursing into the session-check call itself. 4 new frontend tests cover this.
5. **Cookie `SameSite` is now configurable** (`TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE`, defaults to `None`) rather than hardcoded, so adopting Option B's same-origin proxy (Task 2) becomes a one-env-var flip to `Lax`, not a code change. 7 new tests cover the default, both valid overrides, and fail-closed-to-`None` on an invalid value.

All fixes are on `feature/auth-003a-security-and-sso-prep`; nothing was merged or deployed. Full regression after all fixes: **156 unconditional backend assertions, 16 frontend assertions, all passing**; production build still succeeds.

## Task 4 — Configuration preparation

No production configuration was changed. Exact settings needed, consolidated (supersedes the redirect-URI/env-var portion of `docs/AUTH_003A_OAUTH_CLIENT_SETUP.md`, which remains correct for everything else):

| Setting | Value |
|---|---|
| OAuth client type | Authorization Code + PKCE (not implicit, not client-credentials) |
| Redirect URI | `https://traffic-strategy-backend.onrender.com/auth/sso/callback` — **the backend's own route, not the frontend** (keeps the client secret server-side only) |
| Scopes | `openid email` |
| Public frontend URL (`FRONTEND_URL` on the backend) | The real Vercel URL today (`https://traffic-strategy-map-drab.vercel.app`); becomes the ADVESER-controlled domain if/when Option B ships |
| Backend base URL | `https://traffic-strategy-backend.onrender.com` (or whatever this app's real Render URL is) |
| Central gateway (`invf/adveser-platform`) | Already prepared this session (`ssoStartUrl` field, not yet activated — see that repo's own commit) — activating it is a one-line `lib/products.ts` edit, done in the *same* coordinated window as the backend/frontend cutover, never before |
| Backend env vars (new since AUTH-003A) | `SUPABASE_ANON_KEY`, `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID`, `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_SECRET`, `TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI`, `TRAFFIC_STRATEGY_MAP_SESSION_SECRET`, and now optionally `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE` (leave unset until Option B is live) |
| Frontend env vars | `VITE_API_URL` only (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are no longer used at all — the direct Supabase client was removed) |

## Task 5 — Acceptance criteria

| # | Criterion | Current status (Option A, as shipped) |
|---|---|---|
| 1 | Sign in once to ADVESER Account | **Met** — `/auth/sso/start` → consent → `/auth/sso/callback` → session cookie, verified end-to-end against a local backend this session (minus the real Supabase project, which needs the still-pending OAuth client registration) |
| 2 | Open Traffic Strategy Map from `/account/products` | **Prepared, not activated** — the gateway change exists (`ssoStartUrl`) but is deliberately not turned on yet (Task 2/4) |
| 3 | Remain signed in after refreshing the page | **Met in default Chrome. Fails in Safari and default Firefox** — this is Task 2's core finding; Option B is the fix |
| 4 | Save and reopen a private strategy | Same as #3 — the proxy and RLS logic are correct, but the session cookie carrying the request is what fails cross-browser |
| 5 | Access protected AI functionality within quota | Same as #3, plus: now degrades gracefully with one retry (Task 3 fix #4) instead of forcing re-login on an ordinary 15-minute idle gap |
| 6 | Sign out and lose access to protected operations | **Met** — logout deletes the server-side record immediately; `isSessionActive()` is checked on every authenticated request, so a still-valid-looking cookie from before logout is rejected (AUTH-001 Phase 4B pattern, confirmed by test) |

**Test with third-party cookies blocked, as instructed: criteria 3–5 do not currently pass** under Option A in Safari or default Firefox. They are expected to pass under Option B once it ships, since there is no third-party cookie involved at all at that point. This was not something the existing test suite could catch (supertest never exercises real browser cookie policy) — it required this specific cross-engine research.

## Final manual setup checklist

**GO now** (safe, already done): all six fixes in Task 3, pushed to `feature/auth-003a-security-and-sso-prep`; `adveser-platform`'s gateway prep, pushed to its own branch, not activated.

**NO-GO, your decision needed**:
1. **Architecture**: approve Option B (same-origin reverse proxy) or explicitly accept Option A's Safari/Firefox gap for launch. This session recommends Option B.
2. If Option B: assign an ADVESER-controlled (sub)domain to this product in Vercel + DNS, then the `vercel.json` rewrite above, then flip `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=Lax` and the four URL-shaped env vars to match.
3. Either way: the OAuth client registration in Supabase (Task 4's table) remains the standing blocker — nothing above can be smoke-tested against the real provider without it.
4. Once both are done: the coordinated migration + frontend + gateway-activation cutover already documented in `docs/AUTH_003A_COORDINATED_CUTOVER.md`.
