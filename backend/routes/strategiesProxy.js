// AUTH-003B - proxies public.strategies CRUD to PostgREST on the
// authenticated user's behalf.
//
// WHY A PROXY, NOT A DIRECT BROWSER-TO-SUPABASE CALL: public.strategies
// is RLS-protected (supabase/migrations/20261118120000_add_strategy_ownership.sql)
// - every policy on it requires a real Supabase-issued JWT so PostgREST
// can resolve auth.uid(). But this app's own SSO session (backend/auth/
// ssoSession.js) deliberately never hands that JWT to the browser - the
// ticket's own instruction is to keep the session mechanism replaceable
// without assuming setSession() compatibility. This route is how a
// private, owner-scoped row still gets read/written: the BACKEND holds
// the user's real (cached, auto-refreshed) access token via
// ensureValidAccessToken() and relays the request to PostgREST itself,
// server-to-server. The real token never reaches the browser at any
// point in this flow.
//
// Mounted behind requireSsoAuth - req.userId/req.sid are already
// verified, active-session values by the time any handler here runs.

import { Router } from 'express';

export class StrategiesProxyError extends Error {
  constructor(status, body) {
    super(typeof body?.message === 'string' ? body.message : 'Strategies request failed.');
    this.name = 'StrategiesProxyError';
    this.status = status;
    this.body = body;
  }
}

// Exported so callers constructing their own PostgREST requests (there
// are none yet outside this file) reuse the exact same header shape.
export function buildPostgrestHeaders(accessToken, anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function postgrestRequest(deps, accessToken, { method, path, query, body, extraHeaders }) {
  const url = new URL(`${deps.supabaseUrl}/rest/v1/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  const res = await deps.fetchImpl(url.toString(), {
    method,
    headers: { ...buildPostgrestHeaders(accessToken, deps.supabaseAnonKey), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new StrategiesProxyError(res.status, data);
  }
  return data;
}

// The subset of columns the list view needs - never the full nodes/
// edges/ai_suggestions payload, same shape the frontend already
// requests directly today (src/components/StrategiesModal.jsx's
// LoadTab) so this proxy is a drop-in replacement, not a new contract.
const LIST_COLUMNS = 'id,name,product_info,nodes,updated_at';

async function withAccessToken(req, res, deps, handler) {
  const accessToken = await deps.ensureValidAccessToken(req.sid);
  if (!accessToken) {
    return res.status(401).json({ error: { message: 'Your ADVESER Account session has expired. Please sign in again.' } });
  }
  try {
    await handler(accessToken);
  } catch (err) {
    if (err instanceof StrategiesProxyError) {
      return res.status(err.status).json({ error: { message: err.message, details: err.body } });
    }
    console.error('[strategiesProxy] Unexpected failure:', err?.message ?? err);
    return res.status(502).json({ error: { message: 'Strategies service is temporarily unavailable.' } });
  }
}

export function createStrategiesRouter(deps = {}) {
  const {
    ensureValidAccessToken,
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
    fetchImpl = fetch,
  } = deps;

  if (typeof ensureValidAccessToken !== 'function') {
    throw new Error('createStrategiesRouter: ensureValidAccessToken is required.');
  }
  if (!supabaseUrl) {
    throw new Error('createStrategiesRouter: supabaseUrl (or SUPABASE_URL) is required.');
  }
  if (!supabaseAnonKey) {
    throw new Error('createStrategiesRouter: supabaseAnonKey (or SUPABASE_ANON_KEY) is required.');
  }

  const resolved = { ensureValidAccessToken, supabaseUrl, supabaseAnonKey, fetchImpl };
  const router = Router();

  // List the CALLING user's own strategies only - no ?user_id filter is
  // added here because none is needed: the "read own or approved demo"
  // RLS policy already restricts PostgREST's result set to rows where
  // is_demo = true OR user_id = auth.uid(), resolved from the real
  // access token this request carries. A client-supplied filter could
  // only ever narrow that set further, never widen it.
  // ADV-004: an optional `?project_id=<uuid>` filter, added as a SECOND
  // PostgREST query-string filter (ANDed, same mechanism the PATCH
  // route's `expected_updated_at` already uses) - ONLY when present does
  // the select ALSO request project_id/source_launch_analysis_id. This
  // keeps the DEFAULT, already-shipped list call (no project_id param)
  // byte-identical to before this change: those two columns do not exist
  // on Production's public.strategies yet (the migration adding them is
  // still unapplied), so requesting them unconditionally would break the
  // list endpoint for every caller the moment this code ships, well
  // before the DB migration is ever applied. The project_id-filtered path
  // is only ever exercised by the Launch Studio import flow, itself
  // gated behind its own default-off feature flag - nothing reaches this
  // branch until the owner has also applied the migration.
  router.get('/api/strategies', async (req, res) => {
    await withAccessToken(req, res, resolved, async (accessToken) => {
      const { project_id } = req.query || {};
      const query = { select: project_id ? `${LIST_COLUMNS},project_id,source_launch_analysis_id` : LIST_COLUMNS, order: 'updated_at.desc' };
      if (project_id !== undefined) {
        query.project_id = `eq.${project_id}`;
      }
      const data = await postgrestRequest(resolved, accessToken, {
        method: 'GET',
        path: 'strategies',
        query,
      });
      res.json(data);
    });
  });

  router.get('/api/strategies/:id', async (req, res) => {
    await withAccessToken(req, res, resolved, async (accessToken) => {
      // AUTH-003B pre-production audit correction: the singular-object
      // Accept header (application/vnd.pgrst.object+json) was tried
      // here originally, on the assumption that zero matching rows
      // would come back as a 200 with a null body - a REAL local
      // Supabase/PostgREST stack proved that wrong (backend/
      // rehearsal_strategies_proxy.mjs): PostgREST instead returns a
      // 406 error (PGRST116, "0 rows") for that header, which was
      // being thrown as a generic 406 rather than ever reaching the
      // intended 404 branch below. Requesting a plain array and
      // checking its length is the SAME convention already proven
      // correct for PATCH/DELETE below - one fewer special case.
      const data = await postgrestRequest(resolved, accessToken, {
        method: 'GET',
        path: 'strategies',
        query: { select: '*', id: `eq.${req.params.id}` },
      });
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({ error: { message: 'Strategy not found.' } });
      }
      res.json(data[0]);
    });
  });

  // user_id is always set from the caller's OWN verified id, never from
  // the request body - a client-supplied user_id is silently discarded.
  // This is defense-in-depth, not the only enforcement: the "insert own"
  // RLS policy's WITH CHECK (user_id = auth.uid()) would reject a
  // mismatched value at the database level regardless.
  router.post('/api/strategies', async (req, res) => {
    await withAccessToken(req, res, resolved, async (accessToken) => {
      // ADV-004: project_id/source_launch_analysis_id are optional - only
      // ever sent by the "Import Strategy from Launch Studio" flow
      // (useAdveserProjectsSync's sibling, src/hooks/useLaunchStrategyImport.js),
      // which is itself gated behind its own feature flag and the
      // not-yet-applied TSM migrations that add these columns. Every
      // existing caller (plain create/Save as New) simply omits both,
      // byte-identical to before this change.
      const { name, nodes, edges, product_info, ai_suggestions, project_id, source_launch_analysis_id } = req.body || {};
      const body = {
        name,
        nodes,
        edges,
        product_info,
        ai_suggestions,
        user_id: req.userId,
        is_demo: false,
        updated_at: new Date().toISOString(),
      };
      if (project_id !== undefined) body.project_id = project_id;
      if (source_launch_analysis_id !== undefined) body.source_launch_analysis_id = source_launch_analysis_id;
      const data = await postgrestRequest(resolved, accessToken, {
        method: 'POST',
        path: 'strategies',
        body,
        extraHeaders: { Prefer: 'return=representation' },
      });
      res.status(201).json(Array.isArray(data) ? data[0] : data);
    });
  });

  // PATCH, not PUT - partial updates only, matching the "update own"
  // RLS policy's shape and the frontend's existing usage pattern.
  //
  // AUTH-004: an optional `expected_updated_at` in the body turns this
  // into a conditional update (optimistic concurrency, requirement 12 -
  // "avoid silently overwriting newer changes from another browser").
  // When present it's added as a SECOND PostgREST filter alongside
  // `id=eq.<id>` - PostgREST ANDs query-string filters into the
  // UPDATE's WHERE clause, so `updated_at=eq.<expected>` makes this a
  // real, Postgres-enforced conditional update, not a client-side
  // check. Omitting the field keeps this route byte-identical to
  // before this change (unconditional update) - existing callers are
  // unaffected.
  router.patch('/api/strategies/:id', async (req, res) => {
    await withAccessToken(req, res, resolved, async (accessToken) => {
      const { name, nodes, edges, product_info, ai_suggestions, expected_updated_at, project_id, source_launch_analysis_id } = req.body || {};
      const body = { updated_at: new Date().toISOString() };
      if (name !== undefined) body.name = name;
      if (nodes !== undefined) body.nodes = nodes;
      if (edges !== undefined) body.edges = edges;
      if (product_info !== undefined) body.product_info = product_info;
      if (ai_suggestions !== undefined) body.ai_suggestions = ai_suggestions;
      // ADV-004 - see the POST route's own comment above; re-pointing an
      // existing strategy at a NEWER export (re-import) updates this
      // column on the SAME row rather than creating a second one, which
      // is exactly what the one-row-per-project idempotency model
      // (this repo's own 20261125090200_... migration) expects.
      if (project_id !== undefined) body.project_id = project_id;
      if (source_launch_analysis_id !== undefined) body.source_launch_analysis_id = source_launch_analysis_id;

      const query = { id: `eq.${req.params.id}` };
      if (expected_updated_at !== undefined) {
        query.updated_at = `eq.${expected_updated_at}`;
      }

      const data = await postgrestRequest(resolved, accessToken, {
        method: 'PATCH',
        path: 'strategies',
        query,
        body,
        extraHeaders: { Prefer: 'return=representation' },
      });
      if (!Array.isArray(data) || data.length === 0) {
        if (expected_updated_at === undefined) {
          // Not a 404 vs 403 distinction - RLS makes another user's row
          // invisible rather than visibly forbidden, and this proxy
          // must not leak which case it was.
          return res.status(404).json({ error: { message: 'Strategy not found.' } });
        }
        // The conditional update matched zero rows - either the row
        // doesn't exist/isn't RLS-visible (same as the unconditional
        // case above), OR it exists but updated_at didn't match (someone
        // else changed it since the caller last fetched it). A single
        // follow-up unconditional GET disambiguates without ever
        // leaking RLS-invisible-vs-forbidden either.
        const current = await postgrestRequest(resolved, accessToken, {
          method: 'GET',
          path: 'strategies',
          query: { select: '*', id: `eq.${req.params.id}` },
        });
        if (!Array.isArray(current) || current.length === 0) {
          return res.status(404).json({ error: { message: 'Strategy not found.' } });
        }
        return res.status(409).json({
          error: { message: 'This strategy was changed elsewhere since you last loaded it.' },
          current: current[0],
        });
      }
      res.json(data[0]);
    });
  });

  router.delete('/api/strategies/:id', async (req, res) => {
    await withAccessToken(req, res, resolved, async (accessToken) => {
      const data = await postgrestRequest(resolved, accessToken, {
        method: 'DELETE',
        path: 'strategies',
        query: { id: `eq.${req.params.id}` },
        extraHeaders: { Prefer: 'return=representation' },
      });
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({ error: { message: 'Strategy not found.' } });
      }
      res.status(204).end();
    });
  });

  return router;
}
