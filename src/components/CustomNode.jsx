import React, { memo } from 'react';
import { Handle, Position, useViewport } from '@xyflow/react';
import {
  Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2,
  ArrowRightCircle, CheckCircle2, Clock, Ban, Circle,
  MessageSquare,
} from 'lucide-react';
import { NODE_TYPES_CONFIG, STATUS_CONFIG, PRIORITY_CONFIG } from '../data/mockData';

const ICON_MAP = {
  Lightbulb, Radio, FlaskConical, Zap, TestTube, BarChart2, ArrowRightCircle,
};

const StatusDot = ({ status }) => {
  const s = STATUS_CONFIG[status];
  const m = {
    done:        <CheckCircle2 size={9} style={{ color: s?.color }} />,
    blocked:     <Ban          size={9} style={{ color: s?.color }} />,
    'in-progress':<Clock       size={9} style={{ color: s?.color }} />,
    todo:        <Circle       size={9} style={{ color: s?.color }} />,
  };
  return m[status] || m.todo;
};

function hexToRgba(hex, alpha) {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return `rgba(99,102,241,${alpha})`;
  }
}

const NODE_CSS = `
  @keyframes tsm-breathe {
    0%, 100% { opacity: 0.55; }
    50%       { opacity: 1;    }
  }
  @keyframes tsm-glow-pulse {
    0%, 100% { opacity: 0.6; }
    50%       { opacity: 1;   }
  }

  .tsm-node-wrap {
    transition:
      transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.28s ease,
      filter     0.28s ease !important;
    will-change: transform, filter;
    transform-origin: center center;
  }
  .tsm-node-wrap:hover {
    transform: scale(1.07) translateY(-4px) !important;
    filter: brightness(1.12) !important;
    z-index: 999;
  }
  .react-flow__node.dragging .tsm-node-wrap {
    transform: none !important;
    filter: none !important;
    transition: none !important;
  }
  .tsm-shimmer {
    position: absolute; inset: 0; border-radius: inherit;
    background: linear-gradient(118deg, transparent 25%, rgba(255,255,255,0.07) 50%, transparent 75%);
    opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
  }
  .tsm-node-wrap:hover .tsm-shimmer { opacity: 1; }
  .tsm-top-hl {
    position: absolute; top: 0; left: 18%; right: 18%;
    height: 1px; border-radius: 99px; pointer-events: none;
  }
  .tsm-corner-glow {
    position: absolute; top: -24px; right: -24px;
    width: 88px; height: 88px; border-radius: 50%;
    pointer-events: none; filter: blur(18px);
  }
  .tsm-bar-glow {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 3px; border-radius: 0 0 18px 18px;
    pointer-events: none; animation: tsm-breathe 3s ease-in-out infinite;
  }
  .tsm-node-wrap.tsm-selected {
    animation: tsm-glow-pulse 2.2s ease-in-out infinite;
  }
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = NODE_CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

// ── Shared handle pair ────────────────────────────────────────────────────────
function Handles({ color }) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="tsm-handle"
        style={{ background: color, top: -6 }}
        title="▲ Вхід — підключити стрілку сюди"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="tsm-handle"
        style={{ background: color, bottom: -6 }}
        title="▼ Вихід — перетягніть звідси до іншого блоку"
      />
    </>
  );
}

// ── MICRO mode (zoom < 0.3) — just a colored chip with icon ──────────────────
function MicroNode({ color, Icon, selected }) {
  const shadow = selected
    ? `0 0 0 2px ${color}, 0 0 16px ${hexToRgba(color, 0.6)}`
    : `0 2px 10px rgba(0,0,0,0.6)`;
  return (
    <div
      className={`tsm-node-wrap${selected ? ' tsm-selected' : ''}`}
      style={{ position: 'relative', cursor: 'pointer' }}
    >
      <Handles color={color} />
      <div style={{
        width: 52, height: 52,
        borderRadius: 14,
        background: `linear-gradient(145deg, ${hexToRgba(color, 0.55)}, ${hexToRgba(color, 0.30)})`,
        border: `2px solid ${selected ? color : hexToRgba(color, 0.55)}`,
        boxShadow: shadow,
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={22} style={{ color: '#fff', filter: `drop-shadow(0 0 6px ${hexToRgba(color, 0.9)})` }} />
      </div>
    </div>
  );
}

// ── COMPACT mode (0.3 ≤ zoom < 0.65) — icon + bold label ─────────────────────
function CompactNode({ color, Icon, cfg, data, selected }) {
  const cardShadow = selected
    ? `0 0 0 2px ${color}, 0 0 20px ${hexToRgba(color, 0.4)}, 0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 ${hexToRgba(color, 0.3)}`
    : `0 4px 16px rgba(0,0,0,0.55), inset 0 1px 0 ${hexToRgba(color, 0.18)}`;

  return (
    <div
      className={`tsm-node-wrap${selected ? ' tsm-selected' : ''}`}
      style={{ position: 'relative', minWidth: 172, maxWidth: 220, cursor: 'pointer' }}
    >
      <Handles color={color} />
      <div style={{
        background: `linear-gradient(155deg, ${hexToRgba(color, 0.28)} 0%, ${hexToRgba(color, 0.12)} 40%, rgba(4,5,18,0.90) 100%)`,
        border: `${selected ? 2 : 1.5}px solid ${selected ? color : hexToRgba(color, 0.5)}`,
        boxShadow: cardShadow,
        backdropFilter: 'blur(16px)',
        borderRadius: 16,
        padding: '11px 12px 10px',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div className="tsm-shimmer" />
        <div className="tsm-top-hl" style={{ background: `linear-gradient(90deg, transparent, ${hexToRgba(color, 0.8)}, transparent)` }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Icon badge */}
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(145deg, ${hexToRgba(color, 0.5)}, ${hexToRgba(color, 0.22)})`,
            border: `1.5px solid ${hexToRgba(color, 0.55)}`,
            boxShadow: `0 0 14px ${hexToRgba(color, 0.4)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={17} style={{ color: '#fff', filter: `drop-shadow(0 0 5px ${hexToRgba(color, 0.9)})` }} />
          </div>

          {/* Label — large and bold for readability at low zoom */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13,
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.25,
              margin: 0,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              textShadow: '0 1px 8px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)',
            }}>
              {data.label}
            </p>
            <p style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: color,
              margin: '3px 0 0',
              textShadow: `0 0 8px ${hexToRgba(color, 0.7)}`,
              filter: 'brightness(1.3)',
            }}>
              {cfg.label}
            </p>
          </div>
        </div>

        {/* Slim priority bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5,
          borderRadius: '0 0 16px 16px',
          background: `linear-gradient(90deg, transparent, ${PRIORITY_CONFIG[data.priority]?.color || '#f59e0b'}, transparent)`,
          opacity: 0.85,
          animation: 'tsm-breathe 3s ease-in-out infinite',
        }} />
      </div>
    </div>
  );
}

// ── FULL mode (zoom ≥ 0.65) — complete node ───────────────────────────────────
function FullNode({ color, Icon, cfg, statusCfg, priCfg, data, selected, commentCount }) {
  const cardBg = `linear-gradient(158deg, ${hexToRgba(color, 0.25)} 0%, ${hexToRgba(color, 0.10)} 38%, rgba(4,5,18,0.88) 100%)`;
  const cardShadow = selected
    ? `0 0 0 2px ${color}, 0 0 28px ${hexToRgba(color, 0.45)}, 0 16px 48px rgba(0,0,0,0.65), inset 0 1px 0 ${hexToRgba(color, 0.35)}`
    : `0 4px 16px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.35), inset 0 1px 0 ${hexToRgba(color, 0.2)}`;

  return (
    <div
      className={`tsm-node-wrap${selected ? ' tsm-selected' : ''}`}
      style={{ position: 'relative', minWidth: 196, maxWidth: 236, cursor: 'pointer' }}
    >
      <Handles color={color} />

      <div style={{
        background: cardBg,
        borderColor: selected ? color : hexToRgba(color, 0.5),
        borderWidth: selected ? 2 : 1.5,
        borderStyle: 'solid',
        boxShadow: cardShadow,
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderRadius: 18,
        padding: '13px 13px 11px',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div className="tsm-shimmer" />
        <div className="tsm-top-hl" style={{ background: `linear-gradient(90deg, transparent, ${hexToRgba(color, 0.8)}, transparent)` }} />
        <div className="tsm-corner-glow" style={{ background: hexToRgba(color, 0.2) }} />

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, position: 'relative', zIndex: 1 }}>
          {/* Icon badge */}
          <div style={{
            background: `linear-gradient(145deg, ${hexToRgba(color, 0.48)}, ${hexToRgba(color, 0.20)})`,
            borderRadius: 10, width: 30, height: 30, flexShrink: 0,
            border: `1.5px solid ${hexToRgba(color, 0.55)}`,
            boxShadow: `0 0 14px ${hexToRgba(color, 0.4)}, inset 0 1px 0 ${hexToRgba(color, 0.3)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={15} style={{ color: '#fff', filter: `drop-shadow(0 0 4px ${hexToRgba(color, 0.9)})` }} />
          </div>

          {/* Type label — white pill for contrast */}
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: '#fff',
            background: hexToRgba(color, 0.35),
            border: `1px solid ${hexToRgba(color, 0.45)}`,
            borderRadius: 99,
            padding: '2px 7px',
            lineHeight: 1,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}>
            {cfg.label}
          </span>

          <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <StatusDot status={data.status} />
          </span>
        </div>

        {/* ── Label ── */}
        <p style={{
          fontSize: 14,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.3,
          margin: '0 0 10px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textShadow: '0 1px 8px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,1)',
          position: 'relative',
          zIndex: 1,
        }}>
          {data.label}
        </p>

        {/* ── Footer badges ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          position: 'relative', zIndex: 1,
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 8,
          padding: '5px 7px',
          margin: '0 -1px',
        }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 99,
            background: statusCfg.bg,
            color: statusCfg.color,
            border: `1px solid ${hexToRgba(statusCfg.color, 0.35)}`,
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
            filter: 'brightness(1.15)',
          }}>
            {statusCfg.label}
          </span>

          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: priCfg.color,
            textShadow: `0 0 8px ${hexToRgba(priCfg.color, 0.6)}, 0 1px 4px rgba(0,0,0,0.8)`,
            filter: 'brightness(1.2)',
          }}>
            {priCfg.dot} {priCfg.label}
          </span>

          {commentCount > 0 && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#94a3b8' }}>
              <MessageSquare size={9} />
              {commentCount}
            </span>
          )}
        </div>

        {/* ── Priority glow bar ── */}
        <div className="tsm-bar-glow" style={{
          background: `linear-gradient(90deg, transparent 0%, ${priCfg.color} 40%, ${priCfg.color} 60%, transparent 100%)`,
          boxShadow: `0 0 10px ${hexToRgba(priCfg.color, 0.8)}`,
        }} />
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
const CustomNode = ({ data, selected }) => {
  injectStyles();

  const { zoom } = useViewport();

  const cfg      = NODE_TYPES_CONFIG[data.nodeType] || NODE_TYPES_CONFIG.action;
  const statusCfg = STATUS_CONFIG[data.status]       || STATUS_CONFIG.todo;
  const priCfg   = PRIORITY_CONFIG[data.priority]    || PRIORITY_CONFIG.medium;
  const Icon     = ICON_MAP[cfg.icon] || Zap;
  const color    = data.color || cfg.color;
  const commentCount = (data.comments || []).length;

  if (zoom < 0.3) {
    return <MicroNode color={color} Icon={Icon} selected={selected} />;
  }
  if (zoom < 0.65) {
    return <CompactNode color={color} Icon={Icon} cfg={cfg} data={data} selected={selected} />;
  }
  return (
    <FullNode
      color={color} Icon={Icon} cfg={cfg}
      statusCfg={statusCfg} priCfg={priCfg}
      data={data} selected={selected} commentCount={commentCount}
    />
  );
};

export default memo(CustomNode);
