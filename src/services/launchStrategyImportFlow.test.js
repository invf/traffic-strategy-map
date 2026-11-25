// ADV-004 - launchStrategyImportFlow.js: the ADD-vs-UPDATE branch and the
// result summary. Uses the REAL store (useStore.getState/setState, works
// outside React - same convention as useStore.adveserProjects.test.js),
// mocking only the three network-touching service calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';

vi.mock('./launchStrategyImport', () => ({ getApprovedStrategyExport: vi.fn() }));
vi.mock('./strategies', () => ({
  findStrategyByProjectId: vi.fn(),
  createStrategy: vi.fn(),
  updateStrategy: vi.fn(),
}));

import { getApprovedStrategyExport } from './launchStrategyImport';
import { findStrategyByProjectId, createStrategy, updateStrategy } from './strategies';
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
    updateStrategy.mockResolvedValue({ id: 'existing-strategy-id', updatedAt: '2026-01-03T00:00:00.000Z' });

    const result = await importLaunchStrategy('proj-1', 'My Project');

    expect(updateStrategy).toHaveBeenCalledTimes(1);
    expect(updateStrategy.mock.calls[0][0]).toBe('existing-strategy-id');
    expect(updateStrategy.mock.calls[0][1].sourceLaunchAnalysisId).toBe('export-2');
    expect(createStrategy).not.toHaveBeenCalled();
    expect(result.status).toBe('imported');
    expect(result.strategyId).toBe('existing-strategy-id');
  });

  it('after a successful import, the store\'s active cloud project points at the imported/updated strategy', async () => {
    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    await importLaunchStrategy('proj-1', 'My Project');

    expect(useStore.getState().activeProjectId).toBe('new-strategy-id');
    expect(useStore.getState().activeProjectSource).toBe('cloud');
  });

  it('actually merges the mapped nodes into the store BEFORE persisting - the saved payload reflects the import, not stale empty state', async () => {
    getApprovedStrategyExport.mockResolvedValue({ id: 'export-1', strategyDecisionPackage: PKG });
    findStrategyByProjectId.mockResolvedValue(null);
    createStrategy.mockResolvedValue({ id: 'new-strategy-id', updatedAt: '2026-01-02T00:00:00.000Z' });

    await importLaunchStrategy('proj-1', 'My Project');

    expect(useStore.getState().nodes).toHaveLength(1);
    expect(useStore.getState().nodes[0].data.sourceDecisionRef.decisionId).toBe('obj-0');
  });
});
