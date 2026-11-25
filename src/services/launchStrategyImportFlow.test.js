// ADV-004-FIX-2 - launchStrategyImportFlow.js: the Production
// contamination bug and its fix. The PREVIOUS version merged the
// imported package directly into whatever graph happened to be active
// on the canvas, regardless of whether it actually belonged to the
// selected ADVESER project - these tests prove the fixed version never
// does that: it resolves the correct target (no existing strategy ->
// fresh graph; an existing one -> that strategy's own real, fetched
// content) BEFORE touching the canvas at all, and only replaces the
// canvas after persistence has actually succeeded.
//
// Uses the REAL store (useStore.getState/setState, works outside React -
// same convention as useStore.adveserProjects.test.js), mocking only the
// network-touching service calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';

vi.mock('./launchStrategyImport', () => ({ getApprovedStrategyExport: vi.fn() }));
vi.mock('./strategies', () => ({
  findStrategyByProjectId: vi.fn(),
  getStrategy: vi.fn(),
  createStrategy: vi.fn(),
  updateStrategy: vi.fn(),
}));

import { getApprovedStrategyExport } from './launchStrategyImport';
import { findStrategyByProjectId, getStrategy, createStrategy, updateStrategy } from './strategies';
import { importLaunchStrategy } from './launchStrategyImportFlow';

const PKG = {
  schemaVersion: 1,
  market: { facts: [], assumptions: [], unknowns: [] },
  competitors: { facts: [], assumptions: [], unknowns: [] },
  availableResources: { facts: [], assumptions: [], unknowns: [] },
  objectives: [{ id: 'obj-0', statement: 'Grow signups', priority: 'high', justification: { facts: [], assumptions: [] } }],
  channelDecisions: [],
  hypotheses: [],
  actions: [],
  experiments: [],
  recommendationSummary: '',
  generatedFromRevisionId: 'rev-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
};

// A node from a COMPLETELY UNRELATED strategy/graph - never created by
// this import flow, no sourceDecisionRef at all, exactly like a real
// hand-built or differently-sourced node already on the canvas.
function unrelatedNode(id, x = 40, y = 40) {
  return {
    id,
    type: 'custom',
    position: { x, y },
    data: {
      label: 'Unrelated pre-existing node',
      nodeType: 'idea',
      status: 'todo',
      priority: 'medium',
      description: '',
      context: { why: '', product: '', audience: '', expectedResult: '' },
      actionPlan: { todo: '', tools: '', kpi: '', deadline: '', executionStatus: 'pending', actionItems: [], plannedTimeframe: null },
      comments: [],
      dependencies: [],
      sourceDecisionRef: null,
      locallyEdited: false,
    },
  };
}

describe('importLaunchStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ nodes: [], edges: [], productInfo: {}, cloudProjects: [], activeProjectId: null, activeProjectSource: 'local' });
  });

  it('returns status "no-export" and touches nothing else when no approved export exists yet', async () => {
    getApprovedStrategyExport.mockResolvedValue(null);
    const result = await importLaunchStrategy('proj-1', 'My Project');
    expect(result).toEqual({ status: 'no-export' });
    expect(createStrategy).not.toHaveBeenCalled();
    expect(updateStrategy).not.toHaveBeenCalled();
  });

  // ===== Scenario 1 (ticket point 6): first import while an unrelated graph is currently open =====
  it('a FIRST import never merges with - or even reads - an unrelated graph currently open on the canvas', async () => {
    const unrelated = unrelatedNode('unrelated-1');
    useStore.setState({ nodes: [unrelated], edges: [], activeProjectId: 'some-other-strategy-id', activeProjectSource: 'cloud' });

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    await importLaunchStrategy('proj-1', 'My Project');

    const persistedNodes = createStrategy.mock.calls[0][0].nodes;
    expect(persistedNodes).toHaveLength(1); // only the mapped objective - never the unrelated node
    expect(persistedNodes.some((n) => n.id === 'unrelated-1')).toBe(false);
    expect(getStrategy).not.toHaveBeenCalled(); // nothing to fetch - there is no existing strategy for THIS project
  });

  // ===== Scenario 2: re-import into an EXISTING linked project strategy =====
  it('a re-import fetches and reconciles against the SPECIFIC existing strategy\'s own real persisted content, never the active canvas', async () => {
    const existingPersistedNode = unrelatedNode('persisted-node-1', 900, 900);
    existingPersistedNode.data.sourceDecisionRef = { exportId: 'export-0', decisionId: 'obj-0', decisionType: 'objective' };
    existingPersistedNode.data.label = 'Old statement text';

    // The canvas has something ELSE entirely open - must never be read.
    useStore.setState({ nodes: [unrelatedNode('totally-different-canvas-node')], edges: [] });

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-2', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-id' });
    getStrategy.mockResolvedValue({ id: 'existing-strategy-id', nodes: [existingPersistedNode], edges: [], productInfo: { name: 'Real Name' }, aiSuggestions: null });
    updateStrategy.mockResolvedValue({ id: 'existing-strategy-id', updatedAt: '2026-01-03T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(getStrategy).toHaveBeenCalledWith('existing-strategy-id');
    const persistedNodes = updateStrategy.mock.calls[0][1].nodes;
    expect(persistedNodes.some((n) => n.id === 'totally-different-canvas-node')).toBe(false); // the unrelated canvas content never leaks in
    expect(persistedNodes.find((n) => n.id === 'persisted-node-1').data.label).toBe('Grow signups'); // the EXISTING project's own node was updated in place
    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(0);
    expect(createStrategy).not.toHaveBeenCalled();
  });

  // ===== Scenario 3: protection of manually edited nodes survives a re-import =====
  it('a manually-edited (locallyEdited) node in the EXISTING strategy is preserved untouched on re-import', async () => {
    const editedNode = unrelatedNode('edited-node-1', 900, 900);
    editedNode.data.sourceDecisionRef = { exportId: 'export-0', decisionId: 'obj-0', decisionType: 'objective' };
    editedNode.data.label = 'My own hand-edited text';
    editedNode.data.locallyEdited = true;

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-2', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-id' });
    getStrategy.mockResolvedValue({ id: 'existing-strategy-id', nodes: [editedNode], edges: [], productInfo: {}, aiSuggestions: null });
    updateStrategy.mockResolvedValue({ id: 'existing-strategy-id', updatedAt: '2026-01-03T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    const persistedNode = updateStrategy.mock.calls[0][1].nodes.find((n) => n.id === 'edited-node-1');
    expect(persistedNode.data.label).toBe('My own hand-edited text');
    expect(persistedNode.data.locallyEdited).toBe(true);
    expect(result.preservedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });

  // ===== Scenario 5: correct project and cloud strategy identity - never confused with whatever is currently active =====
  it('resolves the strategy by the SELECTED project id, never the currently active one', async () => {
    useStore.setState({ activeProjectId: 'currently-active-unrelated-strategy', activeProjectSource: 'cloud' });

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    await importLaunchStrategy('proj-selected', 'Selected Project');

    expect(getApprovedStrategyExport).toHaveBeenCalledWith('proj-selected');
    expect(findStrategyByProjectId).toHaveBeenCalledWith('proj-selected');
    expect(createStrategy.mock.calls[0][0].projectId).toBe('proj-selected');
  });

  it('on FIRST import (no existing linked strategy), creates a new cloud strategy with projectId/sourceLaunchAnalysisId set', async () => {
    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(createStrategy).toHaveBeenCalledTimes(1);
    const call = createStrategy.mock.calls[0][0];
    expect(call.projectId).toBe('proj-1');
    expect(call.sourceLaunchAnalysisId).toBe('export-1');
    expect(call.nodes).toHaveLength(1); // the one objective, mapped
    expect(updateStrategy).not.toHaveBeenCalled();
    expect(result.status).toBe('imported');
    expect(result.strategyId).toBe('new-strategy-id');
    expect(result.addedCount).toBe(1);
  });

  it('on RE-import (an existing linked strategy), updates that SAME row rather than creating a second one', async () => {
    getApprovedStrategyExport.mockResolvedValue({ id: 'export-2', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-id' });
    getStrategy.mockResolvedValue({ id: 'existing-strategy-id', nodes: [], edges: [], productInfo: {}, aiSuggestions: null });
    updateStrategy.mockResolvedValue({ id: 'existing-strategy-id', updatedAt: '2026-01-03T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(updateStrategy).toHaveBeenCalledTimes(1);
    expect(updateStrategy.mock.calls[0][0]).toBe('existing-strategy-id');
    expect(updateStrategy.mock.calls[0][1].sourceLaunchAnalysisId).toBe('export-2');
    expect(createStrategy).not.toHaveBeenCalled();
    expect(result.status).toBe('imported');
    expect(result.strategyId).toBe('existing-strategy-id');
  });

  // ===== ADV-004-FIX-2 (final correction): "the original tab and its
  // currently open graph must remain completely unchanged" - NEVER, not
  // even on a successful import. Display now happens in a NEW browser
  // tab (AdveserProjectsSelector.jsx), which loads the strategy
  // independently from persistent storage (useOpenStrategyFromUrl.js) -
  // this function itself must never touch the active canvas at all,
  // success or failure. (Superseded a now-obsolete pair of tests that
  // asserted the OPPOSITE under the earlier, same-tab-auto-display
  // design this correction replaces.) =====
  it('never touches the active canvas (nodes/edges/activeProjectId/activeProjectSource) even on a fully successful FIRST import', async () => {
    const before = { nodes: [], edges: [], activeProjectId: 'whatever-was-already-active', activeProjectSource: 'local' };
    useStore.setState(before);

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(result.strategyId).toBe('new-strategy-id'); // the caller DOES get the new id (to navigate a new tab to)
    expect(useStore.getState().nodes).toEqual([]);
    expect(useStore.getState().edges).toEqual([]);
    expect(useStore.getState().activeProjectId).toBe('whatever-was-already-active');
    expect(useStore.getState().activeProjectSource).toBe('local');
  });

  it('never touches the active canvas even on a fully successful RE-import/update', async () => {
    const before = { nodes: [], edges: [], activeProjectId: 'whatever-was-already-active', activeProjectSource: 'local' };
    useStore.setState(before);

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-2', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-id' });
    getStrategy.mockResolvedValue({ id: 'existing-strategy-id', nodes: [], edges: [], productInfo: {}, aiSuggestions: null });
    updateStrategy.mockResolvedValue({ id: 'existing-strategy-id', updatedAt: '2026-01-03T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(result.strategyId).toBe('existing-strategy-id');
    expect(useStore.getState().nodes).toEqual([]);
    expect(useStore.getState().activeProjectId).toBe('whatever-was-already-active');
    expect(useStore.getState().activeProjectSource).toBe('local');
  });

  // ===== Scenario 6: a persistence failure never contaminates (or even touches) the active graph =====
  it('when persistence fails, the active canvas is left completely untouched - no partial in-memory mutation', async () => {
    const unrelated = unrelatedNode('unrelated-canvas-node');
    useStore.setState({ nodes: [unrelated], edges: [], activeProjectId: 'some-other-strategy', activeProjectSource: 'cloud' });

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockRejectedValue(new Error('network error'));

    await expect(importLaunchStrategy('proj-1', 'My Project')).rejects.toThrow('network error');

    expect(useStore.getState().nodes).toEqual([unrelated]);
    expect(useStore.getState().activeProjectId).toBe('some-other-strategy');
    expect(useStore.getState().activeProjectSource).toBe('cloud');
  });

  it('when a re-import\'s persistence fails, the active canvas and active identity are left completely untouched', async () => {
    const unrelated = unrelatedNode('unrelated-canvas-node-2');
    useStore.setState({ nodes: [unrelated], edges: [], activeProjectId: 'some-other-strategy', activeProjectSource: 'cloud' });

    getApprovedStrategyExport.mockResolvedValue({ id: 'export-2', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-id' });
    getStrategy.mockResolvedValue({ id: 'existing-strategy-id', nodes: [], edges: [], productInfo: {}, aiSuggestions: null });
    updateStrategy.mockRejectedValue(new Error('409 conflict'));

    await expect(importLaunchStrategy('proj-1', 'My Project')).rejects.toThrow('409 conflict');

    expect(useStore.getState().nodes).toEqual([unrelated]);
    expect(useStore.getState().activeProjectId).toBe('some-other-strategy');
  });

  // ===== Scenario 7: existing (unrelated) cloud strategies/graphs are never touched by an import for a DIFFERENT project =====
  it('importing for one project never calls createStrategy/updateStrategy in a way that could affect a different project\'s strategy', async () => {
    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    await importLaunchStrategy('proj-A', 'Project A');

    expect(findStrategyByProjectId).toHaveBeenCalledWith('proj-A');
    expect(findStrategyByProjectId).not.toHaveBeenCalledWith('proj-B');
    expect(createStrategy.mock.calls[0][0].projectId).toBe('proj-A');
  });
});
