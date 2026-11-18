// AUTH-003B - the shared session-state hook every signed-in/signed-out
// UI decision (AccountButton, StrategiesModal's gate) is built on.
// Mocks services/auth.js and lib/api.js directly - no real fetch, no
// real backend - so these assertions are about the hook's own state
// machine, not the network layer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../lib/api', () => ({ isApiConfigured: true }));
vi.mock('../services/auth', () => ({
  fetchSsoSession: vi.fn(),
  signOut: vi.fn(),
}));

import { useAuth } from './useAuth';
import { fetchSsoSession, signOut } from '../services/auth';

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in the loading state before the session check resolves', () => {
    fetchSsoSession.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('becomes authenticated with the email when the session check says so', async () => {
    fetchSsoSession.mockResolvedValue({ authenticated: true, email: 'user@example.com' });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.email).toBe('user@example.com');
  });

  it('becomes signed-out, with no email, when the session check says unauthenticated', async () => {
    fetchSsoSession.mockResolvedValue({ authenticated: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.email).toBeNull();
  });

  it('signOut() calls the real logout request and resets local state to signed-out', async () => {
    fetchSsoSession.mockResolvedValue({ authenticated: true, email: 'user@example.com' });
    signOut.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => { await result.current.signOut(); });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.email).toBeNull();
  });

  it('never claims authenticated if the backend is unreachable (fetchSsoSession rejects are swallowed upstream as signed-out)', async () => {
    fetchSsoSession.mockResolvedValue({ authenticated: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(result.current.isAuthenticated).toBe(false);
  });
});
