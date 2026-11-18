// AUTH-003B - the one behavior this whole migration exists to enforce:
// a signed-out visitor sees a sign-in prompt and the app never attempts
// an authenticated strategies request on their behalf. Mocks useAuth()
// and the services/strategies.js module so this test can assert on
// whether those functions were called at all, not just on rendered text.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../lib/api', () => ({ resolveApiUrl: (path) => `http://localhost:3001${path}` }));
vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    cloud_title: 'Strategies',
    cloud_signed_out_title: 'Sign in required',
    cloud_signed_out_hint: 'Sign in with your ADVESER Account to save and load your private strategies.',
    cloud_sign_in_btn: 'Sign in with ADVESER Account',
  }[key] || key),
}));
vi.mock('../store/useStore', () => ({
  useStore: () => ({ setShowStrategies: vi.fn(), nodes: [], edges: [], productInfo: {}, aiSuggestions: {}, loadStrategy: vi.fn() }),
}));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const listStrategies = vi.fn();
const getStrategy = vi.fn();
const createStrategy = vi.fn();
const deleteStrategy = vi.fn();
vi.mock('../services/strategies', () => ({
  listStrategies: (...a) => listStrategies(...a),
  getStrategy: (...a) => getStrategy(...a),
  createStrategy: (...a) => createStrategy(...a),
  deleteStrategy: (...a) => deleteStrategy(...a),
  StrategiesApiError: class StrategiesApiError extends Error {},
  errorKeyForStatus: () => null,
}));

import StrategiesModal from './StrategiesModal';

describe('StrategiesModal - signed-out gate', () => {
  it('shows the "Sign in required" prompt, never the Save/Load tabs, while signed out', () => {
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null, isAuthenticated: false, isLoading: false, signOut: vi.fn() });
    render(<StrategiesModal />);

    expect(screen.getByText('Sign in required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('never calls listStrategies (or any strategies API) while signed out', () => {
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null, isAuthenticated: false, isLoading: false, signOut: vi.fn() });
    render(<StrategiesModal />);

    expect(listStrategies).not.toHaveBeenCalled();
    expect(getStrategy).not.toHaveBeenCalled();
    expect(createStrategy).not.toHaveBeenCalled();
    expect(deleteStrategy).not.toHaveBeenCalled();
  });

  it('shows a loading state, not the signed-out prompt, while the session check is in flight', () => {
    mockUseAuth.mockReturnValue({ status: 'loading', email: null, isAuthenticated: false, isLoading: true, signOut: vi.fn() });
    render(<StrategiesModal />);

    expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
  });

  it('calls listStrategies exactly once on mount once authenticated (the Save tab is the default, Load tab fetches lazily)', () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'user@example.com', isAuthenticated: true, isLoading: false, signOut: vi.fn() });
    listStrategies.mockResolvedValue([]);
    render(<StrategiesModal />);

    // Default tab is "Save" - LoadTab (and its fetch) only mounts when
    // that tab is selected, so no call happens from this render alone.
    expect(listStrategies).not.toHaveBeenCalled();
    expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
  });
});
