// AUTH-003B pre-production audit - apiFetch's silent-refresh-and-retry
// behavior: a 401 should trigger exactly one GET /auth/sso/session
// attempt, and only retry the original request if that comes back
// authenticated - never loop, never retry on a 403/429/503 (those are
// real final answers from an otherwise-valid session), and never
// recurse into refreshing the session-check call itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not retry on a non-401 response (403/429/503 are final answers)', async () => {
    const { apiFetch } = await import('./api.js');
    global.fetch.mockResolvedValueOnce({ status: 403, ok: false });
    const res = await apiFetch('/api/strategies');
    expect(res.status).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('on 401, calls GET /auth/sso/session once, and retries the original request once when it reports authenticated', async () => {
    const { apiFetch } = await import('./api.js');
    global.fetch
      .mockResolvedValueOnce({ status: 401, ok: false }) // original request
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, email: 'u@example.com' }) }) // session refresh check
      .mockResolvedValueOnce({ status: 200, ok: true }); // retried original request

    const res = await apiFetch('/api/strategies');

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[1][0]).toContain('/auth/sso/session');
    expect(res.status).toBe(200);
  });

  it('on 401, does NOT retry if the session-refresh check reports still-unauthenticated', async () => {
    const { apiFetch } = await import('./api.js');
    global.fetch
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) });

    const res = await apiFetch('/api/strategies');

    expect(global.fetch).toHaveBeenCalledTimes(2); // never a 3rd (retried) call
    expect(res.status).toBe(401);
  });

  it('never recurses: a 401 from the session-check call itself is never retried', async () => {
    const { apiFetch } = await import('./api.js');
    global.fetch.mockResolvedValueOnce({ status: 401, ok: false });
    const res = await apiFetch('/auth/sso/session');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });
});
