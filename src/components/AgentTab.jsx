import React, { useState } from 'react';
import {
  Bot, Zap, Copy, Check, ChevronDown, ChevronUp,
  Sparkles, Lightbulb, ListTodo, Search, Calendar, FileText, AlertCircle, Send,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { runNodeAgent } from '../services/agent';
import { useTranslation } from '../i18n/useTranslation';
import PostStudio from './PostStudio';

// ── CopyButton ────────────────────────────────────────────────────────────────
function CopyBtn({ text, size = 'sm' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className={`flex-shrink-0 rounded-lg transition-colors ${
        size === 'sm'
          ? 'p-1 text-slate-600 hover:text-slate-300 hover:bg-white/5'
          : 'px-2.5 py-1 text-[10px] font-semibold text-slate-400 hover:text-white hover:bg-white/5 border border-white/[0.08] flex items-center gap-1'
      }`}
    >
      {copied
        ? <Check size={size === 'sm' ? 11 : 10} className="text-green-400" />
        : <Copy size={size === 'sm' ? 11 : 10} />}
      {size !== 'sm' && <span>{copied ? 'Copied' : 'Copy'}</span>}
    </button>
  );
}

// ── Normalize any item to a displayable string ───────────────────────────────
function itemToString(item) {
  if (typeof item === 'string') return item;
  if (item === null || item === undefined) return '';
  if (typeof item === 'object') {
    return Object.entries(item)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }
  return String(item);
}

// ── Section type icon ─────────────────────────────────────────────────────────
const SECTION_ICONS = {
  list:      { Icon: ListTodo,  color: 'text-indigo-400' },
  templates: { Icon: FileText,  color: 'text-violet-400' },
  queries:   { Icon: Search,    color: 'text-cyan-400'   },
  schedule:  { Icon: Calendar,  color: 'text-green-400'  },
  steps:     { Icon: ListTodo,  color: 'text-amber-400'  },
};

function Section({ section }) {
  const [open, setOpen] = useState(true);
  const { Icon, color } = SECTION_ICONS[section.type] || SECTION_ICONS.list;
  const items = section.items || [];

  return (
    <div className="mb-3 rounded-xl border border-white/[0.07] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left"
      >
        <Icon size={12} className={color} />
        <span className={`text-[11px] font-bold uppercase tracking-wider flex-1 ${color}`}>
          {section.title}
        </span>
        {items.length > 0 && (
          <span className="text-[9px] text-slate-600 mr-1">{items.length}</span>
        )}
        {open
          ? <ChevronUp size={11} className="text-slate-600" />
          : <ChevronDown size={11} className="text-slate-600" />}
      </button>

      {open && items.length > 0 && (
        <div className="px-3 py-2.5 space-y-1.5">
          {items.map((item, i) => {
            const text = itemToString(item);
            return (
              <div key={i} className="flex items-start gap-2 group">
                <span className="text-[10px] text-slate-600 font-bold mt-0.5 flex-shrink-0 w-4">
                  {i + 1}.
                </span>
                <p className="text-[11px] text-slate-300 leading-relaxed flex-1">{text}</p>
                <CopyBtn text={text} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Copyable card ─────────────────────────────────────────────────────────────
function CopyableCard({ item }) {
  const [open, setOpen] = useState(false);
  const label   = itemToString(item.label);
  const content = itemToString(item.content);
  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 mb-2 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left"
        >
          <p className="text-[11px] font-semibold text-violet-300">{label}</p>
        </button>
        <CopyBtn text={content} size="md" />
        <button onClick={() => setOpen((v) => !v)}>
          {open
            ? <ChevronUp size={11} className="text-slate-600" />
            : <ChevronDown size={11} className="text-slate-600" />}
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.05]">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main AgentTab ─────────────────────────────────────────────────────────────
export default function AgentTab({ node }) {
  const t = useTranslation();
  const {
    productInfo, language,
    agentResults, agentRunningId,
    setAgentResult, setAgentRunningId,
  } = useStore();

  const result = agentResults[node.id] || null;
  const isRunning = agentRunningId === node.id;
  const [error, setError] = useState(null);

  const handleRun = async () => {
    if (isRunning) return;
    setError(null);
    setAgentRunningId(node.id);
    try {
      const res = await runNodeAgent(node, productInfo, language);
      setAgentResult(node.id, res);
    } catch (err) {
      setError(err.message || 'Agent error');
    } finally {
      setAgentRunningId(null);
    }
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ── Empty state (no product) ──────────────────────────────────────────────
  if (!productInfo.name) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <Bot size={28} className="text-slate-600 mb-3" />
        <p className="text-[12px] text-slate-500">{t('agent_needs_product')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Run button */}
      <div className="px-4 py-3 border-b border-white/[0.05] flex-shrink-0">
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-semibold transition-colors shadow-lg shadow-violet-500/20"
        >
          {isRunning
            ? <><Zap size={13} className="animate-spin" /> {t('agent_running')}</>
            : <><Bot size={13} /> {result ? t('agent_rerun') : t('agent_run')}</>}
        </button>

        {isRunning && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <Sparkles size={11} className="text-violet-400 animate-pulse" />
            <p className="text-[11px] text-violet-300">{t('agent_thinking')}</p>
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-red-300">{error}</p>
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="flex-1 px-4 py-3 space-y-3">
          {/* Timestamp */}
          <p className="text-[9px] text-slate-600 uppercase tracking-wider">
            {t('agent_last_run')} {formatTime(result.timestamp)}
          </p>

          {/* Summary */}
          {result.summary && (
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
              <div className="flex items-start gap-2">
                <Lightbulb size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-slate-200 leading-relaxed">{itemToString(result.summary)}</p>
              </div>
            </div>
          )}

          {/* Quick wins */}
          {result.quickWins?.length > 0 && (
            <div className="p-3 rounded-xl bg-green-500/8 border border-green-500/20">
              <p className="text-[10px] font-bold uppercase tracking-wider text-green-400 mb-2">
                ⚡ {t('agent_quick_wins')}
              </p>
              <ul className="space-y-1.5">
                {result.quickWins.map((w, i) => {
                  const text = itemToString(w);
                  return (
                    <li key={i} className="flex items-start gap-2 group">
                      <span className="text-green-500 font-bold text-[10px] mt-0.5">✓</span>
                      <p className="text-[11px] text-green-200 leading-relaxed flex-1">{text}</p>
                      <CopyBtn text={text} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Sections */}
          {result.sections?.map((s, i) => (
            <Section key={i} section={s} />
          ))}

          {/* Copyable templates */}
          {result.copyables?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-2 flex items-center gap-1.5">
                <Copy size={10} />
                {t('agent_templates')}
              </p>
              {result.copyables.map((c, i) => (
                <CopyableCard key={i} item={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty result state */}
      {!result && !isRunning && (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
            <Bot size={24} className="text-violet-400" />
          </div>
          <p className="text-[13px] font-semibold text-white mb-1">{t('agent_empty_title')}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('agent_empty_body')}</p>
        </div>
      )}

      {/* ── Post Studio divider ── */}
      <div className="border-t border-white/[0.06] mt-1">
        <PostStudio />
      </div>
    </div>
  );
}
