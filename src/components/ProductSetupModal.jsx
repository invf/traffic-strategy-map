import React, { useState } from 'react';
import { X, Zap, Map, Sparkles, Globe2, Target, DollarSign, Users, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { generateAISuggestions } from '../data/mockData';
import { generateStrategyWithAI } from '../services/openai';
import { errorKeyForStatus } from '../lib/apiErrors';
import { useTranslation } from '../i18n/useTranslation';

const GOAL_VALUES = ['traffic', 'sales', 'signups', 'installs', 'subscribers'];

const COUNTRIES = [
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IN', 'BR', 'NL', 'SE',
  'PL', 'UA', 'ES', 'IT', 'MX', 'JP', 'SG', 'KR', 'AE',
];

function Field({ label, required, Icon, children }) {
  return (
    <div className="mb-5">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        {Icon && <Icon size={11} />}
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ProductSetupModal() {
  const {
    productInfo, generateMap, setProductInfo, setShowSetup, setAiSuggestions,
    isGenerating, setIsGenerating, language, activeProjectSource, nodes,
  } = useStore();
  const t = useTranslation();
  // ADV-004-FIX-3 (requirement A) - the root fix for "Edit Product
  // replaces the imported graph": when a linked Cloud Strategy is
  // active, this modal edits PRODUCT METADATA ONLY by default
  // (setProductInfo - never touches nodes/edges/showSetup at all).
  // AI regeneration remains available, but only as a separate, clearly-
  // labeled, explicitly-confirmed action - never the default "Save"
  // behavior, and its own failure path never falls back to the mock
  // template (requirement: "AI generation errors must preserve the
  // current graph" / "never silently fall back to a mock/template
  // strategy in the context of editing a saved Cloud Strategy").
  const isCloudStrategy = activeProjectSource === 'cloud';
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const [form, setForm] = useState({
    name: productInfo.name || '',
    description: productInfo.description || '',
    audience: productInfo.audience || '',
    countries: productInfo.countries?.length ? productInfo.countries : ['US'],
    budget: productInfo.budget || '',
    goal: productInfo.goal || 'traffic',
  });

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const toggleCountry = (c) => {
    set('countries', form.countries.includes(c)
      ? form.countries.filter((x) => x !== c)
      : [...form.countries, c]
    );
  };

  const [genError, setGenError] = useState(null);
  const [genStep, setGenStep] = useState('');

  const isValid = form.name.trim() && form.description.trim() && form.audience.trim();

  // ADV-004-FIX-3 (requirement A) - the ONLY action available by default
  // while editing a linked Cloud Strategy: a plain metadata merge via the
  // store's EXISTING setProductInfo action (never nodes/edges, never
  // showSetup). Closing the modal afterward is an explicit, separate
  // click (the existing Cancel/X button), never automatic here, so the
  // user can keep adjusting fields without the modal popping shut on them.
  const handleSaveMetadataOnly = () => {
    if (!isValid) return;
    setProductInfo(form);
  };

  const handleGenerate = async () => {
    if (!isValid) return;
    setIsGenerating(true);
    setGenError(null);
    setGenStep('Аналізую продукт...');

    try {
      setGenStep('Генерую стратегію з AI...');
      const result = await generateStrategyWithAI(form, language);

      setGenStep('Будую мапу...');
      generateMap(form, result.nodes, result.edges);
      setAiSuggestions(result.aiSuggestions || generateAISuggestions(form));
    } catch (err) {
      console.error('AI generation failed:', err);
      // AUTH-003B: a known auth/quota/availability status gets the
      // same translated wording as the strategies proxy; anything else
      // falls back to whatever the backend said.
      const key = errorKeyForStatus(err?.status);
      setGenError(key ? t(key) : (err.message || 'Помилка AI. Використовую базову стратегію.'));
      // ADV-004-FIX-3 (requirement A) - "AI generation errors must
      // preserve the current graph" / "never silently fall back to a
      // mock/template strategy in the context of editing a saved Cloud
      // Strategy": the mock-data fallback below is PRESERVED exactly as
      // it always was for the Local Draft generation workflow (an
      // existing, already-accepted UX this fix must not change - "no
      // unrelated architecture changes") - it is simply never reachable
      // for a Cloud Strategy, since this whole function is now only
      // ever invoked from the explicitly-confirmed "Regenerate" action
      // below, not from editing a Cloud Strategy's product metadata.
      if (!isCloudStrategy) {
        generateMap(form);
        setAiSuggestions(generateAISuggestions(form));
      }
    } finally {
      setIsGenerating(false);
      setGenStep('');
    }
  };

  const handleConfirmRegenerate = () => {
    setShowRegenerateConfirm(false);
    handleGenerate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => productInfo.name && setShowSetup(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[#0d0e24] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.06] bg-gradient-to-r from-indigo-600/10 to-violet-600/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Map size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-white">{t('modal_title')}</h2>
              <p className="text-[11px] text-slate-400">{t('modal_subtitle')}</p>
            </div>
            {productInfo.name && (
              <button
                onClick={() => setShowSetup(false)}
                className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Field label={t('modal_field_name')} required Icon={Sparkles}>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('modal_placeholder_name')}
              className="w-full px-3 py-2.5 text-[13px] rounded-xl"
            />
          </Field>

          <Field label={t('modal_field_desc')} required Icon={Globe2}>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('modal_placeholder_desc')}
              rows={3}
              className="w-full px-3 py-2.5 text-[13px] rounded-xl resize-none leading-relaxed"
            />
          </Field>

          <Field label={t('modal_field_audience')} required Icon={Users}>
            <input
              value={form.audience}
              onChange={(e) => set('audience', e.target.value)}
              placeholder={t('modal_placeholder_audience')}
              className="w-full px-3 py-2.5 text-[13px] rounded-xl"
            />
          </Field>

          <Field label={t('modal_field_goal')} Icon={Target}>
            <div className="grid grid-cols-1 gap-2">
              {GOAL_VALUES.map((g) => (
                <button
                  key={g}
                  onClick={() => set('goal', g)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    form.goal === g
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                      : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                    form.goal === g ? 'border-indigo-400 bg-indigo-400' : 'border-slate-600'
                  }`} />
                  <div>
                    <p className="text-[12px] font-semibold">{t(`goal_${g}_label`)}</p>
                    <p className="text-[10px] text-slate-500">{t(`goal_${g}_desc`)}</p>
                  </div>
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('modal_field_countries')} Icon={Globe2}>
            <div className="flex flex-wrap gap-2">
              {COUNTRIES.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCountry(c)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all border ${
                    form.countries.includes(c)
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:border-white/20'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('modal_field_budget')} Icon={DollarSign}>
            <input
              value={form.budget}
              onChange={(e) => set('budget', e.target.value)}
              placeholder={t('modal_placeholder_budget')}
              className="w-full px-3 py-2.5 text-[13px] rounded-xl"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex flex-col gap-3 flex-shrink-0">
          {/* Error message */}
          {genError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-[12px]">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{genError}</span>
            </div>
          )}

          {/* Loading step indicator */}
          {isGenerating && genStep && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/25">
              <Zap size={12} className="text-indigo-400 animate-pulse flex-shrink-0" />
              <span className="text-[12px] text-indigo-300">{genStep}</span>
            </div>
          )}

          {/* ADV-004-FIX-3 (requirement A) - a linked Cloud Strategy gets
              a completely different primary action: Save (metadata only,
              never nodes/edges) instead of Generate. The legacy
              generator stays available, but only as a separate,
              de-emphasized, explicitly-confirmed action - never the
              default button a habitual click would land on. */}
          {isCloudStrategy ? (
            <>
              {showRegenerateConfirm && (
                <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-[12px]">
                  <span>{t('modal_regenerate_confirm_text').replace('{count}', String(nodes.length))}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowRegenerateConfirm(false)}
                      className="flex-1 py-1.5 rounded-lg border border-white/15 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors"
                    >
                      {t('modal_btn_cancel')}
                    </button>
                    <button
                      onClick={handleConfirmRegenerate}
                      disabled={!isValid || isGenerating}
                      className="flex-1 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                    >
                      {t('modal_regenerate_confirm_btn')}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSetup(false)}
                  disabled={isGenerating}
                  className="flex-1 py-2.5 rounded-xl border border-white/[0.1] text-slate-400 hover:text-white hover:border-white/20 text-[13px] font-semibold transition-colors disabled:opacity-40"
                >
                  {t('modal_btn_cancel')}
                </button>
                <button
                  onClick={handleSaveMetadataOnly}
                  disabled={!isValid}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-colors shadow-lg shadow-indigo-500/20"
                >
                  {t('modal_btn_save_details')}
                </button>
              </div>
              <button
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={isGenerating}
                className="text-[11px] text-slate-500 hover:text-amber-300 underline self-center transition-colors disabled:opacity-40"
              >
                {isGenerating ? genStep || t('modal_btn_generate') : t('modal_btn_regenerate')}
              </button>
            </>
          ) : (
            <div className="flex gap-3">
              {productInfo.name && (
                <button
                  onClick={() => setShowSetup(false)}
                  disabled={isGenerating}
                  className="flex-1 py-2.5 rounded-xl border border-white/[0.1] text-slate-400 hover:text-white hover:border-white/20 text-[13px] font-semibold transition-colors disabled:opacity-40"
                >
                  {t('modal_btn_cancel')}
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={!isValid || isGenerating}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-colors shadow-lg shadow-indigo-500/20"
              >
                <Zap size={14} className={isGenerating ? 'animate-spin' : ''} />
                {isGenerating ? genStep || 'Генерую...' : t('modal_btn_generate')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
