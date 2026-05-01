import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  getStraightPath,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';

// ─── Edge style catalogue ─────────────────────────────────────────────────────
export const EDGE_STYLES = {
  sequence: {
    label: 'Sequence',
    hint: 'A → B (default order)',
    color: '#64748b',
    strokeWidth: 2,
    strokeDasharray: null,
    animated: false,
    emoji: '→',
  },
  flow: {
    label: 'Data Flow',
    hint: 'Animated — active movement',
    color: '#6366f1',
    strokeWidth: 2.5,
    strokeDasharray: null,
    animated: true,
    emoji: '⟶',
  },
  dependency: {
    label: 'Dependency',
    hint: 'B requires A first',
    color: '#f59e0b',
    strokeWidth: 2,
    strokeDasharray: '8 4',
    animated: false,
    emoji: '⤳',
  },
  weak: {
    label: 'Weak Link',
    hint: 'Loose / optional connection',
    color: '#334155',
    strokeWidth: 1.5,
    strokeDasharray: '3 6',
    animated: false,
    emoji: '⋯',
  },
  triggers: {
    label: 'Triggers',
    hint: 'A directly starts B',
    color: '#22c55e',
    strokeWidth: 2.5,
    strokeDasharray: null,
    animated: true,
    emoji: '⚡',
  },
  blocks: {
    label: 'Blocks',
    hint: 'A is blocking B',
    color: '#ef4444',
    strokeWidth: 2,
    strokeDasharray: '5 4',
    animated: false,
    emoji: '✕',
  },
};

// ─── Path calculators ─────────────────────────────────────────────────────────
function getPath(pathType, props) {
  if (pathType === 'straight') return getStraightPath(props);
  if (pathType === 'bezier')   return getBezierPath(props);
  return getSmoothStepPath({ ...props, borderRadius: 16 });
}

// ─── Custom Edge component ────────────────────────────────────────────────────
export default function CustomEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data = {},
  selected,
  markerEnd,
}) {
  const { updateEdge, deleteEdge } = useStore();

  const styleCfg = EDGE_STYLES[data.edgeStyle] || EDGE_STYLES.sequence;
  const color = data.color ?? styleCfg.color;

  const [edgePath, labelX, labelY] = getPath(data.pathType || 'smoothstep', {
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const strokeDash = data.strokeDasharray !== undefined
    ? data.strokeDasharray
    : styleCfg.strokeDasharray;

  const glow = selected
    ? `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 2px ${color})`
    : undefined;

  return (
    <>
      {/* SVG marker def for colored arrowhead */}
      <svg style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}>
        <defs>
          <marker
            id={`arrow-${id}`}
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M0,0 L0,6 L9,3 z"
              fill={color}
              opacity={selected ? 1 : 0.8}
            />
          </marker>
        </defs>
      </svg>

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#arrow-${id})`}
        style={{
          stroke: color,
          strokeWidth: selected ? styleCfg.strokeWidth + 0.5 : styleCfg.strokeWidth,
          strokeDasharray: strokeDash ?? undefined,
          filter: glow,
          opacity: selected ? 1 : 0.75,
          transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
        }}
      />

      {/* Floating toolbar — visible when edge is selected */}
      <EdgeLabelRenderer>
        {selected && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 20,
            }}
            className="nodrag nopan"
          >
            <div
              className="flex items-center gap-1 px-1.5 py-1.5 rounded-2xl shadow-2xl"
              style={{
                background: '#0d0e24',
                border: `1px solid ${color}40`,
                boxShadow: `0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px ${color}25`,
              }}
            >
              {/* Style buttons */}
              {Object.entries(EDGE_STYLES).map(([key, s]) => {
                const active = (data.edgeStyle || 'sequence') === key;
                return (
                  <button
                    key={key}
                    title={`${s.label} — ${s.hint}`}
                    onClick={() => updateEdge(id, { edgeStyle: key, color: s.color, animated: s.animated })}
                    className="flex flex-col items-center justify-center w-9 h-9 rounded-xl transition-all duration-150"
                    style={{
                      background: active ? `${s.color}22` : 'transparent',
                      border: active ? `1px solid ${s.color}60` : '1px solid transparent',
                    }}
                  >
                    <span className="text-[13px] leading-none mb-0.5" style={{ color: s.color }}>
                      {s.emoji}
                    </span>
                    <span className="text-[8px] leading-none font-semibold" style={{ color: active ? s.color : '#475569' }}>
                      {s.label.split(' ')[0]}
                    </span>
                  </button>
                );
              })}

              {/* Divider */}
              <div className="w-px h-6 bg-white/10 mx-0.5 flex-shrink-0" />

              {/* Path type */}
              <div className="flex flex-col gap-1">
                {[
                  { id: 'smoothstep', label: '⌐' },
                  { id: 'bezier',     label: '∫' },
                  { id: 'straight',   label: '—' },
                ].map((pt) => (
                  <button
                    key={pt.id}
                    title={`Path: ${pt.id}`}
                    onClick={() => updateEdge(id, { pathType: pt.id })}
                    className="w-6 h-5 rounded-md text-[11px] font-bold transition-all"
                    style={{
                      background: (data.pathType || 'smoothstep') === pt.id ? '#ffffff15' : 'transparent',
                      color: (data.pathType || 'smoothstep') === pt.id ? '#e2e8f0' : '#475569',
                    }}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div className="w-px h-6 bg-white/10 mx-0.5 flex-shrink-0" />

              {/* Delete */}
              <button
                onClick={() => deleteEdge(id)}
                title="Delete connection"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {/* Label below toolbar */}
            <div className="text-center mt-1.5">
              <span
                className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: `${color}22`, color }}
              >
                {styleCfg.label} · {styleCfg.hint}
              </span>
            </div>
          </div>
        )}

        {/* Hover dot (always present, tiny, to hint clickability) */}
        {!selected && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div
              className="w-4 h-4 rounded-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              style={{ background: `${color}30`, border: `1px solid ${color}60` }}
              title={`${styleCfg.label} — click edge to edit`}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
