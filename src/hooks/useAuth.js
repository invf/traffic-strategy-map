// AUTH-003B - a thin, shared view of the SSO session for any component
// that needs to know "is someone signed in, and as whom" (the account
// button, StrategiesModal's signed-out gate). Deliberately NOT part of
// the persisted zustand store (src/store/useStore.js) - auth state is
// server-authoritative (the cookie + GET /auth/sso/session), never
// something to rehydrate from localStorage and trust on faith.
import { useCallback, useEffect, useState } from 'react';
import { isApiConfigured } from '../lib/api';
import { fetchSsoSession, signOut as signOutRequest } from '../services/auth';

export function useAuth() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'signed-out'
  const [email, setEmail] = useState(null);

  const refresh = useCallback(async () => {
    if (!isApiConfigured) {
      setStatus('signed-out');
      setEmail(null);
      return;
    }
    const session = await fetchSsoSession();
    if (session.authenticated) {
      setStatus('authenticated');
      setEmail(session.email || null);
    } else {
      setStatus('signed-out');
      setEmail(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    await signOutRequest();
    setStatus('signed-out');
    setEmail(null);
  }, []);

  return {
    status,
    email,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    refresh,
    signOut,
  };
}
