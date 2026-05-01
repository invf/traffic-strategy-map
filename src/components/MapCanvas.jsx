import React, { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store/useStore';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';
import { NODE_TYPES_CONFIG } from '../data/mockData';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

export default function MapCanvas() {
  const wrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();
  const [trafficDragOver, setTrafficDragOver] = useState(false);

  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, setSelectedNode,
    canvasBg,
  } = useStore();

  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const onEdgeClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const getFlowPosition = useCallback((e) => {
    const bounds = wrapper.current?.getBoundingClientRect();
    return screenToFlowPosition({
      x: e.clientX - (bounds?.left ?? 0),
      y: e.clientY - (bounds?.top ?? 0),
    });
  }, [screenToFlowPosition]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const isTraffic = e.dataTransfer.types.includes('application/tsm-traffic-source');
    setTrafficDragOver(isTraffic);
  }, []);

  const onDragLeave = useCallback((e) => {
    // Only clear when leaving the canvas entirely (not entering a child element)
    if (!wrapper.current?.contains(e.relatedTarget)) {
      setTrafficDragOver(false);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setTrafficDragOver(false);

    const position = getFlowPosition(e);

    // Traffic source drop
    const trafficJson = e.dataTransfer.getData('application/tsm-traffic-source');
    if (trafficJson) {
      try {
        const src = JSON.parse(trafficJson);
        addNode('channel', position, {
          label: src.platform,
          color: src.color,
          description: src.recommendedAction,
          context: {
            why: `Potential: ${src.potential} · Difficulty: ${src.difficulty}`,
            product: '',
            audience: src.audience,
            expectedResult: src.estimatedTraffic,
          },
        });
      } catch {}
      return;
    }

    // Generic node type drop
    const nodeType = e.dataTransfer.getData('application/tsm-nodetype');
    if (nodeType) {
      const label = e.dataTransfer.getData('application/tsm-label');
      addNode(nodeType, position, label ? { label } : {});
    }
  }, [getFlowPosition, addNode]);

  const miniMapNodeColor = (node) =>
    NODE_TYPES_CONFIG[node.data?.nodeType]?.color || '#6366f1';

  return (
    <div ref={wrapper} className="w-full h-full relative" style={{ background: canvasBg }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'custom',
          animated: false,
          data: { edgeStyle: 'sequence', pathType: 'smoothstep' },
        }}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2.5, strokeDasharray: '6 3' }}
        connectionLineType="smoothstep"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
        <Controls position="bottom-right" style={{ marginBottom: 16, marginRight: 16 }} />
        <MiniMap
          nodeColor={miniMapNodeColor}
          maskColor="rgba(7,8,24,0.75)"
          style={{ background: '#111228', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10 }}
          position="bottom-left"
        />
      </ReactFlow>

      {/* Drop overlay — shown only when dragging a traffic source */}
      {trafficDragOver && (
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
            border: '2px dashed rgba(6,182,212,0.7)',
            borderRadius: 12,
            background: 'rgba(6,182,212,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'rgba(6,182,212,0.12)',
            border: '1px solid rgba(6,182,212,0.35)',
            borderRadius: 12,
            padding: '10px 20px',
            backdropFilter: 'blur(8px)',
          }}>
            <p style={{ color: '#06b6d4', fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>
              Drop to add channel block
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
