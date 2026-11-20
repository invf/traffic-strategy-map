import React, { useState, useRef, useEffect } from 'react';
import {
  Map, Zap, Globe2, BrainCircuit, RotateCcw, Settings,
  ChevronDown, Download, PlusCircle, Cloud, Palette, Check,
  FolderOpen, Plus, Pencil, Trash2, UploadCloud, Loader2, AlertCircle,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from '../i18n/useTranslation';
import { getStrategy, createStrategy, updateStrategy, deleteStrategy } from '../services/strategies';
import AccountButton from './AccountButton';

const NAV_IDS = ['map', 'traffic', 'ai'];
const NAV_ICONS = { map: Map, traffic: Globe2, ai: BrainCircuit };
const NAV_KEYS = { map: 'nav_map', traffic: 'nav_traffic', ai: 'nav_ai' };

const GOAL_KEYS = {
  traffic: 'goal_traffic',
  sales: 'goal_sales',
  signups: 'goal_signups',
  installs: 'goal_installs',
  subscribers: 'goal_subscribers',
};

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', name: 'EN' },
  { code: 'uk', flag: '🇺🇦', name: 'UA' },
  { code: 'ru', flag: '🇷🇺', name: 'RU' },
];

// ── Background presets ────────────────────────────────────────────────────────
const SOLID_COLORS = [
  { label: 'Deep Space',  value: '#070818' },
  { label: 'Navy',        value: '#0a1232' },
  { label: 'Violet',      value: '#1a0840' },
  { label: 'Forest',      value: '#081e0a' },
  { label: 'Teal',        value: '#051e1e' },
  { label: 'Plum',        value: '#20082a' },
  { label: 'Graphite',    value: '#1a1a1a' },
  { label: 'Amber',       value: '#201808' },
  { label: 'Crimson',     value: '#200808' },
  { label: 'Black',       value: '#000000' },
];

const GRADIENTS = [
  {
    label: 'Nebula',
    value: 'radial-gradient(ellipse at 25% 30%, #2d0a60 0%, #070818 55%, #0a1830 100%)',
    preview: 'linear-gradient(135deg, #4a1090 0%, #1a0840 40%, #0a1830 100%)',
  },
  {
    label: 'Aurora',
    value: 'linear-gradient(160deg, #0a3010 0%, #070818 55%, #0a1a30 100%)',
    preview: 'linear-gradient(135deg, #1a5020 0%, #081e0a 40%, #0a1a30 100%)',
  },
  {
    label: 'Ocean',
    value: 'radial-gradient(ellipse at 30% 70%, #082840 0%, #070818 55%, #200828 100%)',
    preview: 'linear-gradient(135deg, #104060 0%, #082840 40%, #200828 100%)',
  },
  {
    label: 'Sunset',
    value: 'radial-gradient(ellipse at 70% 20%, #401008 0%, #200810 55%, #0a0e20 100%)',
    preview: 'linear-gradient(135deg, #802010 0%, #401008 40%, #1a0828 100%)',
  },
  {
    label: 'Midnight',
    value: 'linear-gradient(135deg, #100828 0%, #070818 50%, #081828 100%)',
    preview: 'linear-gradient(135deg, #201050 0%, #100828 45%, #082040 100%)',
  },
  {
    label: 'Crimson',
    value: 'linear-gradient(160deg, #2a0808 0%, #070818 55%, #0a0c20 100%)',
    preview: 'linear-gradient(135deg, #601010 0%, #2a0808 40%, #0a0c28 100%)',
  },
  {
    label: 'Gold',
    value: 'radial-gradient(ellipse at 60% 40%, #302008 0%, #070818 55%, #081020 100%)',
    preview: 'linear-gradient(135deg, #604010 0%, #302008 40%, #081020 100%)',
  },
  {
    label: 'Dusk',
    value: 'linear-gradient(160deg, #200828 0%, #070818 50%, #081820 100%)',
    preview: 'linear-gradient(135deg, #401050 0%, #1a0828 40%, #0a1828 100%)',
  },
  {
    label: 'Indigo',
    value: 'radial-gradient(ellipse at 50% 50%, #10103a 0%, #070818 60%, #081a10 100%)',
    preview: 'linear-gradient(135deg, #202070 0%, #10103a 40%, #0a1e10 100%)',
  },
  {
    label: 'Rose',
    value: 'radial-gradient(ellipse at 20% 80%, #300820 0%, #070818 55%, #0a1020 100%)',
    preview: 'linear-gradient(135deg, #602040 0%, #300820 40%, #0a1030 100%)',
  },
];

// ── BgPicker panel ────────────────────────────────────────────────────────────
function Swatch({ bg, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: bg,
          border: active
            ? '2.5px solid #fff'
            : '2px solid rgba(255,255,255,0.15)',
          boxShadow: active
            ? '0 0 0 2px rgba(99,102,241,0.7), 0 4px 12px rgba(0,0,0,0.5)'
            : '0 2px 8px rgba(0,0,0,0.4)',
          position: 'relative',
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
          transform: active ? 'scale(1.08)' : 'scale(1)',
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; } }}
      >
        {active && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={14} color="#fff" strokeWidth={3} />
          </span>
        )}
      </div>
      <span style={{ fontSize: 9, color: active ? '#c4b5fd' : '#64748b', fontWeight: active ? 700 : 500, lineHeight: 1, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </button>
  );
}

function BgPicker({ canvasBg, setCanvasBg, onClose }) {
  const pick = (v) => { setCanvasBg(v); onClose(); };

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 316,
        background: '#10112a',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 18,
        boxShadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Palette size={13} color="#8b5cf6" />
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: 0 }}>
          Фон полотна
        </p>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Solid colors */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#475569', marginBottom: 10, margin: '0 0 10px' }}>
            Однотонні
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SOLID_COLORS.map((c) => (
              <Swatch
                key={c.value}
                bg={c.value}
                label={c.label}
                active={canvasBg === c.value}
                onClick={() => pick(c.value)}
              />
            ))}
          </div>
        </div>

        {/* Gradients */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#475569', marginBottom: 10, margin: '0 0 10px' }}>
            Градієнти
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {GRADIENTS.map((g) => (
              <Swatch
                key={g.label}
                bg={g.preview}
                label={g.label}
                active={canvasBg === g.value}
                onClick={() => pick(g.value)}
              />
            ))}
          </div>
        </div>

        {/* Custom color */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#475569', margin: '0 0 8px' }}>
            Свій колір (HEX)
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={canvasBg.startsWith('#') ? canvasBg : '#070818'}
              onChange={(e) => setCanvasBg(e.target.value)}
              style={{
                width: 40, height: 40, padding: 3, borderRadius: 10,
                border: '1.5px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
            <input
              type="text"
              value={canvasBg.startsWith('#') ? canvasBg : '(градієнт)'}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setCanvasBg(v);
              }}
              placeholder="#070818"
              style={{
                flex: 1, padding: '8px 12px', fontSize: 13, borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1.5px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0',
                fontFamily: 'monospace',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Project Switcher ──────────────────────────────────────────────────────────
function ProjectSwitcher() {
  const {
    projects, activeProjectId, activeProjectSource, cloudProjects,
    createProject, switchProject, deleteProject, renameProject,
    isDirty, loadStrategy, setActiveCloudProject, removeCloudProject,
    patchCloudProjectLocal, addCloudProject,
  } = useStore();
  const { isAuthenticated } = useAuth();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [cloudEditingId, setCloudEditingId] = useState(null);
  const [cloudEditName, setCloudEditName] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [cloudError, setCloudError] = useState(null);
  const ref = useRef(null);

  const active =
    activeProjectSource === 'cloud'
      ? cloudProjects.find((p) => p.id === activeProjectId)
      : projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setEditingId(null);
        setCloudEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // AUTH-004 requirement 11: a cloud project's unsaved edits only live
  // in memory (no auto-save) - confirm before navigating away from them.
  // Local Drafts never need this: switchProject/createProject already
  // snapshot the live canvas into `projects` before swapping, so nothing
  // is ever lost switching between Local Drafts.
  const confirmLeaveIfDirty = () => {
    if (activeProjectSource === 'cloud' && isDirty()) {
      return window.confirm(t('cloud_switch_unsaved_confirm'));
    }
    return true;
  };

  const commitRename = (id) => {
    if (editName.trim()) renameProject(id, editName.trim());
    setEditingId(null);
  };

  const startEdit = (p, e) => {
    e.stopPropagation();
    setEditingId(p.id);
    setEditName(p.name);
  };

  const handleSwitchLocal = (id) => {
    if (!confirmLeaveIfDirty()) return;
    switchProject(id);
    setOpen(false);
  };

  const handleSwitchCloud = async (p) => {
    if (p.id === activeProjectId && activeProjectSource === 'cloud') { setOpen(false); return; }
    if (!confirmLeaveIfDirty()) return;
    setCloudError(null);
    setBusyId(p.id);
    try {
      const full = await getStrategy(p.id);
      loadStrategy(full);
      setOpen(false);
    } catch (e) {
      setCloudError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const startCloudEdit = (p, e) => {
    e.stopPropagation();
    setCloudEditingId(p.id);
    setCloudEditName(p.name);
  };

  const commitCloudRename = async (p) => {
    const name = cloudEditName.trim();
    setCloudEditingId(null);
    if (!name || name === p.name) return;
    setCloudError(null);
    try {
      await updateStrategy(p.id, { name });
      patchCloudProjectLocal(p.id, { name });
    } catch (e) {
      setCloudError(e.message);
    }
  };

  const handleDeleteCloud = async (p, e) => {
    e.stopPropagation();
    if (!window.confirm(t('cloud_delete_confirm'))) return;
    setCloudError(null);
    setBusyId(p.id);
    try {
      await deleteStrategy(p.id);
      removeCloudProject(p.id);
    } catch (e2) {
      setCloudError(e2.message);
    } finally {
      setBusyId(null);
    }
  };

  // AUTH-004 requirement 14: "Import Local Project into Account" - reads
  // the DRAFT's own stored canvas (or, if it's the currently active
  // Local Draft, the live canvas, which is freshest), never the local
  // draft itself (never mutated/deleted - requirement 13). On a cloud
  // name collision, prompts for a different name before proceeding;
  // cancelling the prompt aborts with no API call at all.
  const handleImportLocal = async (draft, e) => {
    e.stopPropagation();
    const live = useStore.getState();
    const isActiveDraft = activeProjectSource === 'local' && activeProjectId === draft.id;
    const source = isActiveDraft
      ? { nodes: live.nodes, edges: live.edges, productInfo: live.productInfo, aiSuggestions: live.aiSuggestions }
      : { nodes: draft.nodes, edges: draft.edges, productInfo: draft.productInfo, aiSuggestions: draft.aiSuggestions };

    let name = draft.name;
    if (cloudProjects.some((p) => p.name === name)) {
      const chosen = window.prompt(t('cloud_import_name_conflict'), `${name} (2)`);
      if (!chosen || !chosen.trim()) return;
      name = chosen.trim();
    }

    setCloudError(null);
    setBusyId(`import-${draft.id}`);
    try {
      const created = await createStrategy({ name, ...source });
      addCloudProject(created);
    } catch (err) {
      setCloudError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors max-w-[160px] ${
          open
            ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300'
            : 'bg-white/[0.04] border-white/[0.07] text-slate-100 hover:border-indigo-500/30 hover:text-white'
        }`}
      >
        {activeProjectSource === 'cloud' ? (
          <Cloud size={12} className="text-indigo-400 flex-shrink-0" />
        ) : (
          <FolderOpen size={12} className="text-indigo-400 flex-shrink-0" />
        )}
        <span className="truncate">{active?.name || 'Проект'}</span>
        <ChevronDown size={10} className="text-slate-300 flex-shrink-0 ml-0.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] w-72 bg-[#111228] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          {cloudError && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border-b border-red-500/20">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300 flex-1">{cloudError}</p>
            </div>
          )}

          {/* Cloud Projects section - only when authenticated */}
          {isAuthenticated && (
            <>
              <div className="px-3 py-2 border-b border-white/[0.07] flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('cloud_section_cloud')}</span>
              </div>
              <div className="max-h-48 overflow-y-auto py-1 border-b border-white/[0.07]">
                {cloudProjects.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-slate-600">{t('cloud_no_strategies')}</p>
                ) : (
                  cloudProjects.map((p) => {
                    const isActiveCloud = activeProjectSource === 'cloud' && p.id === activeProjectId;
                    return (
                      <div
                        key={p.id}
                        onClick={() => { if (cloudEditingId !== p.id && busyId !== p.id) handleSwitchCloud(p); }}
                        className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                          isActiveCloud ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {busyId === p.id ? (
                          <Loader2 size={11} className="animate-spin text-indigo-400 flex-shrink-0" />
                        ) : (
                          <Cloud size={11} className="text-indigo-400/70 flex-shrink-0" />
                        )}
                        {cloudEditingId === p.id ? (
                          <input
                            autoFocus
                            value={cloudEditName}
                            onChange={(e) => setCloudEditName(e.target.value)}
                            onBlur={() => commitCloudRename(p)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitCloudRename(p);
                              if (e.key === 'Escape') setCloudEditingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 bg-white/10 text-white text-[12px] px-2 py-0.5 rounded border border-indigo-500/50 outline-none min-w-0"
                          />
                        ) : (
                          <span className="flex-1 text-[12px] font-medium truncate">{p.name}</span>
                        )}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={(e) => startCloudEdit(p, e)} className="p-0.5 rounded text-slate-500 hover:text-slate-200 transition-colors" title={t('cloud_rename_btn')}>
                            <Pencil size={10} />
                          </button>
                          <button onClick={(e) => handleDeleteCloud(p, e)} className="p-0.5 rounded text-slate-500 hover:text-red-400 transition-colors" title={t('cloud_delete_btn')}>
                            <Trash2 size={10} />
                          </button>
                        </div>
                        {isActiveCloud && cloudEditingId !== p.id && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Local Drafts section */}
          <div className="px-3 py-2 border-b border-white/[0.07] flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('cloud_section_local')}</span>
            <button
              onClick={() => { if (confirmLeaveIfDirty()) { createProject(); setOpen(false); } }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold transition-colors"
            >
              <Plus size={10} />
              Новий
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {projects.map((p) => {
              const isActiveLocal = activeProjectSource === 'local' && p.id === activeProjectId;
              return (
                <div
                  key={p.id}
                  onClick={() => { if (editingId !== p.id) handleSwitchLocal(p.id); }}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isActiveLocal ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {editingId === p.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => commitRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-white/10 text-white text-[12px] px-2 py-0.5 rounded border border-indigo-500/50 outline-none min-w-0"
                    />
                  ) : (
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-medium truncate">{p.name}</span>
                      {isAuthenticated && (
                        <span className="block text-[9px] text-slate-600 uppercase tracking-wide">{t('cloud_local_draft_badge')}</span>
                      )}
                    </span>
                  )}

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {isAuthenticated && (
                      <button
                        onClick={(e) => handleImportLocal(p, e)}
                        disabled={busyId === `import-${p.id}`}
                        className="p-0.5 rounded text-slate-500 hover:text-indigo-300 transition-colors disabled:opacity-40"
                        title={t('cloud_import_btn')}
                      >
                        {busyId === `import-${p.id}` ? <Loader2 size={10} className="animate-spin" /> : <UploadCloud size={10} />}
                      </button>
                    )}
                    <button
                      onClick={(e) => startEdit(p, e)}
                      className="p-0.5 rounded text-slate-500 hover:text-slate-200 transition-colors"
                      title="Перейменувати"
                    >
                      <Pencil size={10} />
                    </button>
                    {projects.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                        className="p-0.5 rounded text-slate-500 hover:text-red-400 transition-colors"
                        title="Видалити"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>

                  {isActiveLocal && editingId !== p.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main TopBar ───────────────────────────────────────────────────────────────
export default function TopBar() {
  const {
    activeView, setActiveView,
    productInfo,
    setShowSetup, resetMap,
    isGenerating,
    nodes, edges,
    language, setLanguage,
    setShowStrategies,
    canvasBg, setCanvasBg,
  } = useStore();

  const t = useTranslation();
  const [showReset, setShowReset] = useState(false);
  const [showLang, setShowLang] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const bgPickerRef = useRef(null);

  const nodeCount = nodes.length;
  const doneCount = nodes.filter((n) => n.data?.status === 'done').length;
  const progress = nodeCount > 0 ? Math.round((doneCount / nodeCount) * 100) : 0;

  // Close bg picker on outside click
  useEffect(() => {
    if (!showBgPicker) return;
    const handler = (e) => {
      if (bgPickerRef.current && !bgPickerRef.current.contains(e.target)) {
        setShowBgPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBgPicker]);

  const handleExport = () => {
    const data = { nodes, edges, productInfo, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traffic-strategy-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentLang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  // Swatch preview of current bg
  const bgIsGradient = canvasBg.includes('gradient');

  return (
    <header className="h-14 flex-shrink-0 flex items-center px-4 gap-3 bg-[#0a0b1e] border-b border-white/[0.06] z-10">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mr-2 flex-shrink-0">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Map size={16} className="text-white" />
        </div>
        <div className="hidden sm:block">
          <p className="text-[13px] font-bold text-white leading-none">Traffic Strategy</p>
          <p className="text-[10px] text-slate-500 leading-none mt-0.5">Map</p>
        </div>
      </div>

      {/* Project switcher */}
      <ProjectSwitcher />

      {/* Nav tabs */}
      <nav className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-1 border border-white/[0.05]">
        {NAV_IDS.map((id) => {
          const Icon = NAV_ICONS[id];
          return (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 ${
                activeView === id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'text-slate-200 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={12} />
              <span className="hidden md:inline">{t(NAV_KEYS[id])}</span>
            </button>
          );
        })}
      </nav>

      {/* Product pill */}
      {productInfo.name && (
        <button
          onClick={() => setShowSetup(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] hover:border-indigo-500/30 transition-colors group"
        >
          <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
          <span className="text-[12px] font-medium text-white group-hover:text-white transition-colors max-w-[120px] truncate">
            {productInfo.name}
          </span>
          <span className="text-[10px] text-slate-400 hidden lg:inline">
            · {t(GOAL_KEYS[productInfo.goal] || 'goal_traffic')}
          </span>
          <ChevronDown size={10} className="text-slate-400 group-hover:text-slate-200 transition-colors" />
        </button>
      )}

      {/* Progress bar */}
      {nodeCount > 0 && (
        <div className="hidden lg:flex items-center gap-2 ml-1" title={`Виконано блоків: ${doneCount} з ${nodeCount}`}>
          <span className="text-[10px] text-slate-400">Виконано</span>
          <div className="w-24 h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-300">{doneCount}/{nodeCount}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSetup(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold transition-colors shadow-md shadow-indigo-500/20"
        >
          {isGenerating ? (
            <>
              <Zap size={12} className="animate-pulse" />
              <span className="hidden sm:inline">{t('generating')}</span>
            </>
          ) : (
            <>
              <PlusCircle size={12} />
              <span className="hidden sm:inline">{productInfo.name ? t('edit_product') : t('setup_product')}</span>
            </>
          )}
        </button>

        <button
          onClick={handleExport}
          className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          title={t('export_json')}
        >
          <Download size={15} />
        </button>

        {/* Cloud save/load */}
        <button
          onClick={() => setShowStrategies(true)}
          className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
          title={t('cloud_btn_title')}
        >
          <Cloud size={15} />
        </button>

        {/* ADVESER Account sign-in/out (AUTH-003B) */}
        <AccountButton />

        {/* Background picker — only on map view */}
        {activeView === 'map' && (
          <div className="relative" ref={bgPickerRef}>
            <button
              onClick={() => { setShowBgPicker((v) => !v); setShowReset(false); setShowLang(false); }}
              className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                showBgPicker
                  ? 'text-violet-400 bg-violet-500/15'
                  : 'text-slate-500 hover:text-violet-400 hover:bg-violet-500/10'
              }`}
              title="Фон полотна"
            >
              {/* Small swatch preview */}
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: bgIsGradient ? canvasBg : canvasBg,
                  border: '1.5px solid rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
              <Palette size={14} />
            </button>

            {showBgPicker && (
              <BgPicker
                canvasBg={canvasBg}
                setCanvasBg={setCanvasBg}
                onClose={() => setShowBgPicker(false)}
              />
            )}
          </div>
        )}

        {/* Language switcher */}
        <div className="relative">
          <button
            onClick={() => { setShowLang((v) => !v); setShowReset(false); setShowBgPicker(false); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-200 hover:text-white hover:bg-white/5 transition-colors text-[11px] font-semibold"
            title={t('language')}
          >
            <span className="text-[14px] leading-none">{currentLang.flag}</span>
            <span className="hidden sm:inline ml-0.5">{currentLang.name}</span>
            <ChevronDown size={10} className="text-slate-400" />
          </button>
          {showLang && (
            <div className="absolute right-0 top-9 w-36 bg-[#111228] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { setLanguage(lang.code); setShowLang(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] transition-colors ${
                    language === lang.code
                      ? 'bg-indigo-600/20 text-indigo-300 font-semibold'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="text-[15px]">{lang.flag}</span>
                  <span>{lang.name}</span>
                  {language === lang.code && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="relative">
          <button
            onClick={() => { setShowReset((v) => !v); setShowLang(false); setShowBgPicker(false); }}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Settings size={15} />
          </button>
          {showReset && (
            <div className="absolute right-0 top-8 w-52 bg-[#111228] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
              <button
                onClick={() => { resetMap(); setShowReset(false); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <RotateCcw size={12} />
                {t('reset_map')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
