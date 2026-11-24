import React, { useEffect, useRef, useState } from 'react';
import { Layers, ChevronDown, ExternalLink, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from '../i18n/useTranslation';

const LAUNCH_STUDIO_URL = import.meta.env.VITE_LAUNCH_STUDIO_URL || 'https://adveser-launch-studio.onrender.com';

// ADV-003 - lists the signed-in user's shared ADVESER Projects
// (adveser_core.projects, via GET /api/projects), clearly SEPARATE from
// ProjectSwitcher's Cloud Projects/Local Drafts menu right next to it in
// TopBar.jsx: an ADVESER Project is a cross-product identity shared with
// Launch Studio, never a cloud strategy. Selecting one here is a pure
// CONTEXT choice (see useStore.js's own comment on activeAdveserProjectId)
// - it never loads, creates, renames, or deletes a strategy; the existing
// Cloud Projects/Local Drafts flows are completely untouched by this
// component existing. No create-project action here either, by design
// (requirement B) - "Open Launch Studio" is the only way to create one,
// reusing that product's own existing, already-reviewed creation flow
// rather than building a second one here.
export default function AdveserProjectsSelector() {
  const { adveserProjects, activeAdveserProjectId, setActiveAdveserProject } = useStore();
  const { isAuthenticated } = useAuth();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Signed-out users have no ADVESER identity to list projects for at
  // all - same gate StrategiesModal.jsx uses for Cloud Projects. Local
  // Drafts/Quick Strategy remain fully available regardless; this
  // component simply doesn't render, exactly as if it didn't exist.
  if (!isAuthenticated) return null;

  const active = adveserProjects.find((p) => p.id === activeAdveserProjectId) || null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-amber-200 hover:text-amber-100 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 transition-colors"
        title={t('adveser_projects_label')}
      >
        <Layers size={13} />
        <span className="hidden sm:inline max-w-[140px] truncate">
          {active ? active.name : t('adveser_projects_label')}
        </span>
        <ChevronDown size={10} className="text-amber-300/70" />
      </button>

      {open && (
        <div className="absolute left-0 top-9 w-64 bg-[#111228] border border-amber-500/20 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 text-[10px] font-bold uppercase tracking-wide text-amber-300/80">
            {t('adveser_projects_label')}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {adveserProjects.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <AlertCircle size={16} className="mx-auto mb-1.5 text-slate-500" />
                <p className="text-[11px] font-medium text-slate-300">{t('adveser_projects_empty')}</p>
                <p className="text-[10px] text-slate-500 mt-1">{t('adveser_projects_empty_hint')}</p>
              </div>
            ) : (
              adveserProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActiveAdveserProject(p.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                    p.id === activeAdveserProjectId
                      ? 'bg-amber-500/15 text-amber-200 font-semibold'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-500">
                    {p.role === 'owner' ? t('adveser_projects_role_owner') : t('adveser_projects_role_collaborator')}
                  </span>
                </button>
              ))
            )}
          </div>

          <a
            href={active ? `${LAUNCH_STUDIO_URL}/?project=${encodeURIComponent(active.id)}` : LAUNCH_STUDIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 border-t border-white/10 transition-colors"
          >
            <ExternalLink size={12} />
            {t('adveser_projects_open_in_launch_studio')}
          </a>
        </div>
      )}
    </div>
  );
}
