// AUTH-003A - the Express app as a DI'd factory, separate from
// server.js's job of wiring real dependencies and binding a port. Same
// convention used throughout this engagement (resolveProductGateway.ts's
// GatewayDeps, ssoRoutes.ts's SsoRouterDeps) - lets tests exercise the
// real route, real middleware order, and real fire-and-forget usage
// logging against injected fakes, without a live OpenAI key, Postgres
// connection, or Supabase project.
import express from 'express';
import cors from 'cors';

export function createApp({ requireAuth, requireEntitlement, openaiApiKey, fetchImpl = fetch, recordUsage, frontendUrl = '*', ssoRouter, requireSsoAuth, strategiesRouter }) {
  const app = express();

  // AUTH-003B: credentials: true is required for the cross-origin SSO
  // cookie (Vercel frontend, Render backend - genuinely different
  // origins) to ever be sent by the browser at all. The CORS spec
  // forbids combining credentials with origin: '*', so frontendUrl
  // must be a real, specific origin whenever ssoRouter/cookies are in
  // play - acceptable here since this app always configures
  // FRONTEND_URL for its one real frontend.
  app.use(cors({ origin: frontendUrl, methods: ['GET', 'POST', 'OPTIONS'], credentials: true }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Mounted OUTSIDE the /api/openai auth gate below - these ARE the
  // flow's own entry/exit points, not protected routes.
  if (ssoRouter) {
    app.use(ssoRouter);
  }

  // AUTH-003B - the strategies proxy (backend/routes/strategiesProxy.js)
  // is gated by requireSsoAuth specifically, never requireAuth above:
  // this is the real browser frontend's own cookie-based credential,
  // not a caller holding a raw Bearer token. Only mounted once the SSO
  // cookie mechanism is actually configured (see server.js) - otherwise
  // these routes simply don't exist (404), the same "absent, not
  // silently degraded" discipline as every other not-yet-configured
  // piece of this app.
  if (strategiesRouter && requireSsoAuth) {
    app.use(requireSsoAuth, strategiesRouter);
  }

  app.post('/api/openai', requireAuth, requireEntitlement, async (req, res) => {
    const userId = req.userId;
    const requestedAt = new Date().toISOString();

    // Fire-and-forget, after the fact, reflecting what ACTUALLY happened
    // - never blocks the response, never affects whether this request
    // itself succeeds. The rate limit was already charged in
    // requireEntitlement, before this handler even ran; this is
    // logging, not enforcement.
    //
    // No-op when there's no real user id (AUTH-003A-3's temporary
    // shared-secret mode - see requireSharedSecret.js - establishes no
    // identity at all). Logging a NULL/garbage user_id would be worse
    // than not logging; this mode has no per-user accounting by design.
    function logUsage(status, upstreamStatus = null) {
      if (!userId) return;
      void recordUsage(userId, { path: req.path, at: requestedAt, status, upstreamStatus }).catch((err) => {
        console.error('[server] Usage recording failed (non-fatal):', err?.message ?? err);
      });
    }

    if (!openaiApiKey) {
      logUsage('not_configured');
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY not configured on server' } });
    }
    try {
      const upstream = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(req.body),
      });
      // Parsed rather than streamed through raw, so a malformed/
      // unexpected upstream body can never reach the client as
      // something other than JSON - and never includes this server's
      // own request headers (which carried openaiApiKey), since only
      // the parsed response BODY is ever touched here.
      const data = await upstream.json();
      logUsage(upstream.ok ? 'success' : 'upstream_error', upstream.status);
      res.status(upstream.status).json(data);
    } catch (err) {
      logUsage('request_failed');
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return app;
}
