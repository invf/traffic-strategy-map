# AUTH-003A — Verified Security Findings

All verified empirically (read-only PostgREST calls using the project's own public anon key — the same one already in the deployed frontend bundle; no mutation, no production change) rather than inferred from frontend code alone.

## `public.strategies`

- **Anonymous SELECT succeeds** — `GET .../rest/v1/strategies?select=id&limit=1` returns `206 Partial Content`, `Content-Range: 0-0/3`. Confirms RLS is either disabled or fully permissive for `anon` today.
- **Exactly 3 rows exist.** Confirmed by count, not estimated.
- **No ownership column exists.** Full column list: `id, name, nodes, edges, product_info, ai_suggestions, created_at, updated_at`.
- **No browser-local identifier exists either** — grepped the entire frontend store (`src/store/useStore.js`) for `localStorage`/`sessionStorage`/any device-id pattern: zero matches. There is no way to retroactively attribute the 3 existing rows to any future user.
- Anonymous INSERT/UPDATE/DELETE were **not** tested directly (would mutate production, against restriction), but the live app's own advertised Save/Load/Delete UI working today for anonymous visitors (confirmed from `StrategiesModal.jsx`'s source) is strong indirect evidence they're equally open.

## `backend/server.js` (`/api/openai`)

Before this branch: **zero authentication, zero authorization, zero rate limiting.** `express.json({ limit: '2mb' })` was the only size guard. CORS (`FRONTEND_URL`) was the only restriction — a browser convention, not a server-side control, trivially bypassed by a direct request.

## Deployment

Frontend: Vercel, static SPA (`vercel.json`'s `/(.*) → /index.html` rewrite). Backend: Render, `traffic-strategy-backend`, plain Node/Express, `OPENAI_API_KEY`/`FRONTEND_URL` correctly marked `sync: false` (not committed) in `render.yaml`.

## What this branch changes (see `docs/AUTH_003A_SETUP_CHECKLIST.md` for what must still be configured before these take effect)

- `backend/middleware/requireAuth.js` + `requireEntitlement.js` gate `/api/openai`, verified by 41 unit/integration tests (`backend/tests/`).
- `supabase/migrations/20261118120000_add_strategy_ownership.sql` adds real RLS to `public.strategies`, rehearsed end-to-end against a disposable local Supabase stack — see `docs/AUTH_003A_RLS_REHEARSAL.md`.
