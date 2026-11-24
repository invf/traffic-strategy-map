// ADV-002B - minimal, feature-flagged listing of the signed-in user's own
// ADVESER Projects, reading the shared adveser_core schema via
// backend/lib/sharedProjectAccess.js's withSharedProjectTransaction().
//
// Mounted behind requireSsoAuth + requireProductEntitlement, same chain
// and same order as strategiesProxy.js (see backend/app.js) - identity is
// already verified (req.userId) and the traffic_strategy_map entitlement
// already checked by the time any handler here runs. This file adds no
// second entitlement check and no separate authentication mechanism of
// any kind.
//
// Scope, deliberately narrow (ADV-002B, not ADV-003/ADV-004): list only.
// No analysis-export read, no strategy-creation-from-analysis route - both
// belong to a later milestone, once Launch Studio's own approval UI
// exists to produce something real for them to read.

import { Router } from 'express';

export function createProjectsRouter({ withSharedProjectTransaction }) {
  if (typeof withSharedProjectTransaction !== 'function') {
    throw new Error('createProjectsRouter: withSharedProjectTransaction is required.');
  }

  const router = Router();

  // Membership scoping is the query itself, not a separate check-then-
  // filter step: the JOIN only ever returns rows adveser_core.
  // project_members already says this user belongs to - there is no
  // "other user's project" result to accidentally include, the same
  // "the query IS the authorization" shape listMyProjects() uses in
  // invf/adveser-launch-studio's own server/db/projects.ts. Archived
  // projects are excluded explicitly (p.archived_at IS NULL), matching
  // that repo's own existing archived/active distinction.
  router.get('/api/projects', async (req, res) => {
    try {
      const rows = await withSharedProjectTransaction(req.userId, async (client) => {
        const result = await client.query(
          `SELECT p.id, p.name, m.role
             FROM adveser_core.project_members m
             JOIN adveser_core.projects p ON p.id = m.project_id
            WHERE m.user_id = $1
              AND p.archived_at IS NULL
            ORDER BY p.created_at DESC`,
          [req.userId]
        );
        return result.rows;
      });
      res.json({ projects: rows.map((r) => ({ id: r.id, name: r.name, role: r.role })) });
    } catch (err) {
      // Fail closed, same discipline as checkEntitlement()/strategiesProxy.js:
      // a thrown error (DB unreachable, GUC-setting failure, anything
      // unexpected) is NEVER treated as "no projects" (an empty array
      // would be indistinguishable from a real empty result) - it's a
      // distinct 503, visible as an infrastructure problem, not a quiet
      // empty list.
      console.error('[projectsProxy] Unexpected failure:', err?.message ?? err);
      res.status(503).json({ error: { message: 'Shared project data is temporarily unavailable.' } });
    }
  });

  return router;
}
