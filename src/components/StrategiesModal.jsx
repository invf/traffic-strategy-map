import React, { useState, useEffect } from 'react';
import {
  X, Cloud, Save, FolderOpen, Trash2, RefreshCw,
  Check, AlertCircle, Loader2, Database, Map,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useTranslation } from '../i18n/useTranslation';

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('uk-UA', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ── Not Configured Banner ─────────────────────────────────────────────────────
function NotConfigured({ t }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
        <Database size={28} className="text-amber-400" />
      </div>
      <h3 className="text-[15px] font-bold text-white mb-2">{t('cloud_not_configured')}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed mb-5 max-w-xs">
        {t('cloud_not_configured_hint')}
      </p>
      <div className="w-full bg-[#070818] border border-white/10 rounded-xl p-4 text-left">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">.env</p>
        <pre className="text-[11px] text-green-400 leading-relaxed font-mono whitespace-pre-wrap">
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
        </pre>
      </div>
    </div>
  );
}

// ── Save Tab ──────────────────────────────────────────────────────────────────
function SaveTab({ t }) {
  const { nodes, edges, productInfo, aiSuggestions } = useStore();
  const [name, setName] = useState(productInfo.name ? `${productInfo.name} — Strategy` : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error: err } = await supabase.from('strategies').insert({
        name: name.trim(),
        nodes,
        edges,
        product_info: productInfo,
        ai_suggestions: aiSuggestions,
        updated_at: new Date().toISOString(),
      });
      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        className="w-full px-4 py-3 text-[13px] rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none mb-4 transition-colors"
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-300">{error}</p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !name.trim()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-colors shadow-lg shadow-indigo-500/20"
      >
        {saving ? (
          <><Loader2 size={14} className="animate-spin" /> {t('cloud_saving')}</>
        ) : saved ? (
          <><Check size={14} className="text-green-300" /> {t('cloud_saved')}</>
        ) : (
          <><Cloud size={14} /> {t('cloud_save_btn')}</>
        )}
      </button>
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
      const { data, error: err } = await supabase
        .from('strategies')
        .select('id, name, product_info, nodes, updated_at')
        .order('updated_at', { ascending: false });
      if (err) throw err;
      setStrategies(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const handleLoad = async (id) => {
    try {
      const { data, error: err } = await supabase
        .from('strategies')
        .select('*')
        .eq('id', id)
        .single();
      if (err) throw err;
      loadStrategy({
        nodes: data.nodes,
        edges: data.edges,
        productInfo: data.product_info,
        aiSuggestions: data.ai_suggestions,
      });
      setLoadedId(id);
      setTimeout(() => { onClose(); }, 700);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('cloud_delete_confirm'))) return;
    setDeletingId(id);
    try {
      const { error: err } = await supabase.from('strategies').delete().eq('id', id);
      if (err) throw err;
      setStrategies((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e.message);
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
                    {s.product_info?.name && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {s.product_info.name}
                        {s.product_info.goal && (
                          <span className="text-slate-600"> · {s.product_info.goal}</span>
                        )}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">
                      {t('cloud_updated')}: {formatDate(s.updated_at)}
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

        {!isSupabaseConfigured ? (
          <NotConfigured t={t} />
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
