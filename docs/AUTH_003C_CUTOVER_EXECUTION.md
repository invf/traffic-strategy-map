# AUTH-003C — Final Cutover Preparation

Both production branches merged and independently verified (`traffic-strategy-map` `master` = `b0ebf90a84f5f51ad147665a20acf829ac75eec5`; `adveser-platform` `main` = `f8fbf06230f528ceccff26ed6957a1163a7b8a95`). Auto-Deploy off on both platforms; `VITE_API_URL` removed from Vercel Production. **Nothing in this document has been executed** — no SQL run, no deploy triggered, no gateway activated.

## 1. Administrator entitlement grant — preparation only

### Step 1a — identify the administrator (read-only; no ID assumed)
```sql
SELECT id, email, created_at FROM auth.users WHERE email = '<the administrator''s real email address>';
```
Run this first and use the real `id` it returns for every step below — nothing here guesses or hardcodes a UUID.

### Step 1b — confirm the exact schema before writing to it (read-only)
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'adveser_core' AND table_name = 'user_product_entitlements'
ORDER BY ordinal_position;
```
The only columns this engagement's own code has ever queried or required are `user_id`, `product`, `status` (confirmed directly from `invf/adveser-platform`'s `lib/entitlements/checkEntitlement.ts`: `select 1 from adveser_core.user_product_entitlements where user_id = $1 and product = $2 and status = 'active'`, and `backend/lib/entitlements.js`'s identical pattern). If this query shows additional `NOT NULL` columns with no default, the INSERT below needs them added before running — check this first rather than assuming the three-column shape is the whole table.

### Step 1c — check whether an active entitlement already exists (read-only)
```sql
SELECT user_id, product, status FROM adveser_core.user_product_entitlements
WHERE user_id = '<the id from step 1a>' AND product = 'traffic_strategy_map';
```

### Step 1d — the grant itself (prepared, not executed; run exactly one of these two, based on what 1c returned)
```sql
-- If 1c returned NO row:
INSERT INTO adveser_core.user_product_entitlements (user_id, product, status)
VALUES ('<the id from step 1a>', 'traffic_strategy_map', 'active');

-- If 1c returned a row with status <> 'active' (never if it already shows 'active' - nothing to do):
UPDATE adveser_core.user_product_entitlements
SET status = 'active'
WHERE user_id = '<the id from step 1a>' AND product = 'traffic_strategy_map';
```
Scoped to exactly one `user_id` + `product` pair, by their real values from 1a/1c — never a bulk statement, never driven by email matching inside this table itself (email only resolves the `id` in step 1a, once, outside this table). No other row, account, or product's entitlement is touched. This can be run independently of the cutover below — granting it doesn't depend on any not-yet-deployed code, and the smoke tests after cutover will need an entitled account to test against regardless.

## 2. Final RLS migration SQL (ready to paste, unchanged from the file)

`supabase/migrations/20261118120000_add_strategy_ownership.sql`:
```sql
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Allow all" ON public.strategies;

ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or approved demo" ON public.strategies
  FOR SELECT
  USING (is_demo = true OR (user_id IS NOT NULL AND user_id = auth.uid()));

CREATE POLICY "insert own" ON public.strategies
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_demo = false);

CREATE POLICY "update own" ON public.strategies
  FOR UPDATE
  USING (user_id = auth.uid() AND is_demo = false)
  WITH CHECK (user_id = auth.uid() AND is_demo = false);

CREATE POLICY "delete own" ON public.strategies
  FOR DELETE
  USING (user_id = auth.uid() AND is_demo = false);
```
Post-run verification (same as every prior rehearsal/preflight in this engagement):
```sql
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'strategies' ORDER BY policyname;
-- Expect exactly: delete own, insert own, read own or approved demo, update own. Zero rows named "Allow all".
```

## 3. Exact manual Render/Vercel deployment actions, in cutover order

With Auto-Deploy off on both platforms, nothing deploys until these specific manual actions are taken.

1. **Run Section 2's migration SQL first** (or immediately before step 2 below — not independently far ahead of it, per the standing reasoning: it's the one step with immediate effect on the still-live old frontend).
2. **Render**: Dashboard → the `traffic-strategy-map` service → **Manual Deploy** → **Deploy latest commit** (this deploys `master`'s current tip, `b0ebf90a84f5f51ad147665a20acf829ac75eec5`, confirmed above). Wait for the deploy to report live/healthy before step 3 — `/health` returning `{"status":"ok"}` is the quick confirmation.
3. **Vercel**: Dashboard → the project → **Deployments** tab → find (or create, if none exists yet for this commit) the deployment built from `main`'s current tip and use **Promote to Production** (or **Redeploy** targeting Production, depending on which the UI offers for this project) — the exact control Vercel shows depends on whether a Preview deployment for this commit already exists; either path ends with this commit live on the Production alias (`traffic-map.adveser.com`).
4. **Smoke test** (`docs/AUTH_003C_FINAL_RELEASE_PREPARATION.md`'s Task 6: OAuth, entitlement, session cookies, strategies, quota) before telling anyone it's live.
5. Only after step 4 passes: activate `adveser-platform`'s `ssoStartUrl` (its own separate, later deploy — not part of this sequence).

Nothing above has been run. Say the word for Section 1's grant (independent, can go first or anytime), then separately for Section 2+3's cutover itself.
