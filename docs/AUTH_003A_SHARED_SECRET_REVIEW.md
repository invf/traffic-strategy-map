# AUTH-003A — Temporary Shared-Secret Review: Rejected

## The question

Could a pre-shared secret safely gate `/api/openai` for the window before the OAuth client exists?

## The answer: no, for this app, as originally designed — and it's been removed

`backend/middleware/requireSharedSecret.js` and its "Mode 2" wiring in `server.js` are **deleted**, not just disabled. Verified directly (not assumed) by reading `src/services/openai.js`:

```js
const API_URL = import.meta.env.VITE_API_URL;
...
const res = await fetch(`${API_URL}/api/openai`, { ... });
```

This is a **static Vite SPA** — the browser itself calls the backend directly. There is no server this frontend controls that could hold a secret safely; any value the frontend needed to attach to that request would have to live in a `VITE_*` env var, which Vite inlines into the **public** JS bundle at build time — the exact same mechanism this engagement has used repeatedly to confirm other apps' own `NEXT_PUBLIC_*`/`VITE_*` config by just reading their deployed bundles. A "shared secret" visible to anyone who opens the bundle is not a restriction; it would have been security theater, worse than no secret at all because it *looks* like protection.

Per the ticket's own instruction — *"If Mode 2 requires exposing the secret in the frontend, do not use it"* — it doesn't survive review. Removed entirely, including its test, so it can't be found later and mistakenly wired back into this public route.

## What replaced it: `requireDisabled`

Until `TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID` is set, `/api/openai` now returns a clean `503` for every request — OpenAI is never called, no secret of any kind is checked. This is the ticket's own explicit alternative ("recommend temporarily disabling paid AI requests until OAuth SSO is operational"), and it's the correct choice here, not a fallback one: it closes the endpoint completely rather than gating it with something that would leak.

## When a real server-to-server shared secret WOULD be legitimate (not applicable today)

For completeness, since the ticket asked to document the alternative: a pre-shared secret is a reasonable pattern **only** when both ends of the call are servers the operator controls directly — e.g., a future backend-to-backend integration where neither side is a browser and the secret never needs to reach any client-shipped code (not `VITE_*`, not `NEXT_PUBLIC_*`, not any bundle). Nothing in this codebase today is such a caller. If one is ever built, it should get its own narrowly-scoped middleware and its own review at that time — not reuse of whatever currently guards the browser-facing route.
