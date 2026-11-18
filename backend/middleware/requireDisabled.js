// AUTH-003A - Final Security Corrections.
//
// Replaces the old Mode 2 (TEMPORARY_SHARED_SECRET) for /api/openai.
// That design was unsafe for THIS app's actual architecture: the
// frontend is a static Vite SPA that calls this endpoint directly from
// the browser (src/services/openai.js, fetch(`${VITE_API_URL}/api/openai`...)
// - confirmed by reading it, not assumed). Any secret the frontend would
// need to attach gets inlined into the public JS bundle at build time
// (the same VITE_*-env mechanism already relied on elsewhere in this
// codebase), making a "shared secret" readable by anyone who opens the
// bundle - security theater, not a restriction. Per this ticket's own
// instruction: if a restriction requires exposing the secret to the
// frontend, it must not be used.
//
// This middleware is the honest alternative: until a real OAuth client
// exists (requireAuth's Mode 1), /api/openai is simply UNAVAILABLE -
// every request gets a clear 503, OpenAI is never called, no secret of
// any kind is involved. "Temporarily disable paid AI requests until
// OAuth SSO is operational," exactly as the ticket allows.
export function requireDisabled(_req, res, _next) {
  return res.status(503).json({
    error: {
      message: 'AI-assisted strategy generation is temporarily unavailable while this endpoint is being secured. It will return once Central ADVESER SSO is live.',
    },
  });
}
