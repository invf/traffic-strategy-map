// ADV-004 - backend/routes/launchStrategyImportProxy.js: proves the route
// uses the CALLING user's own verified id, scopes to membership via the
// query itself (never a separate check-then-filter step), validates
// projectId, and fails closed (503) on any unexpected error rather than
// returning something indistinguishable from a real "no export" result.
// Same fake-withSharedProjectTransaction convention as
// projectsProxy.test.mjs.
//
// Run with: node backend/tests/launchStrategyImportProxy.test.mjs

import express from 'express';
import request from 'supertest';
import { createLaunchStrategyImportRouter } from '../routes/launchStrategyImportProxy.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

const VALID_PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function fakeSessionMiddleware(userId = 'user-a') {
  return (req, _res, next) => { req.userId = userId; next(); };
}

function buildApp({ withSharedProjectTransaction, userId }) {
  const app = express();
  app.use(express.json());
  app.use(fakeSessionMiddleware(userId));
  app.use(createLaunchStrategyImportRouter({ withSharedProjectTransaction }));
  return app;
}

async function run() {
  // ===== Constructor guard =====
  {
    let threw = false;
    try { createLaunchStrategyImportRouter({}); } catch { threw = true; }
    assert(threw, 'createLaunchStrategyImportRouter throws without withSharedProjectTransaction');
  }

  // ===== Invalid projectId is rejected with 400, never reaches the DB =====
  {
    let dbCalled = false;
    const withSharedProjectTransaction = async () => { dbCalled = true; };
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-a' });
    const res = await request(app).get('/api/projects/not-a-uuid/approved-strategy-export');
    assert(res.status === 400, 'A malformed projectId is rejected with 400');
    assert(!dbCalled, 'The database is never queried for a malformed projectId');
  }

  // ===== Uses THIS request's own verified userId, never a client-suppliable value =====
  {
    let capturedUserId;
    const withSharedProjectTransaction = async (userId, fn) => {
      capturedUserId = userId;
      return fn({ query: async () => ({ rows: [] }) });
    };
    const app = buildApp({ withSharedProjectTransaction, userId: 'the-real-verified-user' });
    await request(app).get(`/api/projects/${VALID_PROJECT_ID}/approved-strategy-export`).send({ userId: 'attacker-supplied-id' });
    assert(capturedUserId === 'the-real-verified-user', 'The route passes req.userId (set by requireSsoAuth upstream) - a body field named userId has no effect');
  }

  // ===== Query shape: membership JOIN, scoped by project id AND user id =====
  {
    let capturedSql;
    let capturedParams;
    const withSharedProjectTransaction = async (userId, fn) =>
      fn({
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return {
            rows: [{
              id: 'export-1',
              project_id: VALID_PROJECT_ID,
              source_revision_id: 'rev-1',
              schema_version: 1,
              strategy_decision_package: { schemaVersion: 1, objectives: [] },
              approved_at: '2026-01-01T00:00:00.000Z',
              approved_by: 'user-a',
            }],
          };
        },
      });
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-a' });
    const res = await request(app).get(`/api/projects/${VALID_PROJECT_ID}/approved-strategy-export`);
    assert(res.status === 200, 'GET .../approved-strategy-export -> 200');
    assert(/project_members/i.test(capturedSql) && /approved_analysis_exports/i.test(capturedSql), 'Queries the real adveser_core.project_members / launch_studio.approved_analysis_exports tables');
    assert(JSON.stringify(capturedParams) === JSON.stringify([VALID_PROJECT_ID, 'user-a']), 'The query is parameterized with the real projectId and the caller\'s own userId, not string-concatenated');
    assert(res.body.export.id === 'export-1' && res.body.export.strategyDecisionPackage.schemaVersion === 1, 'Returns the real export shape, including the full strategyDecisionPackage');
  }

  // ===== No export yet (or not a member) -> export: null, 200, never confused with an error =====
  {
    const withSharedProjectTransaction = async (userId, fn) => fn({ query: async () => ({ rows: [] }) });
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-with-no-export' });
    const res = await request(app).get(`/api/projects/${VALID_PROJECT_ID}/approved-strategy-export`);
    assert(res.status === 200 && res.body.export === null, 'A project with no approved export (or a non-member) gets 200 with export: null, never an error status, never confirming membership either way');
  }

  // ===== Fails closed (503) on any unexpected error =====
  {
    const withSharedProjectTransaction = async () => { throw new Error('DB unreachable'); };
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-a' });
    const res = await request(app).get(`/api/projects/${VALID_PROJECT_ID}/approved-strategy-export`);
    assert(res.status === 503, 'A thrown error (e.g. DB failure) is reported as 503, never silently swallowed into export: null');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
