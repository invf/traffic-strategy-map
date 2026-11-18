# AUTH-003B — Same-Origin Proxy Implementation (Option B)

**Architecture decision: APPROVED and implemented in code.** Target public hostname: `traffic-map.adveser.com`. Frontend: Vercel (static SPA). Backend: Render (Express, verified live at `https://traffic-strategy-map.onrender.com` — confirmed via its real `/health` response, not a guessed URL). Authentication: central ADVESER Supabase OAuth Server. Nothing merged, deployed, or changed in production this session; no DNS, Vercel custom domain, Supabase config, secrets, or entitlements were touched. Launch Studio, Earn Studio, and Slovakia Operations were not touched.

## Task 1 — Vercel proxy

`vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://traffic-strategy-map.onrender.com/api/:path*" },
    { "source": "/auth/:path*", "destination": "https://traffic-strategy-map.onrender.com/auth/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    { "source": "/(api|auth)/:path*", "headers": [{ "key": "x-vercel-enable-rewrite-caching", "value": "0" }] }
  ]
}
```
- Destination is the **verified** Render hostname (confirmed live: `/health` returns the exact `{"status":"ok"}` this codebase's `app.js` produces; `/api/strategies` and `/auth/sso/start` both 404, consistent with the currently-deployed instance predating this session's AUTH-003B work, which has never been deployed).
- Proxy rules are listed **before** the SPA-fallback catch-all — Vercel evaluates rewrites top-to-bottom, first match wins, so `/api/*`/`/auth/*` are claimed before `/(.*)` would otherwise swallow them.
- The `headers` block disables Vercel's CDN caching for these paths specifically (see Task 3's Cache-Control finding — this is the second, independent layer of that fix).

## Task 2 — Same-origin frontend

`src/lib/api.js`'s `API_URL` now defaults to `''` (empty) when `VITE_API_URL` is unset, which every caller already builds URLs as `` `${API_URL}${path}` `` — an empty prefix means every request is a bare relative path (`/api/strategies`, `/auth/sso/start`), which `fetch()` resolves against the current page's origin. In production (no `VITE_API_URL` set), that origin is `traffic-map.adveser.com`, and the Vercel rewrite above transparently forwards it to Render — **the browser never contacts a different origin at all.** `VITE_API_URL` remains available as an explicit absolute-URL override for local development only.

- `resolveApiUrl()` (new) handles the one case that isn't itself a `fetch()` — the sign-in link's top-level navigation, where `new URL('/auth/sso/start')` with no base would throw; it resolves against `window.location.origin` when `VITE_API_URL` is unset.
- **Real bug found and fixed**: `src/services/agent.js` (AI node assistant) and `src/services/postStudio.js` (Post Studio) each had their own hand-rolled `fetch('/api/openai', ...)` call **missing `credentials: 'include'` entirely** — these would have 401'd unconditionally the moment `requireSsoAuth` went live in production, with no indication why, since they predate AUTH-003B and were never updated. Consolidated all three callers (`openai.js`, `agent.js`, `postStudio.js`) onto one shared `callOpenAiProxy()` helper in `lib/api.js` (credentials, the 401-retry-via-silent-refresh from the prior audit, one implementation instead of three).
- `isApiConfigured` is retired — relative paths are always structurally valid in production now; the dead "backend not configured" banner and its translation strings were removed along with it.
- Save, Load, Edit, Delete (`src/services/strategies.js`, already proxy-based) and all three OpenAI call sites now uniformly go through the relative-path/`credentials: 'include'` convention.

## Task 3 — Cookies and security

| Requirement | Status |
|---|---|
| HttpOnly | Already true, unchanged |
| Secure | Already true unconditionally, unchanged |
| SameSite=Lax | **Flipped to the default** (`getCookieSameSite()` in `backend/auth/ssoSession.js`) now that frontend and backend are same-site via the proxy — real CSRF protection, not just the minimum needed to survive being cross-origin. `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None` remains available as an explicit, temporary rollback switch (one env var, no code change) |
| Host-only session cookie | Already true — `buildSessionCookieHeader` has never set an explicit `Domain` attribute, so the cookie is host-scoped by default |
| Correct cookie paths | Session cookie `Path=/`; the OAuth login-CSRF cookie `Path=/auth/sso` (unchanged, already correct) |
| OAuth state and CSRF protection | Carried over from the prior audit (the `tsm_oauth_csrf` cookie + the previously-dead `isValidState()` now wired up) — unaffected by the proxy, still correct |

**Audited: cookie behavior through the Vercel proxy, including redirects and Set-Cookie headers.** Vercel's own docs do not explicitly document whether `Set-Cookie`/`Location` headers from an external-rewrite destination are forwarded unmodified — confirmed by reading `vercel.com/docs/routing/rewrites` and `vercel.com/docs/security/reverse-proxy` directly. The only documented behavior is request-side header forwarding (`x-forwarded-for` etc.); response-header pass-through for a reverse proxy is the standard, expected behavior (how the whole "reverse proxy" feature is advertised to work at all) but was not found explicitly stated for this specific header. **This must be confirmed with a live smoke test once the custom domain is assigned** — `curl -i` through `traffic-map.adveser.com/auth/sso/start` and the real callback, checking the `Set-Cookie` and `Location` headers arrive on the browser-facing response exactly as Render sent them (this session's final checklist below includes this as an explicit required step; it cannot be verified without a live deployment).

**Real caching risk found and fixed**: Vercel's docs confirm that, for projects created on or after April 6, 2026, external-rewrite responses are cached according to upstream `Cache-Control` headers. Whether an *absent* `Cache-Control` header is treated as "don't cache" is not explicitly documented either way. Since every `/auth/*` and `/api/*` response here is per-user and several carry a `Set-Cookie`, relying on an undocumented default would risk a single cached `/auth/sso/callback` response handing **every subsequent visitor the first visitor's session cookie** — a session-hijack-shaped bug, not a performance nit. Fixed with two independent layers: (1) `backend/app.js` now sets `Cache-Control: no-store` on every `/auth/*` and `/api/*` response explicitly (2 new tests in `app.test.mjs`); (2) `vercel.json`'s `x-vercel-enable-rewrite-caching: 0` header rule for the same paths, which Vercel's own docs state "restores the previous behavior where upstream caching headers are ignored and responses are never cached."

**Validated request Origin/CSRF handling for state-changing routes, under the new topology**: same-origin requests never trigger a CORS preflight at all (browsers don't apply CORS to same-origin traffic), so the existing strict-origin CORS config becomes defense-in-depth against someone hitting the raw Render URL directly, rather than the primary mechanism — it was left unchanged (still correctly scoped to the exact `FRONTEND_URL`) since it's still correct, just less load-bearing. The two CSRF fixes from the prior audit (the OAuth login-CSRF cookie, the logout `X-Requested-With` header) remain necessary and unchanged, since the raw Render URL is still directly reachable unless Render-level network restrictions are added (not configured, and not required for Option B to be secure — the public entry point is what matters).

## Task 4 — OAuth callback & exact configuration

**Public callback**: `https://traffic-map.adveser.com/auth/sso/callback` — reached by the browser at the public domain, proxied by Vercel to this backend's real route on Render. The OAuth client credentials stay on Render; the browser is never involved in the token exchange regardless of which URL it was redirected through to get there.

**Exact Supabase OAuth client settings** (register manually — not done this session):

| Setting | Value |
|---|---|
| Client type | Authorization Code + PKCE |
| Redirect URI | `https://traffic-map.adveser.com/auth/sso/callback` (**must exactly match** what the backend sends in both the authorize request and the token exchange — a compliant OAuth server rejects a mismatch) |
| Scopes | `openid email` |

**Render environment variable changes** (not applied — documented in `backend/.env.example` and `render.yaml`, both updated this session):

| Variable | New value |
|---|---|
| `FRONTEND_URL` | `https://traffic-map.adveser.com` (was the raw `.vercel.app` URL) |
| `TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI` | `https://traffic-map.adveser.com/auth/sso/callback` (was the raw `.onrender.com` URL — **this is the one value that changes the OAuth client registration above, too**) |
| `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` | From the Supabase registration above |
| `TRAFFIC_STRATEGY_MAP_SESSION_SECRET` | Unchanged (a long random value, generated once) |
| `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE` | Leave unset (new default is `Lax`, correct for this architecture) — only set to `None` for an emergency rollback |
| `SUPABASE_ANON_KEY` | Unchanged |

**Vercel environment variable changes**: `VITE_API_URL` should be **removed/left unset** in the Vercel project (its absence is now what triggers same-origin relative paths — the opposite of before, when it was required).

**Discrepancy found, not fixed**: `render.yaml`'s blueprint `name:` field is `traffic-strategy-backend`, but the verified live service's real hostname is `traffic-strategy-map.onrender.com`. This file was likely never used to actually create the live service (or the service was renamed after the fact without updating this file). Not changed here — altering a Render Blueprint's `name:` risks Render creating a *second* service rather than recognizing the existing one if Blueprint sync is ever active; verify manually in the Render dashboard before touching it.

## Task 5 — Central gateway (`invf/adveser-platform`)

Committed on `feature/auth-003b-traffic-map-sso-prep` (pushed, not merged): `lib/products.ts`'s `ssoStartUrl` field (built in the prior session for exactly this split-origin/reverse-proxy case) now has a pinned, exact comment naming the two values to set together once live:
```
url: "https://traffic-map.adveser.com"
ssoStartUrl: "https://traffic-map.adveser.com/auth/sso/start"
```
**Deliberately not set yet** — `resolveProductGateway.ts` would otherwise route already-entitled users to a domain that isn't deployed and tested. Entitlement verification itself is unaffected: `/account/products` and `/go/[product]` both already check `traffic_strategy_map`'s real entitlement status via the existing generic, `PRODUCTS`-driven logic (confirmed in the prior audit) — this field only changes *where an already-entitled user is sent*, never *whether* they're entitled. 19/19 existing gateway tests still pass (no real product's `ssoStartUrl` is set, so behavior is unchanged).

## Task 6 — Integration tests

| # | Area | Result |
|---|---|---|
| 1 | OAuth state and PKCE | **Proven** — `pkce.test.mjs` (9), plus the prior audit's login-CSRF tests in `ssoRoutes.test.mjs` (6 of the file's 39) |
| 2 | Browser cookie delivery through the proxy | **Cannot be proven without a live deployment** — the route logic that sets/reads cookies is fully tested (below), but whether Vercel's rewrite forwards `Set-Cookie`/`Location` unmodified is a live-infrastructure fact, not something `supertest` can simulate. Flagged as the one required post-deploy smoke test (Task 7's checklist) |
| 3 | Third-party cookies blocked | **Structurally moot under Option B** — there is no third-party cookie anywhere in this design once the proxy is live (same registrable domain throughout); the whole point of this architecture change. The prior audit's cross-engine research (Chrome/Safari/Firefox) is what established this was necessary |
| 4 | Session persistence after refresh | **Proven** — `ssoRoutes.test.mjs`'s `GET /auth/sso/session` silent-refresh tests |
| 5 | Strategies CRUD and RLS isolation | **Proven against a REAL local Supabase/PostgREST stack**, not mocks — `backend/rehearsal_strategies_proxy.mjs` (new, 14/14 passing): two real GoTrue users, real access tokens, the actual `createStrategiesRouter` composed with the real RLS policies. Caught and fixed a real bug in the process (see below) |
| 6 | Protected OpenAI API and quotas | **Proven** — `requireAuth`/`requireEntitlement`/`quota.concurrency.test.mjs` (durable Postgres quota under real concurrency and a simulated restart), all unchanged by this ticket |
| 7 | Logout and session invalidation | **Proven** — `ssoRoutes.test.mjs`'s logout tests, including the prior audit's forced-logout CSRF fix |
| 8 | Render restart/session behavior | **Documented and tested at the mechanism level**: the SSO session store is in-memory (`ssoSession.js`'s own header comment) — a restart drops in-flight sessions, same trade-off as Launch Studio; affected users simply redo the SSO redirect, never crash or get a wrong/stale identity (the exact same invalidation path logout uses, proven in `ssoRoutes.test.mjs`). The durable quota store (Postgres-backed) separately survives a restart, proven in `quota.concurrency.test.mjs` |
| 9 | Unauthorized access to strategies and AI | **Proven** — `strategiesProxy.test.mjs`'s 401/404 tests, `app.test.mjs`'s `rejectAuth` tests, `requireSsoAuth.test.mjs` |

**Real bug found by item 5's real-stack rehearsal, not caught by any mocked test**: `GET /api/strategies/:id` used PostgREST's singular-object `Accept: application/vnd.pgrst.object+json` header on the assumption that zero matching rows would come back as a 200 with a null body. A real PostgREST instead returns a 406 error (`PGRST116`, "0 rows") for that header — which was being thrown and returned as a generic 406, never reaching the intended 404 branch at all. **Fixed**: switched to the same plain-array convention already proven correct for PATCH/DELETE (request an array, check `.length`), removing the special case entirely. This is exactly the class of bug a mocked-`fetchImpl` test suite cannot catch, because the mock encodes the author's own (in this case wrong) assumption about the real system — which is why this rehearsal was run against an actual disposable Supabase stack rather than skipped as "probably fine by composition."

Full regression after all Task 1–6 changes: **159 unconditional backend assertions** (`backend/tests/*.test.mjs`) + **14 real-stack assertions** (`backend/rehearsal_strategies_proxy.mjs`, executed against a disposable local Supabase stack, then torn down) + **19 frontend assertions** (`npm test`), all passing. Production build succeeds.

## Task 7 — Release preparation

### Exact DNS configuration needed
A `CNAME` (or Vercel-managed `A`/`ALIAS`, per Vercel's own custom-domain instructions once added to the project) for `traffic-map.adveser.com` pointed at Vercel. Exact record type and target are generated by Vercel when the domain is added to the project (Task 7's "Vercel custom-domain setup" below) — cannot be stated more precisely without that step having run first.

### Vercel custom-domain setup
1. Vercel dashboard → this project → Settings → Domains → add `traffic-map.adveser.com`.
2. Add the DNS record Vercel provides, at whichever provider hosts the `adveser.com` apex/zone.
3. Wait for Vercel to confirm the domain is verified and SSL-provisioned.
4. Deploy `vercel.json`'s rewrites (already committed, not yet deployed).
5. Remove `VITE_API_URL` from the Vercel project's environment variables (its absence is now correct).

### Render environment variables
Exact table in Task 4 above. Apply together with the Supabase OAuth client registration — the redirect URI must match in both places simultaneously, or the OAuth flow will be rejected.

### Supabase OAuth client configuration
Exact table in Task 4 above. One manual registration; nothing else.

### Safe database migration sequence
Unchanged from `docs/AUTH_003A_COORDINATED_CUTOVER.md` — this ticket did not touch the migration set or its ordering. That document's own sequencing (backup, migrations, role provisioning, durable quota, probe table) still applies as written.

### Coordinated deployment procedure
1. Vercel: add the custom domain, wait for verification (can happen anytime, independent of everything else — the old `.vercel.app` URL keeps working throughout).
2. Render: set the new environment variables (Task 4's table) — safe to do before step 3, since `server.js` only activates `/api/openai`/`/api/strategies` once ALL of them are consistently set, and the OAuth client doesn't exist in Supabase yet, so this alone changes nothing observable.
3. Supabase: register the OAuth client with the exact redirect URI above.
4. Deploy the backend (already-tested code, this and prior sessions) and the frontend (`vercel.json`'s rewrites, the relative-URL changes) **together, in the same window** — per `docs/AUTH_003A_COORDINATED_CUTOVER.md`'s existing instruction, this is also when the ownership/RLS migration (if not already applied) must land, not before.
5. **Required live smoke test** (Task 6, item 2 — the one thing that cannot be verified without a real deployment): complete one real sign-in through `https://traffic-map.adveser.com`, then `curl -i https://traffic-map.adveser.com/auth/sso/session` (or inspect via browser devtools) to confirm the session cookie is present, `HttpOnly`, `SameSite=Lax`, `Secure`, and has no explicit `Domain` attribute (host-only, scoped to `traffic-map.adveser.com` exactly). Confirm a page refresh keeps the user signed in, and that `/api/strategies`/`/api/openai` calls carry the cookie (devtools Network tab, Cookie request header present).
6. Once step 5 passes: activate the central gateway (`adveser-platform`'s `ssoStartUrl`, Task 5) in its own deploy.

### Rollback and smoke-test checklist
- **Cookie regression** (SameSite=Lax causes an unexpected problem): set `TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None` on Render — one env var, no redeploy of code, though this only matters if traffic is still somehow cross-origin, which it shouldn't be once the proxy is live.
- **Proxy/domain regression** (Vercel rewrite misbehaves, Set-Cookie/Location not forwarded correctly): revert `vercel.json` to its pre-proxy SPA-only state (`git revert`), which restores the old direct-to-Render-URL frontend behavior immediately; the backend's own `FRONTEND_URL`/redirect URI would need to revert to the old `.vercel.app`/`.onrender.com` values too, and `SameSite` back to `None` — these three must move together, same as the forward cutover.
- **Database rollback**: unchanged, see `docs/AUTH_003A_ROLLBACK_PROCEDURES.md` — never disable RLS; the write-suspension and single-policy-fix procedures remain the only sanctioned options, unaffected by anything in this ticket.
- **Backend rollback (any step)**: redeploy the prior Render commit — no database state depends on the backend's own code being live, same as every prior checklist in this engagement.
- Smoke test after any rollback: repeat step 5 above against whichever URL is now live, to confirm the session actually works end-to-end, not just that the server starts.
