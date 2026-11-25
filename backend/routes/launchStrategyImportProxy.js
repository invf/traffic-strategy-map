// ADV-004 - reads the latest APPROVED Launch Studio Strategy Decision
// export for a shared ADVESER Project, via the SAME withSharedProjectTransaction
// mechanism projectsProxy.js already established (a direct Postgres
// connection to the same shared Supabase project, GUC-scoped RLS) - no new
// cross-product HTTP call needed, since TRAFFIC_STRATEGY_MAP_app already
// has the SELECT grant on launch_studio.approved_analysis_exports staged
// in this repo's own 20261125090300_grant_tsm_launch_export_read.sql
// migration.
//
// Mounted behind requireSsoAuth + requireProductEntitlement, same chain
// and same order as projectsProxy.js/strategiesProxy.js (see
// backend/app.js) - identity is already verified and the entitlement
// already checked by the time any handler here runs.
//
// Deliberately READ-ONLY and narrow: this route never writes anything,
// never calls Launch Studio's own API, and never decides anything about
// strategy - it only reads the one row Launch Studio's own approval flow
// already wrote. Importing that package into the graph (mapping,
// reconciliation) happens entirely client-side
// (src/utils/strategyDecisionMapping.js) and is persisted back through
// the EXISTING /api/strategies POST/PATCH routes, never a new write path
// here.

import { Router } from 'express';

export function createLaunchStrategyImportRouter({ withSharedProjectTransaction }) {
  if (typeof withSharedProjectTransaction !== 'function') {
    throw new Error('createLaunchStrategyImportRouter: withSharedProjectTransaction is required.');
  }

  const router = Router();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Membership scoping is the query itself (the JOIN only ever returns a
  // row for a project this user is actually a member of), same "the query
  // IS the authorization" shape projectsProxy.js already uses - never a
  // separate check-then-filter step, and never confirms a project's
  // existence to a non-member (a non-member and a genuinely export-less
  // project both resolve to the same `export: null` response).
  router.get('/api/projects/:projectId/approved-strategy-export', async (req, res) => {
    const { projectId } = req.params;
    if (!UUID_RE.test(projectId)) {
      return res.status(400).json({ error: { message: 'Invalid projectId.' } });
    }
    try {
      const row = await withSharedProjectTransaction(req.userId, async (client) => {
        const result = await client.query(
          `SELECT e.id, e.project_id, e.source_revision_id, e.schema_version,
                  e.strategy_decision_package, e.approved_at, e.approved_by
             FROM launch_studio.approved_analysis_exports e
             JOIN adveser_core.project_members m ON m.project_id = e.project_id
            WHERE e.project_id = $1
              AND m.user_id = $2
            ORDER BY e.approved_at DESC
            LIMIT 1`,
          [projectId, req.userId]
        );
        return result.rows[0] || null;
      });

      if (!row) {
        return res.json({ export: null });
      }

      res.json({
        export: {
          id: row.id,
          projectId: row.project_id,
          sourceRevisionId: row.source_revision_id,
          schemaVersion: row.schema_version,
          strategyDecisionPackage: row.strategy_decision_package,
          approvedAt: row.approved_at,
          approvedBy: row.approved_by,
        },
      });
    } catch (err) {
      // Fail closed, same discipline as projectsProxy.js/strategiesProxy.js:
      // a thrown error is never treated as "no export" - a real empty
      // result (export: null, handled above) and an infrastructure
      // failure (503 here) must never look the same to the caller.
      console.error('[launchStrategyImportProxy] Unexpected failure:', err?.message ?? err);
      res.status(503).json({ error: { message: 'Launch Studio strategy data is temporarily unavailable.' } });
    }
  });

  return router;
}
