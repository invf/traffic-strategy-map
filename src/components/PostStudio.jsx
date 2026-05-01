import React, { useState } from 'react';
import {
  Sparkles, Zap, Copy, Check, ChevronDown, ChevronUp,
  BarChart2, AlertTriangle, ThumbsUp, Send,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { runPostStudio } from '../services/postStudio';
import { useTranslation } from '../i18n/useTranslation';

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors flex-shrink-0"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ value, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-white/[0.07] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="text-[9px] text-slate-500 w-6 text-right">{value}</span>
    </div>
  );
}

// ── Verdict badge ─────────────────────────────────────────────────────────────
function VerdictBadge({ verdict, score }) {
  const cfg = {
    use:    { bg: 'bg-green-500/15',  border: 'border-green-500/30',  text: 'text-green-400',  label: 'USE'    },
    edit:   { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',  label: 'EDIT'   },
    reject: { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',    label: 'REJECT' },
  }[verdict] || { bg: 'bg-slate-500/15', border: 'border-slate-500/30', text: 'text-slate-400', label: verdict?.toUpperCase() };

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span>{cfg.label}</span>
      <span className="opacity-60">·</span>
      <span>{Math.round(score)}</span>
    </div>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────
function PostCard({ post, index }) {
  const [open, setOpen] = useState(false);

  const borderColor = {
    use:    'border-green-500/20',
    edit:   'border-amber-500/20',
    reject: 'border-red-500/15',
  }[post.verdict] || 'border-white/[0.07]';

  return (
    <div className={`rounded-xl border overflow-hidden mb-2.5 ${borderColor}`}>
      {/* Post text + actions */}
      <div className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <span className="text-[10px] text-slate-600 font-bold mt-0.5 flex-shrink-0">
            #{index + 1}
          </span>
          <p className="text-[12px] text-slate-200 leading-relaxed flex-1 whitespace-pre-wrap">
            {post.post}
          </p>
          <CopyBtn text={post.post} />
        </div>

        {/* Verdict + expand */}
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={post.verdict} score={post.final_score} />
          {post.angle && (
            <span className="text-[9px] text-slate-600 italic">{post.angle}</span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto text-slate-600 hover:text-slate-400 transition-colors"
          >
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/[0.05] pt-3 bg-white/[0.015]">
          {/* Scores */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <p className="text-[8px] text-slate-600 uppercase mb-0.5">Virality</p>
              <ScoreBar value={post.virality_score} color="#6366f1" />
            </div>
            <div>
              <p className="text-[8px] text-slate-600 uppercase mb-0.5">CTR</p>
              <ScoreBar value={post.ctr_score} color="#06b6d4" />
            </div>
            <div>
              <p className="text-[8px] text-slate-600 uppercase mb-0.5">Product fit</p>
              <ScoreBar value={post.product_fit_score} color="#22c55e" />
            </div>
            <div>
              <p className="text-[8px] text-slate-600 uppercase mb-0.5">Risk</p>
              <ScoreBar value={post.risk_score} color="#ef4444" />
            </div>
          </div>

          {/* Why it works */}
          {post.why_it_might_work && (
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
              <p className="text-[9px] text-slate-600 uppercase mb-1">Hook psychology</p>
              <p className="text-[11px] text-slate-400">{post.why_it_might_work}</p>
            </div>
          )}

          {/* Reason */}
          {post.reason && (
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
              <p className="text-[9px] text-slate-600 uppercase mb-1">Verdict reason</p>
              <p className="text-[11px] text-slate-400">{post.reason}</p>
            </div>
          )}

          {/* CTA */}
          {post.cta && (
            <p className="text-[10px] text-indigo-400">
              <span className="text-slate-600">CTA: </span>{post.cta}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main PostStudio ───────────────────────────────────────────────────────────
export default function PostStudio() {
  const t = useTranslation();
  const { productInfo, language } = useStore();

  const [topic, setTopic] = useState('');
  const [step, setStep]   = useState(null); // null | 'generating' | 'scoring'
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);

  const stepLabel = {
    generating: t('studio_step_generating'),
    scoring:    t('studio_step_scoring'),
  };

  const usable  = posts.filter((p) => p.verdict === 'use').length;
  const editable = posts.filter((p) => p.verdict === 'edit').length;

  const handleRun = async () => {
    if (!topic.trim() || step) return;
    setError(null);
    setPosts([]);

    try {
      const results = await runPostStudio(
        topic.trim(),
        productInfo,
        language,
        (s) => setStep(s),
      );
      setPosts(results);
    } catch (err) {
      setError(err.message || 'Error');
    } finally {
      setStep(null);
    }
  };

  if (!productInfo.name) {
    return (
      <div className="p-4 text-center">
        <p className="text-[11px] text-slate-600">{t('studio_needs_product')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Send size={13} className="text-sky-400" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
          {t('studio_title')}
        </p>
      </div>

      {/* Topic input */}
      <div className="flex gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
          placeholder={t('studio_placeholder')}
          className="flex-1 px-3 py-2 text-[12px] rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500/50"
        />
        <button
          onClick={handleRun}
          disabled={!topic.trim() || !!step}
          className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition-colors flex items-center gap-1.5 flex-shrink-0"
        >
          {step
            ? <Zap size={11} className="animate-spin" />
            : <Sparkles size={11} />}
          {step ? stepLabel[step] : t('studio_run')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-300">{error}</p>
        </div>
      )}

      {/* Stats bar */}
      {posts.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <BarChart2 size={11} className="text-slate-500" />
          <span className="text-[10px] text-slate-500">{posts.length} posts scored</span>
          <span className="text-[10px] text-green-400 font-semibold">✓ {usable} ready</span>
          <span className="text-[10px] text-amber-400 font-semibold">~ {editable} edit</span>
          <button
            onClick={handleRun}
            className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            {t('studio_regenerate')}
          </button>
        </div>
      )}

      {/* Posts */}
      {posts.map((post, i) => (
        <PostCard key={i} post={post} index={i} />
      ))}
    </div>
  );
}
