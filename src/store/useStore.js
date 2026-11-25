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

// AUTH-004 - the canvas fields a cloud project's "is this saved?" check
// (isDirty, below) and a cloud load/save both snapshot/compare. Kept as
// one small helper so the two always agree on exactly what counts.
const canvasSnapshot = (s) => JSON.stringify({ nodes: s.nodes, edges: s.edges, productInfo: s.productInfo, aiSuggestions: s.aiSuggestions });

// AUTH-004 - shared by clearCloudProjects/removeCloudProject: when the
// cloud project that was active disappears (logout, or its own
// deletion), fall back to the first Local Draft (same "first remaining
// entry" convention deleteProject already uses below), or a blank
// canvas if there are none - never leaves activeProjectSource pointing
// at a cloud project that's no longer in cloudProjects.
const fallbackToLocal = (s) => {
  const fallback = s.projects[0] || null;
  return {
    activeProjectSource: 'local',
    activeProjectId: fallback ? fallback.id : null,
    activeCloudUpdatedAt: null,
    lastSyncedSnapshot: null,
    nodes: fallback?.nodes || INITIAL_NODES,
    edges: fallback?.edges || INITIAL_EDGES,
    productInfo: fallback?.productInfo || { ...BLANK_PRODUCT },
    aiSuggestions: fallback?.aiSuggestions || null,
    canvasBg: fallback?.canvasBg || '#070818',
    trafficSources: fallback?.trafficSources || [],
    customTrafficSources: fallback?.customTrafficSources || [],
    hiddenSourceIds: fallback?.hiddenSourceIds || [],
    selectedNodeId: null,
    showSetup: false,
    activeView: 'map',
  };
};

// ADV-004: dependencies/sourceDecisionRef/locallyEdited and
// actionPlan.actionItems/plannedTimeframe - see mockData.js's nd() for why
// these default to empty/null rather than undefined. A node created here
// (by the user, via the UI) always has sourceDecisionRef: null - exactly
// what makes it permanently exempt from reconcileImportedGraph's
// reconciliation (src/utils/strategyDecisionMapping.js, driven by
// launchStrategyImportFlow.js), full stop.
const makeNodeData = (nodeType) => ({
  label: `New ${NODE_TYPES_CONFIG[nodeType]?.label || 'Node'}`,
  nodeType,
  status: 'todo',
  priority: 'medium',
  color: NODE_TYPES_CONFIG[nodeType]?.color || '#6366f1',
  description: '',
  context: { why: '', product: '', audience: '', expectedResult: '' },
  actionPlan: { todo: '', tools: '', kpi: '', deadline: '', executionStatus: 'pending', actionItems: [], plannedTimeframe: null },
  comments: [],
  dependencies: [],
  sourceDecisionRef: null,
  locallyEdited: false,
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

      // ── Cloud Projects (AUTH-004) ────────────────────────────────────────────
      // Fully parallel to the Local Draft state/actions above, never
      // mixing with them: `projects`/`activeProjectId` keep meaning
      // "Local Draft" exactly as before this feature. `activeProjectId`
      // doubles as the active CLOUD project's real Postgres UUID only
      // when activeProjectSource === 'cloud' (resolved by
      // getActiveProject, below) - this avoids a second parallel id
      // field while keeping the two id spaces (ad hoc `proj_...` vs
      // real UUIDs) unambiguous by construction (they never overlap).
      //
      // cloudProjects/activeProjectSource/activeCloudUpdatedAt/
      // lastSyncedSnapshot are deliberately NOT in this store's
      // `partialize` below - they stay in-memory only, re-hydrated
      // fresh from the server on every sign-in (see
      // src/hooks/useCloudProjectsSync.js). That's what makes "never
      // display another account's cached private projects" true by
      // construction rather than by remembering to clear a cache.
      cloudProjects: [],
      activeProjectSource: 'local',
      activeCloudUpdatedAt: null,
      lastSyncedSnapshot: null,

      getActiveProject: () => {
        const s = get();
        if (s.activeProjectSource === 'cloud') {
          return s.cloudProjects.find((p) => p.id === s.activeProjectId) || null;
        }
        return s.projects.find((p) => p.id === s.activeProjectId) || null;
      },

      // Whether the live canvas differs from what was last loaded/saved
      // for the CURRENT cloud project - compared lazily on demand
      // (before a switch/logout/close) rather than tracked on every
      // node/edge mutation, so this needed no changes to the dozens of
      // existing canvas-mutating actions above. Local Drafts have no
      // separate "saved" state to compare against (the canvas IS their
      // storage, same as always), so this is only meaningful while
      // activeProjectSource === 'cloud'.
      isDirty: () => {
        const s = get();
        if (s.activeProjectSource !== 'cloud' || s.lastSyncedSnapshot == null) return false;
        return canvasSnapshot(s) !== s.lastSyncedSnapshot;
      },

      // Wholesale replace, never merge - called once per sign-in and
      // once per account switch (see useCloudProjectsSync.js). A merge
      // here is exactly the bug that would let a previous account's
      // cached project linger after switching accounts.
      hydrateCloudProjects: (list) => set({ cloudProjects: Array.isArray(list) ? list : [] }),

      // Called on sign-out. Never deletes anything server-side - purely
      // clears this tab's own in-memory list and, if a cloud project was
      // the active one, falls back to a Local Draft so no private cloud
      // content keeps rendering (or keeps getting persisted to
      // localStorage) after the session ends.
      clearCloudProjects: () =>
        set((s) => (s.activeProjectSource !== 'cloud' ? { cloudProjects: [] } : { cloudProjects: [], ...fallbackToLocal(s) })),

      // Called after a successful create or update - the id is either a
      // brand-new UUID (create / "Save as New") or the same one being
      // updated in place ("Save"); either way this is the one place
      // that (re)establishes "this cloud project is now the saved,
      // active one," atomically with a fresh dirty-check baseline.
      setActiveCloudProject: (id, updatedAt) =>
        set((s) => ({
          activeProjectId: id,
          activeProjectSource: 'cloud',
          activeCloudUpdatedAt: updatedAt ?? null,
          lastSyncedSnapshot: canvasSnapshot(s),
        })),

      addCloudProject: (project) => set((s) => ({ cloudProjects: [project, ...s.cloudProjects] })),

      patchCloudProjectLocal: (id, patch) =>
        set((s) => ({ cloudProjects: s.cloudProjects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      removeCloudProject: (id) =>
        set((s) => {
          const cloudProjects = s.cloudProjects.filter((p) => p.id !== id);
          if (s.activeProjectId !== id || s.activeProjectSource !== 'cloud') return { cloudProjects };
          return { cloudProjects, ...fallbackToLocal(s) };
        }),

      // ── ADV-003: ADVESER Projects (adveser_core.projects, shared with
      // Launch Studio) ────────────────────────────────────────────────────
      // Deliberately a SEPARATE, parallel slice from cloudProjects/
      // activeProjectSource/activeProjectId above - an ADVESER Project is
      // NOT a cloud strategy. Selecting one here is a pure CONTEXT choice
      // (which shared project this browser tab is currently "in," for
      // cross-product navigation/identity) - it never loads, creates, or
      // modifies a strategy by itself; that stays entirely under the
      // existing projects/cloudProjects mechanism above, untouched. Not in
      // `partialize` below, same reasoning as cloudProjects: re-hydrated
      // fresh per sign-in (see src/hooks/useAdveserProjectsSync.js), never
      // cached across accounts.
      adveserProjects: [],
      activeAdveserProjectId: null,

      hydrateAdveserProjects: (list) => set({ adveserProjects: Array.isArray(list) ? list : [] }),

      clearAdveserProjects: () => set({ adveserProjects: [], activeAdveserProjectId: null }),

      // The ONLY way activeAdveserProjectId is ever set. Deliberately
      // requires the id to already be present in `adveserProjects` (the
      // server-verified, membership-scoped list) - this is what makes "a
      // project UUID in a URL is never treated as authorization" true by
      // construction: a caller reading an incoming URL param must still
      // look it up in adveserProjects first (see useAdveserProjectsSync.js)
      // and this setter silently refuses an id that isn't actually there,
      // rather than trusting whatever string it's handed.
      setActiveAdveserProject: (id) =>
        set((s) => (id != null && !s.adveserProjects.some((p) => p.id === id) ? {} : { activeAdveserProjectId: id })),

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

      // ADV-004: any edit to an import-sourced node (one with a real
      // sourceDecisionRef) through the ordinary editing UI marks it
      // locallyEdited - the one flag reconcileImportedGraph's
      // reconciliation (src/utils/strategyDecisionMapping.js) reads to
      // decide "content is still import-owned" vs "never touch this
      // again automatically." A hand-created node (sourceDecisionRef
      // null) is simply never affected by this - locallyEdited stays
      // false/irrelevant for it, since nothing ever reads it without a
      // sourceDecisionRef to match on in the first place.
      updateNodeData: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, ...patch, locallyEdited: n.data.sourceDecisionRef ? true : n.data.locallyEdited } }
              : n
          ),
        })),

      updateContext: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    context: { ...n.data.context, ...patch },
                    locallyEdited: n.data.sourceDecisionRef ? true : n.data.locallyEdited,
                  },
                }
              : n
          ),
        })),

      updateActionPlan: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    actionPlan: { ...n.data.actionPlan, ...patch },
                    locallyEdited: n.data.sourceDecisionRef ? true : n.data.locallyEdited,
                  },
                }
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

      accountUrls: {},
      setAccountUrl: (id, url) =>
        set((s) => ({ accountUrls: { ...s.accountUrls, [id]: url } })),

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

      // AUTH-004: extended to accept the cloud strategy's own id/updatedAt
      // and set them ATOMICALLY with the canvas fields, in this one
      // set() call - this is the fix for the ticket's bug #5 ("loading
      // a cloud strategy updates the canvas but not the active project
      // identity"). `id` omitted keeps this a Local Draft load (used
      // nowhere today, but kept harmless rather than assumed unreachable).
      loadStrategy: ({ id, nodes, edges, productInfo, aiSuggestions, updatedAt }) =>
        set({
          nodes: nodes || [],
          edges: edges || [],
          productInfo: productInfo || {},
          aiSuggestions: aiSuggestions || null,
          selectedNodeId: null,
          showSetup: false,
          activeView: 'map',
          activeProjectId: id ?? null,
          activeProjectSource: id ? 'cloud' : 'local',
          activeCloudUpdatedAt: id ? (updatedAt ?? null) : null,
          lastSyncedSnapshot: JSON.stringify({
            nodes: nodes || [],
            edges: edges || [],
            productInfo: productInfo || {},
            aiSuggestions: aiSuggestions || null,
          }),
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
        accountUrls: s.accountUrls,
      }),
    }
  )
);
