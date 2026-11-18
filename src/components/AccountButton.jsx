// AUTH-003B - the sign-in/sign-out entry point for the shared ADVESER
// Account SSO. Signed out: a single button that navigates (full page
// load, not a fetch) to the backend's /auth/sso/start, which redirects
// to the shared Supabase OAuth Server's consent screen and eventually
// back here. Signed in: shows the account's email and a sign-out
// action. Uses useAuth() directly rather than threading auth state
// through the zustand store/App.jsx - this is the only place in the
// UI (besides StrategiesModal) that needs it.
import React, { useRef, useState } from 'react';
import { User, LogOut, LogIn, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '../hooks/useAuth';
import { buildSignInUrl } from '../services/auth';
import { isApiConfigured } from '../lib/api';

export default function AccountButton() {
  const t = useTranslation();
  const { status, email, isAuthenticated, isLoading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useOutsideClick(ref, () => setOpen(false));

  if (!isApiConfigured) return null;

  if (isLoading) {
    return (
      <div className="p-1.5 rounded-lg text-slate-500" title={t('account_sign_in')}>
        <Loader2 size={15} className="animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <a
        href={buildSignInUrl()}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-indigo-500/15 border border-white/[0.08] transition-colors"
        title={t('cloud_sign_in_btn')}
      >
        <LogIn size={13} />
        <span className="hidden sm:inline">{t('account_sign_in')}</span>
      </a>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
          open ? 'text-indigo-400 bg-indigo-500/15' : 'text-slate-300 hover:text-indigo-400 hover:bg-indigo-500/10'
        }`}
        title={email ? `${t('account_signed_in_as')} ${email}` : undefined}
      >
        <User size={13} />
        <span className="hidden sm:inline truncate max-w-[140px]">{email || t('account_signed_in_as')}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 bg-[#0d0e24] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-50">
          {email && (
            <div className="px-3.5 py-2.5 border-b border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{t('account_signed_in_as')}</p>
              <p className="text-[12px] text-white truncate">{email}</p>
            </div>
          )}
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[12px] text-slate-300 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={13} />
            {t('account_sign_out')}
          </button>
        </div>
      )}
    </div>
  );
}

function useOutsideClick(ref, onOutside) {
  React.useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside]);
}
