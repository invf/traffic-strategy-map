import React, { useState } from 'react';
import {
  X, Trash2, Copy, MessageSquare, BookOpen, ClipboardList,
  Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2,
  ArrowRightCircle, Send, ChevronDown, Sparkles, Bot,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { NODE_TYPES_CONFIG, STATUS_CONFIG, PRIORITY_CONFIG } from '../data/mockData';
import { useTranslation } from '../i18n/useTranslation';
import AgentTab from './AgentTab';

const ICON_MAP = { Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2, ArrowRightCircle };

const STATUS_KEYS = {
  todo:        'status_todo',
  'in-progress': 'status_in_progress',
  done:        'status_done',
  blocked:     'status_blocked',
};

const PRIORITY_KEYS = {
  low:    'priority_low',
  medium: 'priority_medium',
  high:   'priority_high',
};

const NODE_TYPE_KEYS = {
  idea:       'type_idea',
  channel:    'type_channel',
  hypothesis: 'type_hypothesis',
  action:     'type_action',
  test:       'type_test',
  result:     'type_result',
  nextStep:   'type_nextStep',
};

const EXEC_OPTIONS = [
  { value: 'pending',     key: 'exec_pending' },
  { value: 'in-progress', key: 'exec_in_progress' },
  { value: 'completed',   key: 'exec_completed' },
  { value: 'blocked',     key: 'exec_blocked' },
  { value: 'cancelled',   key: 'exec_cancelled' },
];

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, className = '' }) {
  return (
    <input
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 text-[13px] rounded-lg ${className}`}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 text-[13px] rounded-lg resize-none leading-relaxed"
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-[13px] rounded-lg appearance-none pr-8"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
    </div>
  );
}

// ── Details Tab ───────────────────────────────────────────────────────────────
function DetailsTab({ node, t }) {
  const { updateNodeData } = useStore();
  const d = node.data;
  const cfg = NODE_TYPES_CONFIG[d.nodeType] || NODE_TYPES_CONFIG.action;
  const Icon = ICON_MAP[cfg.icon] || Zap;
  const nodeLabel = t(NODE_TYPE_KEYS[d.nodeType]) || cfg.label;

  const statusOptions = Object.entries(STATUS_CONFIG).map(([k]) => ({
    value: k,
    label: t(STATUS_KEYS[k]) || STATUS_CONFIG[k].label,
  }));

  const priorityOptions = Object.entries(PRIORITY_CONFIG).map(([k]) => ({
    value: k,
    label: t(PRIORITY_KEYS[k]) || PRIORITY_CONFIG[k].label,
  }));

  const nodeTypeOptions = Object.entries(NODE_TYPES_CONFIG).map(([k]) => ({
    value: k,
    label: t(NODE_TYPE_KEYS[k]) || NODE_TYPES_CONFIG[k].label,
  }));

  return (
    <div className="p-4">
      {/* Node type badge */}
      <div className="flex items-center gap-2 mb-4 p-2.5 rounded-xl" style={{ background: `${cfg.color}18` }}>
        <Icon size={14} style={{ color: cfg.color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
          {nodeLabel}
        </span>
      </div>

      <Field label={t('field_name')}>
        <Input
          value={d.label}
          onChange={(v) => updateNodeData(node.id, { label: v })}
          placeholder={t('placeholder_name')}
        />
      </Field>

      <Field label={t('field_description')}>
        <Textarea
          value={d.description}
          onChange={(v) => updateNodeData(node.id, { description: v })}
          placeholder={t('placeholder_description')}
          rows={3}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label={t('field_status')}>
          <Select
            value={d.status}
            onChange={(v) => updateNodeData(node.id, { status: v })}
            options={statusOptions}
          />
        </Field>
        <Field label={t('field_priority')}>
          <Select
            value={d.priority}
            onChange={(v) => updateNodeData(node.id, { priority: v })}
            options={priorityOptions}
          />
        </Field>
      </div>

      <Field label={t('field_node_type')}>
        <Select
          value={d.nodeType}
          onChange={(v) => updateNodeData(node.id, { nodeType: v, color: NODE_TYPES_CONFIG[v]?.color })}
          options={nodeTypeOptions}
        />
      </Field>

      <Field label={t('field_accent_color')}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={d.color || '#6366f1'}
            onChange={(e) => updateNodeData(node.id, { color: e.target.value })}
            className="w-10 h-8 rounded cursor-pointer border-0 bg-transparent"
          />
          <span className="text-[12px] text-slate-400">{d.color || '#6366f1'}</span>
          <button
            onClick={() => updateNodeData(node.id, { color: NODE_TYPES_CONFIG[d.nodeType]?.color })}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 underline"
          >
            {t('color_reset')}
          </button>
        </div>
      </Field>
    </div>
  );
}

// ── Context Tab ───────────────────────────────────────────────────────────────
function ContextTab({ node, t }) {
  const { updateContext } = useStore();
  const ctx = node.data.context || {};

  return (
    <div className="p-4">
      <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
        {t('context_intro')}
      </p>

      <Field label={t('field_why')}>
        <Textarea
          value={ctx.why}
          onChange={(v) => updateContext(node.id, { why: v })}
          placeholder={t('placeholder_why')}
          rows={3}
        />
      </Field>

      <Field label={t('field_product')}>
        <Input
          value={ctx.product}
          onChange={(v) => updateContext(node.id, { product: v })}
          placeholder={t('placeholder_product')}
        />
      </Field>

      <Field label={t('field_audience')}>
        <Input
          value={ctx.audience}
          onChange={(v) => updateContext(node.id, { audience: v })}
          placeholder={t('placeholder_audience')}
        />
      </Field>

      <Field label={t('field_expected_result')}>
        <Textarea
          value={ctx.expectedResult}
          onChange={(v) => updateContext(node.id, { expectedResult: v })}
          placeholder={t('placeholder_expected_result')}
          rows={3}
        />
      </Field>
    </div>
  );
}

// ── Plan Tab ──────────────────────────────────────────────────────────────────
function PlanTab({ node, t }) {
  const { updateActionPlan } = useStore();
  const plan = node.data.actionPlan || {};

  const execOptions = EXEC_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }));

  return (
    <div className="p-4">
      <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
        {t('plan_intro')}
      </p>

      <Field label={t('field_todo')}>
        <Textarea
          value={plan.todo}
          onChange={(v) => updateActionPlan(node.id, { todo: v })}
          placeholder={t('placeholder_todo')}
          rows={4}
        />
      </Field>

      <Field label={t('field_tools')}>
        <Input
          value={plan.tools}
          onChange={(v) => updateActionPlan(node.id, { tools: v })}
          placeholder={t('placeholder_tools')}
        />
      </Field>

      <Field label={t('field_kpi')}>
        <Input
          value={plan.kpi}
          onChange={(v) => updateActionPlan(node.id, { kpi: v })}
          placeholder={t('placeholder_kpi')}
        />
      </Field>

      <Field label={t('field_deadline')}>
        <input
          type="date"
          value={plan.deadline || ''}
          onChange={(e) => updateActionPlan(node.id, { deadline: e.target.value })}
          className="w-full px-3 py-2 text-[13px] rounded-lg"
        />
      </Field>

      <Field label={t('field_exec_status')}>
        <Select
          value={plan.executionStatus || 'pending'}
          onChange={(v) => updateActionPlan(node.id, { executionStatus: v })}
          options={execOptions}
        />
      </Field>
    </div>
  );
}

// ── Comments Tab ──────────────────────────────────────────────────────────────
function CommentsTab({ node, t }) {
  const { addComment, deleteComment } = useStore();
  const [draft, setDraft] = useState('');
  const comments = node.data.comments || [];

  const submit = () => {
    if (!draft.trim()) return;
    addComment(node.id, draft.trim());
    setDraft('');
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('uk-UA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 mb-4" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        {comments.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare size={28} className="text-slate-700 mx-auto mb-2" />
            <p className="text-[12px] text-slate-600">{t('notes_empty')}</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="group p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-indigo-400">{c.author}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-600">{formatDate(c.createdAt)}</span>
                  <button
                    onClick={() => deleteComment(node.id, c.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-all"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed">{c.text}</p>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 border-t border-white/[0.05] pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) submit(); }}
          placeholder={t('notes_placeholder')}
          rows={2}
          className="flex-1 px-3 py-2 text-[12px] rounded-lg resize-none"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white transition-colors self-end"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main Right Panel ──────────────────────────────────────────────────────────
export default function RightPanel() {
  const { nodes, selectedNodeId, setSelectedNode, deleteNode, duplicateNode, rightTab, setRightTab } = useStore();
  const t = useTranslation();
  const node = nodes.find((n) => n.id === selectedNodeId);

  const TABS = [
    { id: 'details',  labelKey: 'tab_details',  Icon: BookOpen },
    { id: 'context',  labelKey: 'tab_context',  Icon: Lightbulb },
    { id: 'plan',     labelKey: 'tab_plan',     Icon: ClipboardList },
    { id: 'comments', labelKey: 'tab_notes',    Icon: MessageSquare },
    { id: 'agent',    labelKey: 'tab_agent',    Icon: Bot },
  ];

  if (!node) {
    return (
      <aside className="w-80 flex-shrink-0 bg-[#0d0e24] border-l border-white/[0.06] flex flex-col items-center justify-center p-8">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={22} className="text-indigo-400" />
          </div>
          <p className="text-[13px] font-semibold text-slate-300 mb-1">{t('panel_empty_title')}</p>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {t('panel_empty_body')}
          </p>
        </div>
      </aside>
    );
  }

  const cfg = NODE_TYPES_CONFIG[node.data.nodeType] || NODE_TYPES_CONFIG.action;

  return (
    <aside className="w-80 flex-shrink-0 bg-[#0d0e24] border-l border-white/[0.06] flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-2"
        style={{ background: `${cfg.color}10` }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5" style={{ color: cfg.color }}>
            {t(NODE_TYPE_KEYS[node.data.nodeType]) || cfg.label}
          </p>
          <p className="text-[13px] font-semibold text-white truncate">{node.data.label}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => duplicateNode(node.id, ' ' + t('node_copy_suffix'))}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            title={t('panel_btn_duplicate')}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => deleteNode(node.id)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={t('panel_btn_delete')}
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setSelectedNode(null)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.05] overflow-x-auto flex-shrink-0">
        {TABS.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            onClick={() => setRightTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
              rightTab === id
                ? id === 'agent'
                  ? 'text-violet-400 border-b-2 border-violet-400'
                  : 'text-indigo-400 border-b-2 border-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={11} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {rightTab === 'details'  && <DetailsTab  node={node} t={t} />}
        {rightTab === 'context'  && <ContextTab  node={node} t={t} />}
        {rightTab === 'plan'     && <PlanTab     node={node} t={t} />}
        {rightTab === 'comments' && <CommentsTab node={node} t={t} />}
        {rightTab === 'agent'    && <AgentTab    node={node} />}
      </div>
    </aside>
  );
}
