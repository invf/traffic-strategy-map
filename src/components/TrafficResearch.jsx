import React, { useState, useMemo } from 'react';
import {
  Search, Globe2, ExternalLink, Zap,
  AlertCircle, ChevronDown, ChevronUp, Filter,
  Plus, X, Trash2, Check,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { MOCK_TRAFFIC_SOURCES } from '../data/mockData';
import { useTranslation } from '../i18n/useTranslation';

const CATEGORIES = ['all', 'Paid Search', 'Paid Social', 'Video', 'Community', 'Organic Search',
  'Launch Platform', 'Social Media', 'Professional Network', 'Short Video',
  'Founder Community', 'Deal Marketplace', 'App Marketplace', 'Tech Community',
  'Email / Sponsorship', 'Research Tool', 'Comparison Directory', 'Custom'];

const DIFFICULTY_OPTIONS = ['Low', 'Low–Medium', 'Medium', 'High', 'Very High'];
const POTENTIAL_OPTIONS  = ['Low', 'Medium', 'High', 'Very High'];

const DIFFICULTY_COLOR = {
  'Low': 'text-green-400',
  'Low–Medium': 'text-lime-400',
  'Medium': 'text-yellow-400',
  'High': 'text-orange-400',
  'Very High': 'text-red-400',
};

const POTENTIAL_COLOR = {
  'Low': 'text-slate-400',
  'Medium': 'text-blue-400',
  'High': 'text-indigo-400',
  'Very High': 'text-violet-400',
  'High (as research)': 'text-indigo-400',
};

const TAG_COLOR = {
  paid: 'bg-blue-500/15 text-blue-300',
  organic: 'bg-green-500/15 text-green-300',
  viral: 'bg-pink-500/15 text-pink-300',
  community: 'bg-orange-500/15 text-orange-300',
  b2b: 'bg-violet-500/15 text-violet-300',
  video: 'bg-red-500/15 text-red-300',
  launch: 'bg-yellow-500/15 text-yellow-300',
  research: 'bg-slate-500/15 text-slate-400',
  niche: 'bg-teal-500/15 text-teal-300',
  deals: 'bg-amber-500/15 text-amber-300',
  extension: 'bg-cyan-500/15 text-cyan-300',
  tech: 'bg-indigo-500/15 text-indigo-300',
  custom: 'bg-emerald-500/15 text-emerald-300',
  default: 'bg-white/5 text-slate-400',
};

const ICON_PRESETS = ['🌐', '📱', '📧', '🎯', '🔍', '📊', '💬', '🎬', '🛒', '🤝', '📣', '🚀', '💡', '🔗', '📰'];
const COLOR_PRESETS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#10b981'];

// ── Add Source Modal ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  platform: '',
  category: 'Custom',
  url: '',
  icon: '🌐',
  color: '#6366f1',
  estimatedTraffic: '',
  difficulty: 'Medium',
  potential: 'Medium',
  tags: '',
  recommendedAction: '',
  audience: '',
  countries: '',
  keywords: '',
};

function AddSourceModal({ onClose }) {
  const { addCustomSource } = useStore();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  const set = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: null }));
  };

  const submit = () => {
    if (!form.platform.trim()) {
      setErrors({ platform: 'Вкажіть назву платформи' });
      return;
    }
    const toArr = (str) => str.split(',').map((s) => s.trim()).filter(Boolean);
    addCustomSource({
      platform: form.platform.trim(),
      category: form.category,
      url: form.url.trim(),
      icon: form.icon,
      color: form.color,
      estimatedTraffic: form.estimatedTraffic.trim() || '—',
      difficulty: form.difficulty,
      potential: form.potential,
      tags: toArr(form.tags),
      recommendedAction: form.recommendedAction.trim(),
      audience: form.audience.trim(),
      countries: toArr(form.countries),
      keywords: toArr(form.keywords),
      trafficSources: [],
      researchLinks: [],
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-[#111228] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Plus size={15} className="text-indigo-400" />
            <h2 className="text-[14px] font-bold text-white">Новий ресурс</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Icon + Color + Platform */}
          <div className="flex gap-3">
            {/* Icon picker */}
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Іконка</label>
              <div className="flex flex-wrap gap-1 w-32">
                {ICON_PRESETS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => set('icon', ic)}
                    className={`w-7 h-7 rounded-lg text-[14px] flex items-center justify-center transition-all ${
                      form.icon === ic
                        ? 'bg-indigo-600/40 ring-1 ring-indigo-500'
                        : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform + category */}
            <div className="flex-1 flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Назва <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.platform}
                  onChange={(e) => set('platform', e.target.value)}
                  placeholder="Наприклад: Reddit Ads"
                  className={`w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors ${
                    errors.platform ? 'border-red-500/60' : 'border-white/10'
                  }`}
                />
                {errors.platform && <p className="text-[10px] text-red-400 mt-1">{errors.platform}</p>}
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Категорія</label>
                <select
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/60 transition-colors"
                >
                  {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                    <option key={c} value={c} style={{ background: '#111228' }}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Колір</label>
            <div className="flex items-center gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  style={{ background: c }}
                  className={`w-6 h-6 rounded-lg transition-all flex-shrink-0 ${
                    form.color === c ? 'ring-2 ring-white/60 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  {form.color === c && <Check size={10} className="text-white m-auto" />}
                </button>
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                className="w-6 h-6 rounded-lg border border-white/10 bg-transparent cursor-pointer flex-shrink-0"
                title="Свій колір"
              />
            </div>
          </div>

          {/* URL */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">URL</label>
            <input
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Трафік</label>
              <input
                value={form.estimatedTraffic}
                onChange={(e) => set('estimatedTraffic', e.target.value)}
                placeholder="100K/mo"
                className="w-full px-3 py-2 text-[12px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Складність</label>
              <select
                value={form.difficulty}
                onChange={(e) => set('difficulty', e.target.value)}
                className="w-full px-3 py-2 text-[12px] rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/60 transition-colors"
              >
                {DIFFICULTY_OPTIONS.map((o) => <option key={o} value={o} style={{ background: '#111228' }}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Потенціал</label>
              <select
                value={form.potential}
                onChange={(e) => set('potential', e.target.value)}
                className="w-full px-3 py-2 text-[12px] rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/60 transition-colors"
              >
                {POTENTIAL_OPTIONS.map((o) => <option key={o} value={o} style={{ background: '#111228' }}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Recommended action */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Рекомендована дія</label>
            <textarea
              value={form.recommendedAction}
              onChange={(e) => set('recommendedAction', e.target.value)}
              placeholder="Що саме робити з цим ресурсом..."
              rows={2}
              className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors resize-none"
            />
          </div>

          {/* Audience */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Аудиторія</label>
            <input
              value={form.audience}
              onChange={(e) => set('audience', e.target.value)}
              placeholder="Хто користується цим каналом..."
              className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>

          {/* Tags, Countries, Keywords */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Теги <span className="text-slate-600 normal-case font-normal">(через кому)</span></label>
              <input
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="paid, b2b, social"
                className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Країни <span className="text-slate-600 normal-case font-normal">(через кому)</span></label>
              <input
                value={form.countries}
                onChange={(e) => set('countries', e.target.value)}
                placeholder="US, UK, UA"
                className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Ключові слова <span className="text-slate-600 normal-case font-normal">(через кому)</span></label>
              <input
                value={form.keywords}
                onChange={(e) => set('keywords', e.target.value)}
                placeholder="SaaS, B2B, marketing"
                className="w-full px-3 py-2 text-[13px] rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.07] flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            Скасувати
          </button>
          <button
            onClick={submit}
            className="px-5 py-2 rounded-xl text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Додати ресурс
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Source Card ───────────────────────────────────────────────────────────────
function SourceCard({ source, t, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const tagClass = (tag) => TAG_COLOR[tag] || TAG_COLOR.default;

  return (
    <div className={`bg-white/[0.025] border rounded-2xl overflow-hidden transition-all duration-200 ${
      confirming ? 'border-red-500/40' : 'border-white/[0.07] hover:border-white/[0.13]'
    }`}>
      {/* Card header */}
      <div className="px-4 py-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: `${source.color}18`, border: `1px solid ${source.color}30` }}
          >
            {source.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-[14px] font-bold text-white">{source.platform}</h3>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-slate-600 hover:text-indigo-400 transition-colors"
                >
                  <ExternalLink size={11} />
                </a>
              )}
              {source.custom && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">custom</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">{source.category}</p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {onDelete && (
              <button
                onClick={() => setConfirming(true)}
                className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Видалити"
              >
                <Trash2 size={13} />
              </button>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Key stats row */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">{t('traffic_col_traffic')}</p>
            <p className="text-[11px] font-semibold text-white">{source.estimatedTraffic}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">{t('traffic_col_difficulty')}</p>
            <p className={`text-[11px] font-semibold ${DIFFICULTY_COLOR[source.difficulty] || 'text-slate-300'}`}>
              {source.difficulty}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">{t('traffic_col_potential')}</p>
            <p className={`text-[11px] font-semibold ${POTENTIAL_COLOR[source.potential] || 'text-slate-300'}`}>
              {source.potential}
            </p>
          </div>
        </div>

        {/* Tags */}
        {(source.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {source.tags.map((tag) => (
              <span key={tag} className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${tagClass(tag)}`}>
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation banner */}
      {confirming && (
        <div className="mx-4 mb-4 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3">
          <Trash2 size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-[12px] text-red-300 flex-1">
            {source.custom ? 'Видалити цей ресурс назавжди?' : 'Сховати цей ресурс?'}
          </p>
          <button
            onClick={() => setConfirming(false)}
            className="px-2.5 py-1 rounded-lg text-[11px] text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            Ні
          </button>
          <button
            onClick={() => { onDelete(); setConfirming(false); }}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500 hover:bg-red-400 text-white transition-colors"
          >
            Так
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/[0.05] px-4 py-4 space-y-3">
          {source.recommendedAction && (
            <div className="p-3 rounded-xl bg-indigo-500/8 border border-indigo-500/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap size={11} className="text-indigo-400" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">{t('traffic_recommended_action')}</p>
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed">{source.recommendedAction}</p>
            </div>
          )}

          {(source.countries || []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{t('traffic_top_countries')}</p>
              <div className="flex flex-wrap gap-1.5">
                {source.countries.map((c) => (
                  <span key={c} className="text-[10px] px-2 py-0.5 rounded-lg bg-white/5 text-slate-400 font-medium">{c}</span>
                ))}
              </div>
            </div>
          )}

          {source.audience && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{t('traffic_audience')}</p>
              <p className="text-[12px] text-slate-400">{source.audience}</p>
            </div>
          )}

          {(source.trafficSources || []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{t('traffic_sources_label')}</p>
              <div className="flex flex-wrap gap-1.5">
                {source.trafficSources.map((ts) => (
                  <span key={ts} className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 font-medium">{ts}</span>
                ))}
              </div>
            </div>
          )}

          {(source.keywords || []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{t('traffic_keywords')}</p>
              <div className="flex flex-wrap gap-1.5">
                {source.keywords.map((kw) => (
                  <span key={kw} className="text-[10px] px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-400 font-medium">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {(source.researchLinks || []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{t('traffic_research_links')}</p>
              <div className="flex flex-wrap gap-2">
                {source.researchLinks.map((rl) => (
                  <a
                    key={rl.label}
                    href={rl.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                  >
                    {rl.label}
                    <ExternalLink size={9} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TrafficResearch() {
  const {
    trafficQuery, setTrafficQuery, trafficFilter, setTrafficFilter,
    customTrafficSources, deleteCustomSource,
    hiddenSourceIds, hideSource, restoreAllSources,
  } = useStore();
  const t = useTranslation();
  const [showAddModal, setShowAddModal] = useState(false);

  const allSources = useMemo(
    () => [...customTrafficSources, ...MOCK_TRAFFIC_SOURCES],
    [customTrafficSources]
  );

  const visibleSources = useMemo(
    () => allSources.filter((s) => !hiddenSourceIds.includes(s.id)),
    [allSources, hiddenSourceIds]
  );

  const filtered = useMemo(() => {
    let list = visibleSources;
    if (trafficFilter !== 'all') {
      list = list.filter((s) => s.category === trafficFilter);
    }
    if (trafficQuery.trim()) {
      const q = trafficQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.platform.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.audience || '').toLowerCase().includes(q) ||
          (s.keywords || []).some((k) => k.toLowerCase().includes(q)) ||
          (s.tags || []).some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return list;
  }, [trafficQuery, trafficFilter, visibleSources]);

  const hiddenCount = hiddenSourceIds.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#070818]">
      {/* Sub-header */}
      <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0a0b1e] flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] max-w-md relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              value={trafficQuery}
              onChange={(e) => setTrafficQuery(e.target.value)}
              placeholder={t('traffic_search_placeholder')}
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-xl"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={13} className="text-slate-500" />
            <select
              value={trafficFilter}
              onChange={(e) => setTrafficFilter(e.target.value)}
              className="px-3 py-2 text-[12px] rounded-xl"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c === 'all' ? t('traffic_all_categories') : c}</option>
              ))}
            </select>
          </div>

          <span className="text-[11px] text-slate-500">
            {filtered.length} / {visibleSources.length}
          </span>

          {hiddenCount > 0 && (
            <button
              onClick={restoreAllSources}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors border border-white/[0.07]"
              title="Відновити приховані ресурси"
            >
              <X size={11} />
              Показати приховані ({hiddenCount})
            </button>
          )}

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold transition-colors shadow-md shadow-indigo-500/20 ml-auto"
          >
            <Plus size={13} />
            Додати ресурс
          </button>
        </div>

        {/* Research tool links */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span className="text-[10px] text-slate-600 uppercase tracking-wider">{t('traffic_research_with')}</span>
          {[
            { label: 'SimilarWeb',    url: 'https://similarweb.com',    color: '#FF6B35' },
            { label: 'Semrush',       url: 'https://semrush.com',       color: '#FF642D' },
            { label: 'Ahrefs',        url: 'https://ahrefs.com',        color: '#F97316' },
            { label: 'SparkToro',     url: 'https://sparktoro.com',     color: '#6366f1' },
            { label: 'Google Trends', url: 'https://trends.google.com', color: '#4285F4' },
          ].map((tool) => (
            <a
              key={tool.label}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: tool.color }}
            >
              {tool.label}
              <ExternalLink size={9} />
            </a>
          ))}
        </div>
      </div>

      {/* Source grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Globe2 size={40} className="text-slate-700 mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-slate-500 mb-1">{t('traffic_empty_title')}</p>
            <p className="text-[12px] text-slate-600">{t('traffic_empty_body')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                t={t}
                onDelete={source.custom
                  ? () => deleteCustomSource(source.id)
                  : () => hideSource(source.id)
                }
              />
            ))}
          </div>
        )}

        {/* Mock data notice */}
        <div className="mt-6 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <AlertCircle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-semibold text-amber-300 mb-1">{t('traffic_mock_title')}</p>
              <p className="text-[11px] text-amber-700 leading-relaxed">{t('traffic_mock_body')}</p>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && <AddSourceModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
