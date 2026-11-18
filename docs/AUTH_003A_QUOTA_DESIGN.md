# AUTH-003A-3 — Durable Quota Design

## The problem with the in-memory limiter

`backend/middleware/requireEntitlement.js`'s rate limiter is an in-memory `Map`. **It does not guarantee a production spending ceiling** — stated plainly, not implied:

- It resets to **zero on every process restart** (a Render redeploy, a crash, a routine restart — not rare events). A user's "daily limit" is really "limit per restart interval," which can be crossed many times over in a real day depending on how often the process restarts.
- It is correct only **within a single process**. Today's `render.yaml` defines one `type: web` instance with no scaling config, so this specific gap isn't live — but nothing enforces that stays true, and the moment this service is ever scaled horizontally, each instance tracks its own separate counter.

Both are honestly documented in the code now, not glossed over.

## The durable alternative — `backend/lib/quota.js`

A single atomic Postgres statement:

```sql
INSERT INTO public.openai_quota (user_id, day, count)
VALUES ($1, current_date, 1)
ON CONFLICT (user_id, day) DO UPDATE
  SET count = public.openai_quota.count + 1
  WHERE public.openai_quota.count < $2
RETURNING count;
```

Postgres locks the conflicting `(user_id, day)` row before evaluating the `WHERE` clause, so two concurrent transactions for the same user genuinely serialize on that lock — there is no window where both can observe "under the limit" before either writes. If the `WHERE` fails (already at the limit), no row is returned — that absence *is* the rejection signal.

**Proven, not just argued**: `backend/tests/quota.concurrency.test.mjs` fires up to 50 genuinely concurrent requests (real, separate Postgres connections via a pool, `Promise.all`, not a loop) against a real disposable local Postgres and confirms **exactly N succeed under a limit of N, never N+1** — repeated 5 times with fresh users to rule out a lucky single run, plus independent verification that two different users racing simultaneously never affect each other's count, and that a new day starts a fresh bucket. All 8 assertions passed. The disposable test database was created and destroyed for this proof; nothing here touched the shared production project.

## Why not wired in as the default yet

`TRAFFIC_STRATEGY_MAP_DB_URL` itself isn't configured in Production yet (see `docs/AUTH_003A_SETUP_CHECKLIST.md`) — adopting the durable quota is naturally sequenced alongside that setup. The in-memory limiter remains an honest-labeled, same-process-only safety net in the meantime: better than nothing, never claimed as more than that.

## Adopting it

Once `TRAFFIC_STRATEGY_MAP_DB_URL` is configured, swap `checkAndIncrementRateLimit` (in-memory) for `checkAndIncrementQuotaAtomic(pool, userId, dailyLimit)` (`backend/lib/quota.js`) inside `requireEntitlement.js` — same call shape (`{ allowed, remaining }`), so this is a drop-in change, not a rewrite. Apply `supabase/migrations/20261118140000_add_durable_openai_quota.sql` first.
