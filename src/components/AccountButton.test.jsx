// AUTH-003B - the sign-in/sign-out entry point in the TopBar. Mocks
// useAuth() directly (already unit-tested on its own in useAuth.test.jsx)
// so this file is purely about what AccountButton renders/does for each
// auth state, not about the session-fetching logic itself.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../lib/api', () => ({ isApiConfigured: true, getApiUrl: () => 'http://localhost:3001' }));
vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    account_sign_in: 'Sign in',
    account_sign_out: 'Sign out',
    account_signed_in_as: 'Signed in as',
    cloud_sign_in_btn: 'Sign in with ADVESER Account',
  }[key] || key),
}));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

import AccountButton from './AccountButton';

describe('AccountButton', () => {
  it('shows a sign-in link (not a button that fetches) while signed out, pointing at the real sign-in url', () => {
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null, isAuthenticated: false, isLoading: false, signOut: vi.fn() });
    render(<AccountButton />);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toMatch(/\/auth\/sso\/start/);
  });

  it('shows a loading indicator, not a sign-in link, while the session check is in flight', () => {
    mockUseAuth.mockReturnValue({ status: 'loading', email: null, isAuthenticated: false, isLoading: true, signOut: vi.fn() });
    render(<AccountButton />);
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('shows the signed-in email, and signing out calls the real signOut()', () => {
    const signOut = vi.fn();
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'user@example.com', isAuthenticated: true, isLoading: false, signOut });
    render(<AccountButton />);

    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user@example.com'));
    fireEvent.click(screen.getByText('Sign out'));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
