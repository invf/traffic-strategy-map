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

  // ===== ADV-004-FIX-2 scenario 4: node collision prevention =====

  it('a newly ADDED node is nudged away from an existing (unrelated/orphaned) node occupying its default slot - no overlapping bounding boxes', () => {
    // obj-0's default mapped position is the 'idea' column's row 0 slot
    // (x: 40, y: 40, per positionFor) - placing an unrelated existing
    // node exactly there forces the collision-avoidance path to fire.
    const blocker = importedNode('some-other-decision-not-in-this-package', { label: 'Blocking node' });
    blocker.position = { x: 40, y: 40 };

    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'New objective', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    expect(mappedNodes[0].position).toEqual({ x: 40, y: 40 }); // confirms the test actually exercises a real collision, not a no-op

    const result = reconcileImportedGraph([blocker], [], mappedNodes, mappedEdges);
    const newNode = result.nodes.find((n) => n.data.sourceDecisionRef?.decisionId === 'obj-0');

    expect(newNode.position).not.toEqual({ x: 40, y: 40 }); // moved away from the blocker
    expect(newNode.position.x).toBe(40); // same column - type grouping/edge-crossing avoidance is preserved
    expect(newNode.position.y).toBeGreaterThan(40); // nudged downward, deterministically
    expect(result.nodes.find((n) => n.id === blocker.id).position).toEqual({ x: 40, y: 40 }); // the existing node itself is never moved
  });

  it('a newly ADDED node is also nudged away from a fully HAND-CREATED node (no sourceDecisionRef at all) occupying its default slot', () => {
    const hand = handCreatedNode('hand-blocker');
    hand.position = { x: 40, y: 40 };

    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'New objective', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');

    const result = reconcileImportedGraph([hand], [], mappedNodes, mappedEdges);
    const newNode = result.nodes.find((n) => n.data.sourceDecisionRef?.decisionId === 'obj-0');

    expect(newNode.position).not.toEqual({ x: 40, y: 40 });
    expect(result.nodes.find((n) => n.id === 'hand-blocker').position).toEqual({ x: 40, y: 40 }); // never moved
  });

  it('two newly ADDED nodes landing in the same column never overlap each other either', () => {
    const pkg = minimalPackage({
      objectives: [
        { id: 'obj-0', statement: 'First', priority: 'high', justification: { facts: [], assumptions: [] } },
        { id: 'obj-1', statement: 'Second', priority: 'high', justification: { facts: [], assumptions: [] } },
      ],
    });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    // Force both onto the exact same default slot to prove the batch-internal collision check works, not just against pre-existing nodes.
    mappedNodes[1].position = { ...mappedNodes[0].position };

    const result = reconcileImportedGraph([], [], mappedNodes, mappedEdges);
    const first = result.nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'obj-0');
    const second = result.nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'obj-1');
    expect(first.position).not.toEqual(second.position);
  });

  it('collision avoidance is fully deterministic - the same existing graph produces the same new position on repeated (separate) calls', () => {
    const blocker = importedNode('unrelated-decision');
    blocker.position = { x: 40, y: 40 };
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }] });

    const run = () => {
      const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
      return reconcileImportedGraph([blocker], [], mappedNodes, mappedEdges).nodes.find((n) => n.data.sourceDecisionRef?.decisionId === 'obj-0').position;
    };

    expect(run()).toEqual(run());
  });

  it('a normal import with no pre-existing occupant at all keeps the original clean grid position unchanged (no unnecessary nudging)', () => {
    const pkg = minimalPackage({ objectives: [{ id: 'obj-0', statement: 'X', priority: 'high', justification: { facts: [], assumptions: [] } }] });
    const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const result = reconcileImportedGraph([], [], mappedNodes, mappedEdges);
    expect(result.nodes[0].position).toEqual({ x: 40, y: 40 });
  });
});
