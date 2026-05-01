import React, { useState, useMemo } from 'react';
import {
  Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2,
  ArrowRightCircle, GripVertical, ChevronDown, ChevronUp,
  MousePointer2, Move, Link2, LayoutGrid, Globe2, Search,
} from 'lucide-react';
import { NODE_TYPES_CONFIG } from '../data/mockData';
import { MOCK_TRAFFIC_SOURCES } from '../data/mockData';
import { EDGE_STYLES } from './CustomEdge';
import { useTranslation } from '../i18n/useTranslation';

const ICON_MAP = {
  Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2, ArrowRightCircle,
};

const EDGE_LABEL_KEYS = {
  sequence:   'edge_sequence',
  flow:       'edge_flow',
  dependency: 'edge_dependency',
  triggers:   'edge_triggers',
  weak:       'edge_weak',
};

const EDGE_HINT_KEYS = {
  sequence:   'edge_sequence_hint',
  flow:       'edge_flow_hint',
  dependency: 'edge_dependency_hint',
  triggers:   'edge_triggers_hint',
  weak:       'edge_weak_hint',
};

function hexToRgba(hex, alpha) {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch { return `rgba(99,102,241,${alpha})`; }
}

// ── Draggable node palette item ───────────────────────────────────────────────
function NodePaletteItem({ nodeType, config, t }) {
  const Icon = ICON_MAP[config.icon] || Zap;
  const label = t(`type_${nodeType}`) !== `type_${nodeType}` ? t(`type_${nodeType}`) : config.label;
  const desc  = t(`type_${nodeType}_desc`) !== `type_${nodeType}_desc` ? t(`type_${nodeType}_desc`) : config.description;

  const onDragStart = (e) => {
    e.dataTransfer.setData('application/tsm-nodetype', nodeType);
    e.dataTransfer.setData('application/tsm-label', label);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        background: hexToRgba(config.color, 0.10),
        borderColor: hexToRgba(config.color, 0.30),
      }}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-grab active:cursor-grabbing hover:scale-[1.02] transition-all duration-150 select-none"
      title={desc}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: hexToRgba(config.color, 0.22) }}
      >
        <Icon size={14} style={{ color: config.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider leading-none mb-0.5" style={{ color: config.color }}>
          {label}
        </p>
        <p className="text-[10px] text-slate-500 leading-snug truncate">{desc}</p>
      </div>
      <GripVertical size={12} className="text-slate-600 flex-shrink-0 group-hover:text-slate-400 transition-colors" />
    </div>
  );
}

// ── Draggable traffic source item ─────────────────────────────────────────────
function TrafficSourceItem({ source }) {
  const onDragStart = (e) => {
    e.dataTransfer.setData('application/tsm-traffic-source', JSON.stringify(source));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-grab active:cursor-grabbing hover:scale-[1.02] transition-all duration-150 select-none"
      style={{
        background: hexToRgba(source.color, 0.10),
        borderColor: hexToRgba(source.color, 0.28),
      }}
      title={source.recommendedAction}
    >
      <span className="text-[18px] leading-none flex-shrink-0">{source.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-white truncate leading-tight">{source.platform}</p>
        <p className="text-[9px] truncate" style={{ color: hexToRgba(source.color, 0.85) }}>{source.category}</p>
      </div>
      <GripVertical size={11} className="text-slate-600 flex-shrink-0 group-hover:text-slate-400 transition-colors" />
    </div>
  );
}

// ── Connection guide ─────────────────────────────────────────────────────────
function ConnectionGuide({ t }) {
  const [open, setOpen] = useState(true);

  const steps = [
    { Icon: MousePointer2, color: 'text-slate-400', titleKey: 'guide_step1_title', bodyKey: 'guide_step1_body' },
    { Icon: Move, color: 'text-indigo-400', titleKey: 'guide_step2_title', bodyKey: 'guide_step2_body' },
    { Icon: Link2, color: 'text-green-400', titleKey: 'guide_step3_title', bodyKey: 'guide_step3_body' },
  ];

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-indigo-500/8 hover:bg-indigo-500/12 transition-colors"
      >
        <Link2 size={12} className="text-indigo-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex-1 text-left">{t('guide_title')}</span>
        {open ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
      </button>
      {open && (
        <div className="px-3 py-3 space-y-2.5 bg-indigo-500/4">
          {steps.map(({ Icon, color, titleKey, bodyKey }, i) => (
            <div key={i} className="flex gap-2.5">
              <div className="flex-shrink-0 flex flex-col items-center pt-0.5">
                <div className="w-5 h-5 rounded-lg bg-white/5 flex items-center justify-center">
                  <Icon size={11} className={color} />
                </div>
                {i < 2 && <div className="w-px flex-1 bg-white/5 mt-1" />}
              </div>
              <div className="pb-2.5">
                <p className="text-[11px] font-semibold text-slate-300 leading-none mb-0.5">{t(titleKey)}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">{t(bodyKey)}</p>
              </div>
            </div>
          ))}
          <div className="mt-2 p-2.5 rounded-xl bg-[#070818] border border-white/5">
            <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">{t('guide_diagram_label')}</p>
            <div className="flex flex-col items-center gap-1">
              <div className="w-28 py-1.5 rounded-lg border text-center text-[10px] font-semibold text-indigo-300"
                style={{ borderColor: 'rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.1)' }}>
                {t('guide_source_block')}
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: '#6366f1', borderColor: '#070818' }} />
                <span className="text-[8px] text-slate-600">{t('guide_drag_from')}</span>
                <div className="w-px h-4 bg-indigo-500/30" />
                <span className="text-[8px] text-slate-600">{t('guide_drop_to')}</span>
                <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: '#22c55e', borderColor: '#070818' }} />
              </div>
              <div className="w-28 py-1.5 rounded-lg border text-center text-[10px] font-semibold text-green-300"
                style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.1)' }}>
                {t('guide_target_block')}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 pt-1">{t('guide_tip')}</p>
        </div>
      )}
    </div>
  );
}

// ── Arrow style legend ────────────────────────────────────────────────────────
function EdgeLegend({ t }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-[14px]">→</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex-1 text-left">{t('arrow_types')}</span>
        {open ? <ChevronUp size={11} className="text-slate-600" /> : <ChevronDown size={11} className="text-slate-600" />}
      </button>
      {open && (
        <div className="px-3 py-3 space-y-2 bg-white/[0.01]">
          {Object.entries(EDGE_STYLES).map(([key, s]) => (
            <div key={key} className="flex items-center gap-3">
              <div className="w-10 flex-shrink-0 flex items-center justify-center">
                <svg width="36" height="16" viewBox="0 0 36 16">
                  <defs>
                    <marker id={`leg-${key}`} markerWidth="6" markerHeight="6" refX="5" refY="2" orient="auto">
                      <path d="M0,0 L0,4 L6,2 z" fill={s.color} />
                    </marker>
                  </defs>
                  <line x1="2" y1="8" x2="28" y2="8"
                    stroke={s.color} strokeWidth={s.strokeWidth}
                    strokeDasharray={s.strokeDasharray ?? undefined}
                    markerEnd={`url(#leg-${key})`} opacity="0.85"
                  />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-semibold leading-none mb-0.5" style={{ color: s.color }}>
                  {t(EDGE_LABEL_KEYS[key]) || s.label}
                  {s.animated && <span className="text-[9px] text-slate-600 ml-1">animated</span>}
                </p>
                <p className="text-[9px] text-slate-600">{t(EDGE_HINT_KEYS[key]) || s.hint}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Traffic Sources panel ─────────────────────────────────────────────────────
function TrafficPanel() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return MOCK_TRAFFIC_SOURCES;
    const q = query.toLowerCase();
    return MOCK_TRAFFIC_SOURCES.filter(
      (s) =>
        s.platform.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.tags || []).some((tag) => tag.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels…"
            className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg bg-white/[0.04] border border-white/[0.07] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/40"
          />
        </div>
      </div>

      {/* Hint */}
      <div className="px-3 pb-2 flex-shrink-0">
        <p className="text-[9px] text-slate-600 leading-relaxed">
          Drag any channel onto the map to add it as a block
        </p>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5">
        {filtered.map((source) => (
          <TrafficSourceItem key={source.id} source={source} />
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-slate-600 text-center py-6">No results</p>
        )}
      </div>
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────
export default function LeftSidebar() {
  const t = useTranslation();
  const [tab, setTab] = useState('blocks');

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-[#0d0e24] border-r border-white/[0.06] overflow-hidden">

      {/* Tab switcher */}
      <div className="flex flex-shrink-0 border-b border-white/[0.06]">
        <button
          onClick={() => setTab('blocks')}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
            tab === 'blocks'
              ? 'text-indigo-400 bg-indigo-500/8 border-b-2 border-indigo-500'
              : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.02]'
          }`}
        >
          <LayoutGrid size={11} />
          Blocks
        </button>
        <button
          onClick={() => setTab('traffic')}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
            tab === 'traffic'
              ? 'text-cyan-400 bg-cyan-500/8 border-b-2 border-cyan-500'
              : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.02]'
          }`}
        >
          <Globe2 size={11} />
          Traffic
        </button>
      </div>

      {/* Blocks tab */}
      {tab === 'blocks' && (
        <div className="flex flex-col overflow-y-auto">
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.05] flex-shrink-0">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
              {t('sidebar_block_types')}
            </h2>
            <p className="text-[10px] text-slate-600">{t('sidebar_drag_hint')}</p>
          </div>
          <div className="px-3 py-3 flex flex-col gap-2 border-b border-white/[0.05]">
            {Object.entries(NODE_TYPES_CONFIG).map(([type, config]) => (
              <NodePaletteItem key={type} nodeType={type} config={config} t={t} />
            ))}
          </div>
          <div className="px-3 py-3 flex flex-col gap-3">
            <ConnectionGuide t={t} />
            <EdgeLegend t={t} />
          </div>
        </div>
      )}

      {/* Traffic tab */}
      {tab === 'traffic' && <TrafficPanel />}
    </aside>
  );
}
