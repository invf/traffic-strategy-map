import React, { useState } from 'react';
import {
  BrainCircuit, Zap, TrendingUp, Target, AlertTriangle, TestTube,
  MessageSquare, Copy, Check, ChevronDown, ChevronUp, Sparkles,
  FileText, Globe2, Play,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { generateAISuggestions } from '../data/mockData';
import { generateStrategyWithAI } from '../services/openai';
import { useTranslation } from '../i18n/useTranslation';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

function Section({ icon: Icon, title, color = 'indigo', children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = {
    indigo:  { bg: 'bg-indigo-500/8',  border: 'border-indigo-500/25',  text: 'text-indigo-400'  },
    violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/25',  text: 'text-violet-400'  },
    green:   { bg: 'bg-green-500/8',   border: 'border-green-500/25',   text: 'text-green-400'   },
    amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/25',   text: 'text-amber-400'   },
    rose:    { bg: 'bg-rose-500/8',    border: 'border-rose-500/25',    text: 'text-rose-400'    },
    cyan:    { bg: 'bg-cyan-500/8',    border: 'border-cyan-500/25',    text: 'text-cyan-400'    },
  };
  const c = colors[color] || colors.indigo;

  return (
    <div className={`rounded-2xl border overflow-hidden mb-4 ${c.border}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-4 py-3.5 ${c.bg} hover:brightness-110 transition-all`}
      >
        <Icon size={14} className={c.text} />
        <span className={`text-[12px] font-bold uppercase tracking-wider ${c.text}`}>{title}</span>
        <span className="ml-auto">
          {open ? <ChevronUp size={13} className="text-slate-500" /> : <ChevronDown size={13} className="text-slate-500" />}
        </span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function ChannelCard({ channel }) {
  const priorityColor = { High: 'text-red-400', Medium: 'text-amber-400', Low: 'text-slate-400' };
  return (
    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] mb-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[13px] font-bold text-white flex-1">{channel.channel}</p>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${priorityColor[channel.priority] || 'text-slate-400'}`}>
          {channel.priority}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5">{channel.rationale}</p>
      <div className="flex items-center gap-3 text-[10px] text-slate-600 mb-3">
        <span>⏱ {channel.timeline}</span>
        <span>💰 {channel.budget}</span>
      </div>
      <ul className="space-y-1">
        {(channel.actions || []).map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
            <span className="text-indigo-400 font-bold flex-shrink-0">{i + 1}.</span>
            {a}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContentCard({ idea }) {
  return (
    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] mb-3 group">
      <div className="flex items-start gap-3">
        <div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">
            {idea.type}
          </span>
          <p className="text-[12px] font-semibold text-white mt-2 mb-1">{idea.title}</p>
          <p className="text-[10px] text-slate-500">{idea.platform}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">{idea.format}</p>
        </div>
        <CopyButton text={idea.title} />
      </div>
    </div>
  );
}

function AdMessageCard({ ad }) {
  return (
    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">
          {ad.type}
        </span>
        <CopyButton text={`${ad.headline}\n${ad.body}`} />
      </div>
      <p className="text-[13px] font-bold text-white mb-1.5">"{ad.headline}"</p>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{ad.body}</p>
      <p className="text-[10px] font-semibold text-green-400">CTA: {ad.cta}</p>
    </div>
  );
}

function PostIdeasSection({ posts, t }) {
  const groups = [
    { key: 'twitter',      labelKey: 'ai_twitter', Icon: MessageSquare, color: 'text-sky-400' },
    { key: 'reddit',       labelKey: 'ai_reddit',  Icon: Globe2,        color: 'text-orange-400' },
    { key: 'youtubeShorts', labelKey: 'ai_youtube', Icon: Play,          color: 'text-red-400' },
  ];
  return (
    <div className="space-y-4">
      {groups.map(({ key, labelKey, Icon, color }) => (
        <div key={key}>
          <div className="flex items-center gap-1.5 mb-2">
            <Icon size={12} className={color} />
            <p className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{t(labelKey)}</p>
          </div>
          {(posts[key] || []).map((post, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] mb-2">
              <p className="text-[11px] text-slate-300 flex-1 leading-relaxed">"{post}"</p>
              <CopyButton text={post} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AIAssistant() {
  const { aiSuggestions, setAiSuggestions, productInfo, isGenerating, setIsGenerating, language } = useStore();
  const t = useTranslation();

  const handleGenerate = async () => {
    if (!productInfo.name) return;
    setIsGenerating(true);
    try {
      const result = await generateStrategyWithAI(productInfo, language);
      setAiSuggestions(result.aiSuggestions || generateAISuggestions(productInfo));
    } catch {
      setAiSuggestions(generateAISuggestions(productInfo));
    } finally {
      setIsGenerating(false);
    }
  };

  if (!productInfo.name) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-[#070818]">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
            <BrainCircuit size={28} className="text-indigo-400" />
          </div>
          <h3 className="text-[15px] font-bold text-white mb-2">{t('ai_empty_title')}</h3>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-5">{t('ai_empty_body')}</p>
          <button
            onClick={() => useStore.getState().setShowSetup(true)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            {t('ai_empty_btn')}
          </button>
        </div>
      </div>
    );
  }

  if (!aiSuggestions) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-[#070818]">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={28} className="text-indigo-400" />
          </div>
          <h3 className="text-[15px] font-bold text-white mb-2">{t('ai_nodata_title')}</h3>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-5">
            {t('ai_nodata_body')}{' '}
            <span className="text-indigo-400 font-semibold">{productInfo.name}</span>.
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 mx-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-[13px] font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
          >
            {isGenerating
              ? <><Zap size={14} className="animate-pulse" /> {t('generating')}</>
              : <><Sparkles size={14} /> {t('ai_generate_btn')}</>
            }
          </button>
        </div>
      </div>
    );
  }

  const s = aiSuggestions;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#070818]">
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 py-3 bg-[#0a0b1e]/95 backdrop-blur border-b border-white/[0.06] flex items-center gap-3">
        <BrainCircuit size={16} className="text-indigo-400" />
        <span className="text-[13px] font-bold text-white flex-1">
          {t('ai_header')} · <span className="text-indigo-400">{productInfo.name}</span>
        </span>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition-colors disabled:opacity-50"
        >
          <Zap size={11} className={isGenerating ? 'animate-pulse' : ''} />
          {isGenerating ? t('ai_regenerating') : t('ai_regenerate')}
        </button>
      </div>

      <div className="px-6 py-5">
        <Section icon={TrendingUp} title={t('ai_channels')} color="indigo">
          {(s.channels || []).map((c, i) => <ChannelCard key={i} channel={c} />)}
        </Section>

        <Section icon={AlertTriangle} title={t('ai_weaknesses')} color="amber" defaultOpen={false}>
          <ul className="space-y-2">
            {(s.weaknesses || []).map((w, i) => (
              <li key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-200 leading-relaxed">{w}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={TestTube} title={t('ai_hypotheses')} color="violet" defaultOpen={false}>
          {(s.hypotheses || []).map((h, i) => (
            <div key={i} className="p-3.5 rounded-xl bg-violet-500/5 border border-violet-500/20 mb-3">
              <p className="text-[12px] font-semibold text-violet-200 mb-2 leading-relaxed">
                {t('ai_if_prefix')} {h.hypothesis}
              </p>
              <div className="space-y-1.5">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-violet-500">{t('ai_experiment_label')} </span>
                  <span className="text-[11px] text-slate-400">{h.experiment}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-violet-500">{t('ai_measure_label')} </span>
                  <span className="text-[11px] text-slate-400">{h.metric}</span>
                </div>
              </div>
            </div>
          ))}
        </Section>

        <Section icon={Target} title={t('ai_ad_messages')} color="cyan" defaultOpen={false}>
          {(s.adMessages || []).map((a, i) => <AdMessageCard key={i} ad={a} />)}
        </Section>

        <Section icon={FileText} title={t('ai_content_ideas')} color="green" defaultOpen={false}>
          {(s.contentIdeas || []).map((c, i) => <ContentCard key={i} idea={c} />)}
        </Section>

        <Section icon={MessageSquare} title={t('ai_social_posts')} color="rose" defaultOpen={false}>
          <PostIdeasSection posts={s.postIdeas || {}} t={t} />
        </Section>
      </div>
    </div>
  );
}
