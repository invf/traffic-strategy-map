import React, { useState, useEffect, useRef } from 'react';
import {
  X, Cloud, Save, FolderOpen, Trash2, RefreshCw,
  Check, AlertCircle, Loader2, Map, LogIn, UploadCloud,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { buildSignInUrl } from '../services/auth';
import {
  listStrategies, getStrategy, createStrategy, updateStrategy, deleteStrategy,
  StrategiesApiError, errorKeyForStatus,
} from '../services/strategies';
import { resolveUniqueCloudName } from '../lib/cloudProjectNaming';
import { useTranslation } from '../i18n/useTranslation';

// AUTH-003B - every call in this file goes through services/strategies.js
// (the authenticated backend proxy), not supabase-js directly anymore -
// public.strategies is RLS-protected and the browser never holds the
// real Supabase access token needed to satisfy auth.uid(); the backend
// relays these requests using the signed-in user's own cached token.
function errorMessage(err, t) {
  if (err instanceof StrategiesApiError) {
    const key = errorKeyForStatus(err.status);
    if (key) return t(key);
  }
  return err.message;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('uk-UA', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ── Signed Out Prompt ──────────────────────────────────────────────────────────
function SignedOut({ t }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
        <LogIn size={28} className="text-indigo-400" />
      </div>
      <h3 className="text-[15px] font-bold text-white mb-2">{t('cloud_signed_out_title')}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed mb-5 max-w-xs">
        {t('cloud_signed_out_hint')}
      </p>
      <a
        href={buildSignInUrl()}
        className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors shadow-lg shadow-indigo-500/20"
      >
        <LogIn size={14} />
        {t('cloud_sign_in_btn')}
      </a>
    </div>
  );
}

// ── Save Tab ──────────────────────────────────────────────────────────────────
function SaveTab({ t }) {
  const {
    nodes, edges, productInfo, aiSuggestions, cloudProjects,
    activeProjectId, activeProjectSource, activeCloudUpdatedAt,
    setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
  } = useStore();
  const hasActiveCloudProject = activeProjectSource === 'cloud' && !!activeProjectId;
  const [name, setName] = useState(productInfo.name ? `${productInfo.name} — Strategy` : '');
  const [saving, setSaving] = useState(null); // null | 'update' | 'create'
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  // AUTH-004 requirement 12: set only on a 409 from updateStrategy -
  // the server's current row (camelCased), so the user can choose
  // instead of either side's edit being silently lost.
  const [conflict, setConflict] = useState(null);

  // AUTH-004B requirement 8: a synchronous ref, checked and set as the
  // very FIRST thing each handler does - immune to React's render-batch
  // timing, unlike relying on the `saving` state/the button's `disabled`
  // attribute alone (both only take effect on the NEXT render, which a
  // fast double-click or double-tap can beat). This is what actually
  // guarantees a second overlapping click cannot fire a second POST/PATCH
  // while one is already in flight.
  const inFlightRef = useRef(false);

  const handleCreate = async () => {
    if (inFlightRef.current || !name.trim()) return;
    inFlightRef.current = true;
    setSaving('create');
    setError(null);
    setConflict(null);
    setSaved(false);
    try {
      // AUTH-004B requirements 4/5: check the user's OWN existing cloud
      // project names before creating a new one - covers both the
      // first-ever cloud save of a Local Draft (an Import, see this
      // button's own label below) and "Save as New" from an already-
      // cloud-backed project. A match only ever prompts for a different
      // name or aborts - it NEVER redirects into updating the existing,
      // differently-owned-by-nothing-in-particular same-named row.
      const resolvedName = resolveUniqueCloudName(name, cloudProjects, { t });
      if (!resolvedName) return;
      if (resolvedName !== name) setName(resolvedName);

      const created = await createStrategy({ name: resolvedName, nodes, edges, productInfo, aiSuggestions });
      addCloudProject(created);
      // AUTH-004B requirement 7: the newly created cloud strategy becomes
      // the active project immediately - every subsequent Save (not Save
      // as New) now PATCHes this same UUID, never creates another one.
      setActiveCloudProject(created.id, created.updatedAt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSaving(null);
      inFlightRef.current = false;
    }
  };

  const handleUpdate = async (overwrite = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaving('update');
    setError(null);
    setConflict(null);
    setSaved(false);
    try {
      const updated = await updateStrategy(activeProjectId, {
        name: name.trim() || undefined,
        nodes, edges, productInfo, aiSuggestions,
        expectedUpdatedAt: overwrite ? undefined : activeCloudUpdatedAt,
      });
      patchCloudProjectLocal(updated.id, { name: updated.name, updatedAt: updated.updatedAt });
      setActiveCloudProject(updated.id, updated.updatedAt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      if (e instanceof StrategiesApiError && e.status === 409 && e.data?.current) {
        setConflict(e.data.current);
      } else {
        setError(errorMessage(e, t));
      }
    } finally {
      setSaving(null);
      inFlightRef.current = false;
    }
  };

  const handleReloadLatest = () => {
    if (!conflict) return;
    loadStrategy(conflict);
    setConflict(null);
  };

  return (
    <div className="p-6">
      <p className="text-[12px] text-slate-500 leading-relaxed mb-5">
        Saves the current canvas ({nodes.length} {t('cloud_nodes')}), product info, and AI suggestions.
      </p>

      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {t('cloud_name_label')}
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('cloud_name_placeholder')}
        onKeyDown={(e) => { if (e.key === 'Enter') (hasActiveCloudProject ? handleUpdate() : handleCreate()); }}
        className="w-full px-4 py-3 text-[13px] rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none mb-4 transition-colors"
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-300">{error}</p>
        </div>
      )}

      {conflict && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-4">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-semibold text-amber-300">{t('cloud_conflict_title')}</p>
              <p className="text-[11px] text-amber-200/80 mt-0.5">{t('cloud_conflict_hint')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReloadLatest}
              className="flex-1 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-amber-100 text-[11px] font-semibold transition-colors"
            >
              {t('cloud_conflict_reload_btn')}
            </button>
            <button
              onClick={() => handleUpdate(true)}
              className="flex-1 py-2 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors"
            >
              {t('cloud_conflict_overwrite_btn')}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {hasActiveCloudProject && (
          <button
            onClick={() => handleUpdate(false)}
            disabled={!!saving}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-colors shadow-lg shadow-indigo-500/20"
          >
            {saving === 'update' ? (
              <><Loader2 size={14} className="animate-spin" /> {t('cloud_saving')}</>
            ) : saved ? (
              <><Check size={14} className="text-green-300" /> {t('cloud_saved')}</>
            ) : (
              <><Cloud size={14} /> {t('cloud_save_update_btn')}</>
            )}
          </button>
        )}
        <button
          onClick={handleCreate}
          disabled={!!saving || !name.trim()}
          className={`flex items-center justify-center gap-2 py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-[13px] font-semibold transition-colors ${
            hasActiveCloudProject
              ? 'flex-1 bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08]'
              : 'flex-1 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
          }`}
        >
          {saving === 'create' ? (
            <><Loader2 size={14} className="animate-spin" /> {t('cloud_saving')}</>
          ) : hasActiveCloudProject ? (
            <><Cloud size={14} /> {t('cloud_save_new_btn')}</>
          ) : (
            // AUTH-004B requirement 6: the first cloud save of whatever
            // is on the canvas right now (a Local Draft, by construction -
            // activeProjectSource is 'cloud' only when hasActiveCloudProject
            // is true) is an Import, not a generic "save" - same wording,
            // same duplicate-name check, as the switcher's per-draft
            // Import action in TopBar.jsx.
            <><UploadCloud size={14} /> {t('cloud_import_btn')}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Load Tab ──────────────────────────────────────────────────────────────────
function LoadTab({ t, onClose }) {
  const { loadStrategy } = useStore();
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [loadedId, setLoadedId] = useState(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listStrategies();
      setStrategies(data || []);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const handleLoad = async (id) => {
    try {
      const data = await getStrategy(id);
      // AUTH-004: loadStrategy now sets the active project identity
      // atomically with the canvas (fixes the ticket's bug #5) - `data`
      // already carries `id`/`updatedAt` (services/strategies.js
      // camelCases the backend's response), so no extra mapping needed.
      loadStrategy(data);
      setLoadedId(id);
      setTimeout(() => { onClose(); }, 700);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('cloud_delete_confirm'))) return;
    setDeletingId(id);
    try {
      await deleteStrategy(id);
      setStrategies((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-white/[0.05] flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {loading ? '…' : `${strategies.length}`} {strategies.length !== 1 ? t('cloud_nodes') : ''}
        </span>
        <button
          onClick={fetch}
          disabled={loading}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {t('cloud_refresh')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
            <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-red-300">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : strategies.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={36} className="text-slate-700 mx-auto mb-3" />
            <p className="text-[13px] font-semibold text-slate-500 mb-1">{t('cloud_no_strategies')}</p>
            <p className="text-[11px] text-slate-600">{t('cloud_no_strategies_hint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {strategies.map((s) => (
              <div
                key={s.id}
                className={`group p-4 rounded-2xl border transition-all duration-200 ${
                  loadedId === s.id
                    ? 'border-green-500/40 bg-green-500/8'
                    : 'border-white/[0.07] bg-white/[0.02] hover:border-indigo-500/30 hover:bg-indigo-500/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {loadedId === s.id
                      ? <Check size={15} className="text-green-400" />
                      : <Map size={15} className="text-indigo-400" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-white leading-snug truncate">{s.name}</p>
                    {s.productInfo?.name && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {s.productInfo.name}
                        {s.productInfo.goal && (
                          <span className="text-slate-600"> · {s.productInfo.goal}</span>
                        )}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">
                      {t('cloud_updated')}: {formatDate(s.updatedAt)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                      title={t('cloud_delete_btn')}
                    >
                      {deletingId === s.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Trash2 size={13} />
                      }
                    </button>
                  </div>
                </div>

                {/* Load button */}
                <button
                  onClick={() => handleLoad(s.id)}
                  disabled={loadedId === s.id}
                  className={`mt-3 w-full py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    loadedId === s.id
                      ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                      : 'bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/20'
                  }`}
                >
                  {loadedId === s.id ? t('cloud_loaded') : t('cloud_load_btn')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function StrategiesModal() {
  const { setShowStrategies } = useStore();
  const t = useTranslation();
  const [tab, setTab] = useState('save');
  const { isAuthenticated, isLoading } = useAuth();

  const onClose = () => setShowStrategies(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[#0d0e24] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-indigo-600/10 to-violet-600/10 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Cloud size={16} className="text-white" />
          </div>
          <h2 className="text-[15px] font-bold text-white flex-1">{t('cloud_title')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : !isAuthenticated ? (
          <SignedOut t={t} />
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-white/[0.05] flex-shrink-0">
              {[
                { id: 'save', labelKey: 'cloud_tab_save', Icon: Save },
                { id: 'load', labelKey: 'cloud_tab_load', Icon: FolderOpen },
              ].map(({ id, labelKey, Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-[12px] font-semibold transition-colors ${
                    tab === id
                      ? 'text-indigo-400 border-b-2 border-indigo-400 bg-indigo-500/5'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon size={13} />
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {tab === 'save' && <SaveTab t={t} />}
              {tab === 'load' && <LoadTab t={t} onClose={onClose} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
