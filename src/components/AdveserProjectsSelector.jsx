import React, { useEffect, useRef, useState } from 'react';
import { Layers, ChevronDown, ExternalLink, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from '../i18n/useTranslation';
import { listAdveserProjects } from '../services/adveserProjects';
import { findStrategyByProjectId } from '../services/strategies';
import { importLaunchStrategy } from '../services/launchStrategyImportFlow';

const LAUNCH_STUDIO_URL = import.meta.env.VITE_LAUNCH_STUDIO_URL || 'https://adveser-launch-studio.onrender.com';

function buildStrategyUrl(strategyId) {
  return `${window.location.origin}${window.location.pathname}?strategy=${encodeURIComponent(strategyId)}`;
}

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
  const { adveserProjects, activeAdveserProjectId, setActiveAdveserProject, hydrateAdveserProjects } = useStore();
  const { isAuthenticated } = useAuth();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [importState, setImportState] = useState({ status: 'idle' }); // idle | loading | done | no-export | error | unavailable | popup-blocked
  // ADV-004-FIX-2 (final correction) - null = "not checked yet"/"none
  // exists"; a string = the one linked strategy's real id. Drives which
  // action is offered: a project with NO linked strategy yet only ever
  // gets the (generating) "Import" action; a project that already HAS
  // one only ever gets "Open" (no generation at all - just navigate to
  // its own persisted content) plus a SEPARATE, explicit "Update from
  // Launch Studio" action. Opening never regenerates anything merely
  // because the user wants to look at it (the ticket's own explicit
  // requirement) - only Import/Update ever call importLaunchStrategy.
  const [linkedStrategyId, setLinkedStrategyId] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ADV-003-FIX-4: refresh the list - and therefore the canonical project
  // names it carries - at the one moment a stale name would actually be
  // seen: right when the user opens the menu to look at or pick from it.
  // `hydrateAdveserProjects` is a wholesale replace that never touches
  // `activeAdveserProjectId` (useStore.js), so this only ever updates
  // name/role/membership display data - never Cloud Strategies, Local
  // Drafts, or the active strategy graph, which this component has never
  // touched at all. Best-effort: a failed refresh just leaves the
  // previously-hydrated list showing, exactly as before this fix existed.
  useEffect(() => {
    if (!open) return;
    listAdveserProjects()
      .then((list) => hydrateAdveserProjects(list))
      .catch(() => {});
  }, [open, hydrateAdveserProjects]);

  const active = adveserProjects.find((p) => p.id === activeAdveserProjectId) || null;

  // ADV-004-FIX-2 (final correction) - looks up whether a cloud strategy
  // already exists for the ACTIVE project, purely to decide which
  // action to offer. A read-only check (findStrategyByProjectId), never
  // itself a trigger for anything - resets to "not checked yet" whenever
  // the active project changes, so switching projects never shows a
  // stale previous project's action set for an instant.
  useEffect(() => {
    setLinkedStrategyId(null);
    setImportState({ status: 'idle' });
    if (!open || !active) return;
    let cancelled = false;
    findStrategyByProjectId(active.id)
      .then((existing) => {
        if (!cancelled) setLinkedStrategyId(existing?.id || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, active?.id]);

  // Signed-out users have no ADVESER identity to list projects for at
  // all - same gate StrategiesModal.jsx uses for Cloud Projects. Local
  // Drafts/Quick Strategy remain fully available regardless; this
  // component simply doesn't render, exactly as if it didn't exist.
  if (!isAuthenticated) return null;

  // ADV-004-FIX-2 (final correction) - OPENING an existing strategy is a
  // pure navigation action: no network fetch of the Launch Studio export,
  // no mapping, no reconciliation, no persistence - it never regenerates
  // anything merely because the user wants to look at it. The new tab
  // loads the strategy independently from persistent storage
  // (useOpenStrategyFromUrl.js), never from this tab's state - this
  // tab's own graph is therefore guaranteed untouched regardless of what
  // happens in the new one.
  const handleOpenStrategy = () => {
    if (!linkedStrategyId) return;
    const url = buildStrategyUrl(linkedStrategyId);
    const newTab = window.open(url, '_blank');
    setImportState(newTab ? { status: 'idle' } : { status: 'popup-blocked', openedUrl: url });
  };

  // The one action that actually generates/persists - used for BOTH the
  // first-ever import (no linkedStrategyId yet) and the explicit "Update
  // from Launch Studio" action (linkedStrategyId already set) - the
  // underlying importLaunchStrategy() call already auto-detects which of
  // the two it's doing via its own findStrategyByProjectId lookup (see
  // that module). Never called just to OPEN an existing strategy.
  const runImportOrUpdate = async () => {
    if (!active) return;
    // Opened SYNCHRONOUSLY, before any await below - a browser only
    // honors window.open as a direct result of a user gesture when
    // called within the same synchronous call stack as the click; doing
    // this after an await would get silently blocked even with a real
    // click behind it. An empty target just opens about:blank, which we
    // navigate once the import actually succeeds.
    const newTab = window.open('', '_blank');
    setImportState({ status: 'loading' });
    try {
      const result = await importLaunchStrategy(active.id, active.name);
      if (result.status === 'no-export') {
        if (newTab && !newTab.closed) newTab.close(); // never leave a misleading blank tab open
        setImportState({ status: 'no-export' });
        return;
      }
      setLinkedStrategyId(result.strategyId);
      const url = buildStrategyUrl(result.strategyId);
      if (newTab && !newTab.closed) {
        newTab.location.href = url;
        setImportState({ ...result, status: 'done' });
      } else {
        // Popup blocked despite the synchronous call (can still happen
        // depending on browser settings) - never silently fail; a real
        // click on an <a> always bypasses a popup blocker.
        setImportState({ ...result, status: 'done', openedUrl: url });
      }
    } catch (err) {
      // Never leave a misleading blank tab open on failure - close it
      // and report the error in THIS tab, where the user already has
      // full context. The original graph was never touched either way
      // (importLaunchStrategy never reads/writes the active canvas).
      if (newTab && !newTab.closed) newTab.close();
      setImportState({ status: err?.status === 404 ? 'unavailable' : 'error' });
    }
  };

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

          {active && (
            linkedStrategyId ? (
              <>
                <button
                  type="button"
                  onClick={handleOpenStrategy}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 border-t border-white/10 transition-colors"
                >
                  <ExternalLink size={12} />
                  {t('adveser_projects_open_strategy')}
                </button>
                <button
                  type="button"
                  onClick={runImportOrUpdate}
                  disabled={importState.status === 'loading'}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 border-t border-white/10 transition-colors disabled:opacity-50"
                >
                  <Layers size={12} />
                  {importState.status === 'loading' ? t('adveser_projects_import_strategy_loading') : t('adveser_projects_update_from_launch_studio')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={runImportOrUpdate}
                disabled={importState.status === 'loading'}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200 border-t border-white/10 transition-colors disabled:opacity-50"
              >
                <Layers size={12} />
                {importState.status === 'loading' ? t('adveser_projects_import_strategy_loading') : t('adveser_projects_import_strategy')}
              </button>
            )
          )}

          {importState.status === 'done' && (
            <div className="px-3 py-2 text-[10px] text-emerald-300 border-t border-white/10 space-y-1">
              <div>
                {importState.addedCount} {t('adveser_projects_import_added')}, {importState.updatedCount} {t('adveser_projects_import_updated')}
                {importState.preservedCount > 0 ? `, ${importState.preservedCount} ${t('adveser_projects_import_preserved')}` : ''}
              </div>
              {importState.openedUrl && (
                <a href={importState.openedUrl} target="_blank" rel="noopener noreferrer" className="block text-cyan-300 underline">
                  {t('adveser_projects_popup_blocked_link')}
                </a>
              )}
            </div>
          )}
          {importState.status === 'popup-blocked' && (
            <div className="px-3 py-2 text-[10px] text-amber-400 border-t border-white/10 space-y-1">
              <div>{t('adveser_projects_popup_blocked')}</div>
              <a href={importState.openedUrl} target="_blank" rel="noopener noreferrer" className="block text-cyan-300 underline">
                {t('adveser_projects_popup_blocked_link')}
              </a>
            </div>
          )}
          {importState.status === 'no-export' && (
            <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-white/10">{t('adveser_projects_import_strategy_no_export')}</div>
          )}
          {importState.status === 'error' && (
            <div className="px-3 py-2 text-[10px] text-red-400 border-t border-white/10">{t('adveser_projects_import_strategy_error')}</div>
          )}
          {importState.status === 'unavailable' && (
            <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-white/10">{t('adveser_projects_import_strategy_unavailable')}</div>
          )}

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
