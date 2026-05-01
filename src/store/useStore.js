import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { INITIAL_NODES, INITIAL_EDGES, NODE_TYPES_CONFIG } from '../data/mockData';

const uid = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const pid = () => `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const BLANK_PRODUCT = { name: '', description: '', audience: '', countries: [], budget: '', goal: 'traffic' };

const snapshotActive = (s) => {
  if (!s.activeProjectId) return s.projects;
  return s.projects.map((p) =>
    p.id === s.activeProjectId
      ? { ...p, nodes: s.nodes, edges: s.edges, productInfo: s.productInfo, aiSuggestions: s.aiSuggestions, canvasBg: s.canvasBg, trafficSources: s.trafficSources, customTrafficSources: s.customTrafficSources, hiddenSourceIds: s.hiddenSourceIds }
      : p
  );
};

const makeNodeData = (nodeType) => ({
  label: `New ${NODE_TYPES_CONFIG[nodeType]?.label || 'Node'}`,
  nodeType,
  status: 'todo',
  priority: 'medium',
  color: NODE_TYPES_CONFIG[nodeType]?.color || '#6366f1',
  description: '',
  context: { why: '', product: '', audience: '', expectedResult: '' },
  actionPlan: { todo: '', tools: '', kpi: '', deadline: '', executionStatus: 'pending' },
  comments: [],
});

export const useStore = create(
  persist(
    (set, get) => ({
      // ── Projects ───────────────────────────────────────────────────────────
      projects: [],
      activeProjectId: null,

      initProjects: () => {
        set((s) => {
          if (s.projects.length === 0) {
            const id = pid();
            return {
              projects: [{
                id,
                name: s.productInfo?.name || 'Проект 1',
                nodes: s.nodes,
                edges: s.edges,
                productInfo: s.productInfo,
                aiSuggestions: null,
                canvasBg: s.canvasBg,
                trafficSources: s.trafficSources,
                createdAt: new Date().toISOString(),
              }],
              activeProjectId: id,
            };
          }
          return {};
        });
      },

      createProject: () => {
        set((s) => {
          const saved = snapshotActive(s);
          const id = pid();
          const name = `Проект ${saved.length + 1}`;
          return {
            projects: [...saved, {
              id, name,
              nodes: INITIAL_NODES,
              edges: INITIAL_EDGES,
              productInfo: { ...BLANK_PRODUCT },
              aiSuggestions: null,
              canvasBg: '#070818',
              trafficSources: [],
              customTrafficSources: [],
              hiddenSourceIds: [],
              createdAt: new Date().toISOString(),
            }],
            activeProjectId: id,
            nodes: INITIAL_NODES,
            edges: INITIAL_EDGES,
            productInfo: { ...BLANK_PRODUCT },
            aiSuggestions: null,
            canvasBg: '#070818',
            trafficSources: [],
            customTrafficSources: [],
            hiddenSourceIds: [],
            selectedNodeId: null,
            showSetup: true,
          };
        });
      },

      switchProject: (id) => {
        set((s) => {
          if (s.activeProjectId === id) return {};
          const saved = snapshotActive(s);
          const target = saved.find((p) => p.id === id);
          if (!target) return {};
          return {
            projects: saved,
            activeProjectId: id,
            nodes: target.nodes || [],
            edges: target.edges || [],
            productInfo: target.productInfo || { ...BLANK_PRODUCT },
            aiSuggestions: target.aiSuggestions || null,
            canvasBg: target.canvasBg || '#070818',
            trafficSources: target.trafficSources || [],
            customTrafficSources: target.customTrafficSources || [],
            hiddenSourceIds: target.hiddenSourceIds || [],
            selectedNodeId: null,
            showSetup: false,
            activeView: 'map',
          };
        });
      },

      deleteProject: (id) => {
        set((s) => {
          if (s.projects.length <= 1) return {};
          const remaining = s.projects.filter((p) => p.id !== id);
          if (s.activeProjectId !== id) return { projects: remaining };
          const target = remaining[0];
          return {
            projects: remaining,
            activeProjectId: target.id,
            nodes: target.nodes || [],
            edges: target.edges || [],
            productInfo: target.productInfo || { ...BLANK_PRODUCT },
            aiSuggestions: target.aiSuggestions || null,
            canvasBg: target.canvasBg || '#070818',
            trafficSources: target.trafficSources || [],
            customTrafficSources: target.customTrafficSources || [],
            hiddenSourceIds: target.hiddenSourceIds || [],
            selectedNodeId: null,
          };
        });
      },

      renameProject: (id, name) => {
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) }));
      },

      // ── React Flow state ───────────────────────────────────────────────────
      nodes: INITIAL_NODES,
      edges: INITIAL_EDGES,

      onNodesChange: (changes) =>
        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

      onEdgesChange: (changes) =>
        set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

      onConnect: (connection) =>
        set((s) => ({
          edges: addEdge(
            {
              ...connection,
              type: 'custom',
              animated: false,
              data: { edgeStyle: 'sequence', pathType: 'smoothstep' },
            },
            s.edges
          ),
        })),

      // ── Edge CRUD ──────────────────────────────────────────────────────────
      updateEdge: (id, patch) =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === id
              ? {
                  ...e,
                  animated: patch.animated !== undefined ? patch.animated : e.animated,
                  data: { ...(e.data || {}), ...patch },
                }
              : e
          ),
        })),

      deleteEdge: (id) =>
        set((s) => ({
          edges: s.edges.filter((e) => e.id !== id),
        })),

      // ── Node CRUD ──────────────────────────────────────────────────────────
      addNode: (nodeType, position, extraData = {}) => {
        const id = uid();
        const base = makeNodeData(nodeType);
        const node = {
          id,
          type: 'custom',
          position,
          data: {
            ...base,
            ...extraData,
            context: { ...base.context, ...(extraData.context || {}) },
            actionPlan: { ...base.actionPlan, ...(extraData.actionPlan || {}) },
          },
        };
        set((s) => ({ nodes: [...s.nodes, node], selectedNodeId: id }));
        return id;
      },

      updateNodeData: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
        })),

      updateContext: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, context: { ...n.data.context, ...patch } } }
              : n
          ),
        })),

      updateActionPlan: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, actionPlan: { ...n.data.actionPlan, ...patch } } }
              : n
          ),
        })),

      deleteNode: (id) =>
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        })),

      duplicateNode: (id, copySuffix = ' (copy)') => {
        const src = get().nodes.find((n) => n.id === id);
        if (!src) return;
        const newId = uid();
        const node = {
          id: newId,
          type: src.type,
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          data: {
            ...JSON.parse(JSON.stringify(src.data)),
            label: src.data.label + copySuffix,
            comments: [],
          },
        };
        set((s) => ({ nodes: [...s.nodes, node], selectedNodeId: newId }));
      },

      // ── Comments ───────────────────────────────────────────────────────────
      addComment: (nodeId, text) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    comments: [
                      ...(n.data.comments || []),
                      { id: uid(), text, createdAt: new Date().toISOString(), author: 'You' },
                    ],
                  },
                }
              : n
          ),
        })),

      deleteComment: (nodeId, commentId) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    comments: (n.data.comments || []).filter((c) => c.id !== commentId),
                  },
                }
              : n
          ),
        })),

      // ── UI state ───────────────────────────────────────────────────────────
      selectedNodeId: null,
      setSelectedNode: (id) => set({ selectedNodeId: id }),

      activeView: 'map',
      setActiveView: (v) => set({ activeView: v }),

      rightTab: 'details',
      setRightTab: (t) => set({ rightTab: t }),

      showSetup: true,
      setShowSetup: (v) => set({ showSetup: v }),

      showStrategies: false,
      setShowStrategies: (v) => set({ showStrategies: v }),

      // ── Canvas background ──────────────────────────────────────────────────
      canvasBg: '#070818',
      setCanvasBg: (bg) => set({ canvasBg: bg }),

      // ── Product info ───────────────────────────────────────────────────────
      productInfo: { name: '', description: '', audience: '', countries: [], budget: '', goal: 'traffic' },
      setProductInfo: (patch) =>
        set((s) => ({ productInfo: { ...s.productInfo, ...patch } })),

      // ── Traffic Research ───────────────────────────────────────────────────
      trafficSources: [],
      setTrafficSources: (sources) => set({ trafficSources: sources }),
      trafficQuery: '',
      setTrafficQuery: (q) => set({ trafficQuery: q }),
      trafficFilter: 'all',
      setTrafficFilter: (f) => set({ trafficFilter: f }),

      customTrafficSources: [],
      addCustomSource: (source) =>
        set((s) => ({ customTrafficSources: [...s.customTrafficSources, { ...source, id: `custom_${Date.now()}`, custom: true }] })),
      deleteCustomSource: (id) =>
        set((s) => ({ customTrafficSources: s.customTrafficSources.filter((src) => src.id !== id) })),

      hiddenSourceIds: [],
      hideSource: (id) =>
        set((s) => ({ hiddenSourceIds: s.hiddenSourceIds.includes(id) ? s.hiddenSourceIds : [...s.hiddenSourceIds, id] })),
      restoreAllSources: () => set({ hiddenSourceIds: [] }),

      // ── Language ───────────────────────────────────────────────────────────
      language: 'en',
      setLanguage: (lang) => set({ language: lang }),

      // ── AI ─────────────────────────────────────────────────────────────────
      aiSuggestions: null,
      setAiSuggestions: (s) => set({ aiSuggestions: s }),
      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: v }),

      // ── Agent (not persisted) ──────────────────────────────────────────────
      agentResults: {},   // { [nodeId]: result }
      agentRunningId: null,
      setAgentResult: (nodeId, result) =>
        set((s) => ({ agentResults: { ...s.agentResults, [nodeId]: result } })),
      setAgentRunningId: (id) => set({ agentRunningId: id }),

      // ── Map generation ─────────────────────────────────────────────────────
      generateMap: (productInfo, aiNodes = null, aiEdges = null) =>
        set((s) => {
          const nodes = aiNodes || INITIAL_NODES;
          const edges = aiEdges || INITIAL_EDGES;
          return {
            productInfo,
            nodes,
            edges,
            selectedNodeId: null,
            showSetup: false,
            projects: s.activeProjectId
              ? s.projects.map((p) =>
                  p.id === s.activeProjectId
                    ? { ...p, name: productInfo.name || p.name, nodes, edges, productInfo }
                    : p
                )
              : s.projects,
          };
        }),

      resetMap: () =>
        set({
          nodes: INITIAL_NODES,
          edges: INITIAL_EDGES,
          selectedNodeId: null,
          aiSuggestions: null,
          trafficSources: [],
        }),

      loadStrategy: ({ nodes, edges, productInfo, aiSuggestions }) =>
        set({
          nodes: nodes || [],
          edges: edges || [],
          productInfo: productInfo || {},
          aiSuggestions: aiSuggestions || null,
          selectedNodeId: null,
          showSetup: false,
          activeView: 'map',
        }),
    }),
    {
      name: 'tsm-store-v1',
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        productInfo: s.productInfo,
        trafficSources: s.trafficSources,
        customTrafficSources: s.customTrafficSources,
        hiddenSourceIds: s.hiddenSourceIds,
        showSetup: s.showSetup,
        language: s.language,
        canvasBg: s.canvasBg,
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
    }
  )
);
