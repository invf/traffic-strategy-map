// ADV-002B - backend/routes/projectsProxy.js: proves the route uses the
// CALLING user's own verified id (never a client-supplied one), scopes
// to membership + excludes archived projects via the query itself, and
// fails closed (503) on any unexpected error rather than returning an
// empty list indistinguishable from a real "no projects" result. A fake
// withSharedProjectTransaction stands in for the real one, matching
// strategiesProxy.test.mjs's own fake-fetchImpl convention.
//
// Run with: node backend/tests/projectsProxy.test.mjs

import express from 'express';
import request from 'supertest';
import { createProjectsRouter } from '../routes/projectsProxy.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function fakeSessionMiddleware(userId = 'user-a') {
  return (req, _res, next) => { req.userId = userId; next(); };
}

function buildApp({ withSharedProjectTransaction, userId }) {
  const app = express();
  app.use(express.json());
  app.use(fakeSessionMiddleware(userId));
  app.use(createProjectsRouter({ withSharedProjectTransaction }));
  return app;
}

async function run() {
  // ===== Constructor guard =====
  {
    let threw = false;
    try { createProjectsRouter({}); } catch { threw = true; }
    assert(threw, 'createProjectsRouter throws without withSharedProjectTransaction');
  }

  // ===== Uses THIS request's own verified userId, never a client-suppliable value =====
  {
    let capturedUserId;
    const withSharedProjectTransaction = async (userId, fn) => {
      capturedUserId = userId;
      return fn({ query: async () => ({ rows: [] }) });
    };
    const app = buildApp({ withSharedProjectTransaction, userId: 'the-real-verified-user' });
    await request(app).get('/api/projects').send({ userId: 'attacker-supplied-id' });
    assert(capturedUserId === 'the-real-verified-user', 'The route passes req.userId (set by requireSsoAuth upstream) - a body field named userId has no effect at all');
  }

  // ===== Query shape: membership JOIN, archived excluded, ordered =====
  {
    let capturedSql;
    let capturedParams;
    const withSharedProjectTransaction = async (userId, fn) => {
      return fn({
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return { rows: [{ id: 'p1', name: 'Project One', role: 'owner' }] };
        },
      });
    };
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-a' });
    const res = await request(app).get('/api/projects');
    assert(res.status === 200, 'GET /api/projects -> 200');
    assert(/project_members/i.test(capturedSql) && /adveser_core\.projects/i.test(capturedSql), 'Queries the real adveser_core.project_members / adveser_core.projects tables');
    assert(/archived_at is null/i.test(capturedSql), 'Excludes archived projects directly in the query, not as a post-filter');
    assert(JSON.stringify(capturedParams) === JSON.stringify(['user-a']), 'The WHERE clause is parameterized with the caller\'s own userId, not string-concatenated');
    assert(res.body.projects.length === 1 && res.body.projects[0].id === 'p1' && res.body.projects[0].role === 'owner', 'Returns the real row shape: id, name, role');
  }

  // ===== Empty result is a real empty array, not confused with an error =====
  {
    const withSharedProjectTransaction = async (userId, fn) => fn({ query: async () => ({ rows: [] }) });
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-with-no-projects' });
    const res = await request(app).get('/api/projects');
    assert(res.status === 200 && Array.isArray(res.body.projects) && res.body.projects.length === 0, 'A user with zero project memberships gets 200 with an empty array, never an error status');
  }

  // ===== Fails closed (503) on any unexpected error - never a silent empty list =====
  {
    const withSharedProjectTransaction = async () => { throw new Error('DB unreachable'); };
    const app = buildApp({ withSharedProjectTransaction, userId: 'user-a' });
    const res = await request(app).get('/api/projects');
    assert(res.status === 503, 'A thrown error (e.g. DB failure) is reported as 503, never silently swallowed into an empty 200 list');
    assert(!('projects' in (res.body || {})), 'The 503 response body is an error shape, not a disguised empty project list');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
