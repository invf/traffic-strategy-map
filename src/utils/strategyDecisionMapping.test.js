// ADV-004 - pure unit tests for mapStrategyDecisionPackageToGraph
// (deterministic, no-LLM package -> graph mapping) and
// reconcileImportedGraph (merge-safe re-import). No store, no network -
// same reasoning as useStore.js's own header for why these live as
// standalone pure functions.
import { describe, it, expect } from 'vitest';
import { mapStrategyDecisionPackageToGraph, reconcileImportedGraph } from './strategyDecisionMapping.js';

function minimalPackage(overrides = {}) {
  return {
    schemaVersion: 1,
    market: { facts: [], assumptions: [], unknowns: [] },
    competitors: { facts: [], assumptions: [], unknowns: [] },
    availableResources: { facts: [], assumptions: [], unknowns: [] },
    objectives: [],
    channelDecisions: [],
    hypotheses: [],
    actions: [],
    experiments: [],
    recommendationSummary: '',
    generatedFromRevisionId: 'rev-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapStrategyDecisionPackageToGraph', () => {
  it('maps each objective to an idea node, each channel decision to a channel node, each hypothesis to a hypothesis node, each action to an action node, and each experiment to a test node', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'Grow signups', priority: 'high', justification: { facts: [], assumptions: [] } }],
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', relatedObjectiveIds: ['obj-0'], priority: 'high', justification: { facts: [], assumptions: [] } }],
      hypotheses: [{ id: 'hyp-0', statement: 'LinkedIn drives signups', relatedObjectiveIds: ['obj-0'], confidence: 'medium', evidence: [] }],
      actions: [{ id: 'act-0', title: 'Post on LinkedIn', description: 'd', priority: 'high', relatedHypothesisIds: ['hyp-0'], dependsOnActionIds: [] }],
      experiments: [{ id: 'exp-0', title: 'A/B test headline', hypothesisId: 'hyp-0', method: 'm', successCriteria: 's', relatedActionIds: ['act-0'] }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const types = nodes.map((n) => n.data.nodeType);
    expect(types).toEqual(['idea', 'channel', 'hypothesis', 'action', 'test']);
  });

  it('never produces a result or nextStep node - nothing has executed yet at import time', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    expect(nodes.every((n) => n.data.nodeType !== 'result' && n.data.nodeType !== 'nextStep')).toBe(true);
  });

  it('stamps every generated node with sourceDecisionRef (exportId, decisionId, decisionType)', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-42');
    expect(nodes[0].data.sourceDecisionRef).toEqual({ exportId: 'export-42', decisionId: 'obj-0', decisionType: 'objective' });
  });

  it('creates an edge from an objective node to a channel decision node that relates to it', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'Grow signups', priority: 'high', justification: { facts: [], assumptions: [] } }],
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', relatedObjectiveIds: ['obj-0'], priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes, edges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const objNode = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'obj-0');
    const chNode = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'ch-0');
    expect(edges.some((e) => e.source === objNode.id && e.target === chNode.id)).toBe(true);
  });

  it('resolves an action\'s dependsOnActionIds to the REAL mapped node ids (never the package\'s own string ids)', () => {
    const pkg = minimalPackage({
      actions: [
        { id: 'act-0', title: 'Write post', description: 'd', priority: 'high', relatedHypothesisIds: [], dependsOnActionIds: [] },
        { id: 'act-1', title: 'Publish post', description: 'd', priority: 'high', relatedHypothesisIds: [], dependsOnActionIds: ['act-0'] },
      ],
    });
    const { nodes, edges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const act0Node = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'act-0');
    const act1Node = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'act-1');
    expect(act1Node.data.dependencies).toEqual([act0Node.id]);
    expect(act1Node.data.dependencies[0]).not.toBe('act-0');
    expect(edges.some((e) => e.source === act0Node.id && e.target === act1Node.id)).toBe(true);
  });

  it('carries priority straight through without any translation (the deterministic mapper never fuzzy-translates)', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'X', priority: 'low', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    expect(nodes[0].data.priority).toBe('low');
  });

  it('every generated node starts with locallyEdited: false', () => {
    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    expect(nodes[0].data.locallyEdited).toBe(false);
  });
});

describe('reconcileImportedGraph', () => {
  function importedNode(decisionId, overrides = {}) {
    return {
      id: `existing-${decisionId}`,
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        label: 'Old label',
        nodeType: 'idea',
        status: 'todo',
        priority: 'medium',
        description: 'old',
        context: { why: '', product: '', audience: '', expectedResult: '' },
        actionPlan: { todo: '', tools: '', kpi: '', deadline: '', executionStatus: 'pending', actionItems: [], plannedTimeframe: null },
        comments: [],
        dependencies: [],
        sourceDecisionRef: { exportId: 'export-old', decisionId, decisionType: 'objective' },
        locallyEdited: false,
        ...overrides,
      },
    };
  }

  function handCreatedNode(id) {
    return {
      id,
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        label: 'My own node',
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

  it('branch 1 (ADD NEW): a mapped decision with no existing match is added as a new node', () => {
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'New objective', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');

    const result = reconcileImportedGraph([], [], mappedNodes, mappedEdges);
    expect(result.nodes).toHaveLength(1);
    expect(result.addedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(result.preservedCount).toBe(0);
  });

  it('branch 2 (UPDATE IN PLACE): a mapped decision matching an existing, NOT locally-edited node is updated in place, keeping the SAME node id', () => {
    const existing = importedNode('obj-0', { label: 'Old label' });
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'Updated objective text', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-2');

    const result = reconcileImportedGraph([existing], [], mappedNodes, mappedEdges);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(existing.id); // same node id preserved, never replaced wholesale
    expect(result.nodes[0].data.label).toBe('Updated objective text');
    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(0);
  });

  it('branch 3 (PRESERVE): a mapped decision matching an existing, LOCALLY-EDITED node is left completely untouched', () => {
    const existing = importedNode('obj-0', { label: 'My hand-edited label', locallyEdited: true });
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'A newer AI-generated statement', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-2');

    const result = reconcileImportedGraph([existing], [], mappedNodes, mappedEdges);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].data.label).toBe('My hand-edited label'); // untouched
    expect(result.nodes[0].data.locallyEdited).toBe(true);
    expect(result.preservedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });

  it('branch 4 (LEAVE ORPHANED): an existing import-sourced node whose decision no longer appears in the new package is left in place, never deleted', () => {
    const existing = importedNode('obj-removed', { label: 'Still here' });
    const pkg = minimalPackage({ objectives: [] }); // the new package no longer has obj-removed at all
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-2');

    const result = reconcileImportedGraph([existing], [], mappedNodes, mappedEdges);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(existing.id);
    expect(result.nodes[0].data.label).toBe('Still here');
  });

  it('branch 5 (NEVER TOUCH HAND-CREATED): a node with sourceDecisionRef: null is never affected by import, regardless of what the new package contains', () => {
    const handNode = handCreatedNode('hand-1');
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'Something unrelated', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');

    const result = reconcileImportedGraph([handNode], [], mappedNodes, mappedEdges);
    expect(result.nodes.find((n) => n.id === 'hand-1')).toEqual(handNode);
    expect(result.nodes).toHaveLength(2); // the hand-created node PLUS the one new import
  });

  it('a mixed re-import: one updated, one preserved, one newly added, one orphaned-but-kept, and one hand-created node untouched, all in a single call', () => {
    const toUpdate = importedNode('obj-update', { label: 'Stale' });
    const toPreserve = importedNode('obj-preserve', { label: 'Mine now', locallyEdited: true });
    const orphaned = importedNode('obj-orphaned', { label: 'No longer in the package' });
    const hand = handCreatedNode('hand-1');

    const pkg = minimalPackage({
      objectives: [
        { id: 'obj-update', statement: 'Fresh text', priority: 'high', justification: { facts: [], assumptions: [] } },
        { id: 'obj-preserve', statement: 'This would overwrite if not preserved', priority: 'high', justification: { facts: [], assumptions: [] } },
        { id: 'obj-new', statement: 'Brand new objective', priority: 'medium', justification: { facts: [], assumptions: [] } },
      ],
    });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-3');

    const result = reconcileImportedGraph([toUpdate, toPreserve, orphaned, hand], [], mappedNodes, mappedEdges);

    expect(result.updatedCount).toBe(1);
    expect(result.preservedCount).toBe(1);
    expect(result.addedCount).toBe(1);
    expect(result.nodes).toHaveLength(5); // update + preserve + orphaned(kept) + hand(untouched) + 1 new
    expect(result.nodes.find((n) => n.id === toUpdate.id).data.label).toBe('Fresh text');
    expect(result.nodes.find((n) => n.id === toPreserve.id).data.label).toBe('Mine now');
    expect(result.nodes.find((n) => n.id === orphaned.id).data.label).toBe('No longer in the package');
    expect(result.nodes.find((n) => n.id === 'hand-1')).toEqual(hand);
  });

  it('never creates a duplicate edge when the same edge already exists from a prior import', () => {
    const existingObj = importedNode('obj-0');
    const existingChannel = { ...importedNode('ch-0'), data: { ...importedNode('ch-0').data, sourceDecisionRef: { exportId: 'export-old', decisionId: 'ch-0', decisionType: 'channel' } } };
    const existingEdge = { id: 'e-old', source: existingObj.id, target: existingChannel.id, type: 'custom', animated: false, data: {} };

    const pkg = minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }],
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', relatedObjectiveIds: ['obj-0'], priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-2');

    const result = reconcileImportedGraph([existingObj, existingChannel], [existingEdge], mappedNodes, mappedEdges);
    const matchingEdges = result.edges.filter((e) => e.source === existingObj.id && e.target === existingChannel.id);
    expect(matchingEdges).toHaveLength(1);
  });
});
