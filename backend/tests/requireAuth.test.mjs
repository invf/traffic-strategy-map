// AUTH-003A - requireAuth.js, tested end-to-end against a REAL local
// JWKS server and REAL signed JWTs (via `jose`'s own key generation),
// not mocks of jose itself - this proves the actual verification logic
// works, not just that it calls the library correctly.
//
// Run with: node backend/tests/requireAuth.test.mjs

import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createRequireAuth } from '../middleware/requireAuth.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

async function run() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  const server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const issuer = `${baseUrl}/auth/v1`;

  // allowAnyClient: true here only because MOST of these cases are
  // about issuer/audience/signature/expiry, not client scoping - the
  // client_id-specific behavior (including the REQUIRED-by-default
  // case) is tested on its own further down with its own instances.
  const requireAuth = createRequireAuth({ jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`, issuer, audience: 'authenticated', allowAnyClient: true });

  async function signToken(overrides = {}) {
    return new SignJWT({ role: 'authenticated', client_id: 'test-client', ...overrides })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setSubject(overrides.sub ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // ===== No Authorization header at all =====
  {
    const req = { headers: {} };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'No Authorization header -> 401, next() never called');
  }

  // ===== Malformed header (not "Bearer ...") =====
  {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A non-Bearer Authorization header -> 401');
  }

  // ===== A real, validly-signed, correctly-issued token - a REAL OAuth-token-shaped claim set =====
  {
    const token = await signToken({
      sub: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      email: 'user@example.com',
      client_id: 'traffic-strategy-map-client',
      aal: 'aal1',
      amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }],
      session_id: 'some-session-id',
    });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'A validly-signed token with the documented OAuth claim shape passes verification and calls next()');
    assert(req.userId === 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'req.userId is set to exactly the sub claim - the canonical user UUID, not the client_id or session_id');
  }

  // ===== Wrong issuer (e.g. a token from a DIFFERENT Supabase project) =====
  {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer('https://a-different-project.supabase.co/auth/v1')
      .setAudience('authenticated')
      .setSubject('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A token with the wrong issuer is rejected, even with a validly-signed, correctly-shaped payload');
  }

  // ===== Wrong audience =====
  {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience('some-other-audience')
      .setSubject('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A token with the wrong audience is rejected');
  }

  // ===== Expired token =====
  {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setSubject('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'An expired token is rejected');
  }

  // ===== Tampered signature =====
  {
    const token = await signToken();
    const tampered = token.slice(0, -4) + 'XXXX';
    const req = { headers: { authorization: `Bearer ${tampered}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A tampered signature is rejected');
  }

  // ===== No sub claim at all =====
  {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A token with no sub claim is rejected - there is no user id to trust');
  }

  // ===== expectedClientId: a token issued to a DIFFERENT OAuth client of the SAME project is rejected =====
  {
    const requireAuthScoped = createRequireAuth({
      jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`,
      issuer,
      audience: 'authenticated',
      expectedClientId: 'traffic-strategy-map-client',
    });
    const tokenForADifferentClient = await signToken({ client_id: 'launch-studio-client' });
    const req = { headers: { authorization: `Bearer ${tokenForADifferentClient}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuthScoped(req, res, () => { nextCalled = true; });
    assert(
      res.statusCode === 401 && !nextCalled,
      "A validly-signed, correctly-issued token for a DIFFERENT OAuth client (e.g. Launch Studio's) is rejected when expectedClientId is set - same issuer/audience/signature is not enough on its own"
    );
  }
  {
    const requireAuthScoped = createRequireAuth({
      jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`,
      issuer,
      audience: 'authenticated',
      expectedClientId: 'traffic-strategy-map-client',
    });
    const tokenForTheRightClient = await signToken({ client_id: 'traffic-strategy-map-client' });
    const req = { headers: { authorization: `Bearer ${tokenForTheRightClient}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuthScoped(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'A token for the EXPECTED client_id passes, all else being equal');
  }
  {
    // With allowAnyClient: true EXPLICITLY passed (this test file's own
    // module-level instance), client_id is not checked - confirmed so
    // this isn't mistaken for always-on. This flag has no production
    // caller - server.js never passes it.
    const tokenAnyClient = await signToken({ client_id: 'some-other-client' });
    const req = { headers: { authorization: `Bearer ${tokenAnyClient}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'With allowAnyClient: true explicitly passed, client_id is not restricted');
  }

  // ===== AUTH-003A-3: omitting expectedClientId (and NOT passing allowAnyClient) is a loud, immediate construction-time failure =====
  {
    let threw = false;
    let message = '';
    try {
      createRequireAuth({ jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`, issuer, audience: 'authenticated' });
    } catch (err) {
      threw = true;
      message = err.message;
    }
    assert(threw, 'Constructing requireAuth with neither expectedClientId nor allowAnyClient throws immediately - a misconfigured deployment fails loudly at startup, never silently runs with client-scoping quietly disabled');
    assert(/expectedClientId is required/i.test(message), 'The error message names exactly what is missing and why, not a generic failure');
  }
  {
    // allowAnyClient: false (the default) behaves identically to
    // omitting it - there is no way to accidentally get the unscoped
    // behavior without the explicit true.
    let threw = false;
    try {
      createRequireAuth({ jwksUri: `${baseUrl}/auth/v1/.well-known/jwks.json`, issuer, audience: 'authenticated', allowAnyClient: false });
    } catch {
      threw = true;
    }
    assert(threw, 'allowAnyClient: false is equivalent to omitting it entirely - still throws');
  }

  await new Promise((resolve) => server.close(resolve));

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
