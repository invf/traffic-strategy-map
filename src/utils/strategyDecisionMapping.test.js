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

// ADV-005 - rich per-channel execution content, mapped to the
// semantically correct fields per the owner's explicit correction.
describe('mapStrategyDecisionPackageToGraph - rich channel content (ADV-005)', () => {
  function richChannelPackage(channelOverrides = {}) {
    return minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'Grow qualified signups', priority: 'high', justification: { facts: [], assumptions: [] } }],
      channelDecisions: [
        {
          id: 'ch-0',
          channelId: 'linkedin',
          channelName: 'LinkedIn',
          relatedObjectiveIds: ['obj-0'],
          priority: 'high',
          justification: {
            facts: [{ statement: 'Audience is B2B SaaS teams', sourceType: 'verified_fact', evidence: 'confirmed' }],
            assumptions: [{ statement: 'Founder-voice posts outperform brand posts', basis: 'industry pattern' }],
          },
          targetAudience: 'B2B SaaS founders',
          valueProposition: 'Real-time sentiment tracking for product teams',
          positioningAndMessaging: 'Position as the fast, no-setup alternative',
          recommendedTactics: 'Weekly founder-voice posts with product screenshots',
          implementationSteps: ['Create company page', 'Publish 3 posts/week', 'Engage in 5 threads/week'],
          cadence: '3x/week',
          estimatedTimeframe: { end: '', label: 'First 30 days' },
          requiredResources: { tools: ['LinkedIn Business'], skills: ['Copywriting'] },
          kpis: [{ metric: 'Profile visits', measurementMethod: 'LinkedIn analytics', target: '500/month' }],
          unknowns: ['Budget for sponsored posts not provided'],
          ...channelOverrides,
        },
      ],
    });
  }

  it('maps rich fields to the semantically correct node fields (owner correction #2)', () => {
    const pkg = richChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');

    expect(channelNode.data.label).toBe('LinkedIn'); // channelName, never the raw id
    expect(channelNode.data.channelId).toBe('linkedin'); // identity kept separate from the display label
    expect(channelNode.data.context.product).toBe('Real-time sentiment tracking for product teams'); // valueProposition
    expect(channelNode.data.context.audience).toBe('B2B SaaS founders'); // targetAudience
    expect(channelNode.data.actionPlan.todo).toBe('Weekly founder-voice posts with product screenshots'); // recommendedTactics
    expect(channelNode.data.actionPlan.actionItems).toEqual(['Create company page', 'Publish 3 posts/week', 'Engage in 5 threads/week']); // ordered implementationSteps
    expect(channelNode.data.actionPlan.tools).toBe('LinkedIn Business'); // requiredResources.tools
    expect(channelNode.data.actionPlan.kpi).toBe('Profile visits (LinkedIn analytics) → 500/month'); // metric + method + target
    expect(channelNode.data.actionPlan.plannedTimeframe).toEqual({ end: '', label: 'First 30 days' }); // estimatedTimeframe
  });

  it('context.why (strategic rationale) distinguishes facts from assumptions and names unknowns explicitly - never turns an assumption into a verified fact', () => {
    const pkg = richChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');

    expect(channelNode.data.context.why).toContain('Audience is B2B SaaS teams');
    expect(channelNode.data.context.why).toContain('Assumption: Founder-voice posts outperform brand posts');
    expect(channelNode.data.context.why).toContain('Supports: Grow qualified signups');
    expect(channelNode.data.context.why).toContain('Unknown: Budget for sponsored posts not provided');
  });

  it('context.expectedResult prefers a concrete KPI target over the more general positioning text', () => {
    const pkg = richChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');
    expect(channelNode.data.context.expectedResult).toBe('Profile visits → 500/month');
  });

  it('keeps tactics/execution and strategic rationale logically separated - recommendedTactics never leaks into context.why', () => {
    const pkg = richChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');
    expect(channelNode.data.context.why).not.toContain('founder-voice posts with product screenshots');
  });

  it('every new field is omitted (never a fabricated placeholder) for a sparse channel decision - "missing resource information" scenario', () => {
    const pkg = minimalPackage({
      channelDecisions: [{ id: 'ch-0', channelId: 'reddit', channelName: 'Reddit', relatedObjectiveIds: [], priority: 'low', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');
    expect(channelNode.data.context.product).toBe('');
    expect(channelNode.data.context.audience).toBe('');
    expect(channelNode.data.context.expectedResult).toBe('');
    expect(channelNode.data.actionPlan.todo).toBe('');
    expect(channelNode.data.actionPlan.tools).toBe('');
    expect(channelNode.data.actionPlan.kpi).toBe('');
    expect(channelNode.data.actionPlan.actionItems).toEqual([]);
    expect(channelNode.data.actionPlan.plannedTimeframe).toBe(null);
  });

  it('backward compatibility: a version-1-shaped channel decision (no channelName, no rich fields at all) still maps without crashing, falling back to channelId as the label', () => {
    const pkg = minimalPackage({
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', relatedObjectiveIds: [], priority: 'high', justification: { facts: [], assumptions: [] } }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.nodeType === 'channel');
    expect(channelNode.data.label).toBe('linkedin'); // same as pre-ADV-005 behavior
    expect(channelNode.data.channelId).toBe('linkedin');
    expect(channelNode.data.context.why).toBe(''); // no justification, no related objectives, no unknowns - nothing to say
  });

  it('channel-level dependsOnChannelIds resolves to real node ids and creates an edge, same backward-only rule as actions', () => {
    const pkg = minimalPackage({
      channelDecisions: [
        { id: 'ch-0', channelId: 'linkedin', channelName: 'LinkedIn', relatedObjectiveIds: [], priority: 'high', justification: { facts: [], assumptions: [] } },
        { id: 'ch-1', channelId: 'reddit', channelName: 'Reddit', relatedObjectiveIds: [], priority: 'medium', justification: { facts: [], assumptions: [] }, dependsOnChannelIds: ['ch-0'] },
      ],
    });
    const { nodes, edges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const ch0 = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'ch-0');
    const ch1 = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'ch-1');
    expect(ch1.data.dependencies).toEqual([ch0.id]);
    expect(edges.some((e) => e.source === ch0.id && e.target === ch1.id)).toBe(true);
  });

  it('a channel\'s suggestedExperimentIds creates an edge to the real experiment node, even though experiments are mapped AFTER channels', () => {
    const pkg = minimalPackage({
      hypotheses: [{ id: 'hyp-0', statement: 'H1', relatedObjectiveIds: [], confidence: 'medium', evidence: [] }],
      experiments: [{ id: 'exp-0', title: 'Validate messaging', hypothesisId: 'hyp-0', method: 'A/B', successCriteria: 'CTR +10%', relatedActionIds: [] }],
      channelDecisions: [
        { id: 'ch-0', channelId: 'linkedin', channelName: 'LinkedIn', relatedObjectiveIds: [], priority: 'high', justification: { facts: [], assumptions: [] }, suggestedExperimentIds: ['exp-0'] },
      ],
    });
    const { nodes, edges } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const channelNode = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'ch-0');
    const expNode = nodes.find((n) => n.data.sourceDecisionRef.decisionId === 'exp-0');
    expect(edges.some((e) => e.source === channelNode.id && e.target === expNode.id)).toBe(true);
  });
});

// ADV-005 - Structured Graph Layout: channel-oriented visual grouping,
// no overlapping bounding boxes, deterministic, scales to any number of
// channels/activities.
describe('mapStrategyDecisionPackageToGraph - structured graph layout (ADV-005)', () => {
  // Two channels with a DIFFERENT number of actions each - "support
  // graphs with multiple channels and different numbers of actions."
  function multiChannelPackage() {
    return minimalPackage({
      objectives: [{ id: 'obj-0', statement: 'Grow signups', priority: 'high', justification: { facts: [], assumptions: [] } }],
      channelDecisions: [
        { id: 'ch-0', channelId: 'linkedin', channelName: 'LinkedIn', relatedObjectiveIds: ['obj-0'], priority: 'high', justification: { facts: [], assumptions: [] } },
        { id: 'ch-1', channelId: 'reddit', channelName: 'Reddit', relatedObjectiveIds: ['obj-0'], priority: 'medium', justification: { facts: [], assumptions: [] } },
      ],
      actions: [
        // Channel A (LinkedIn, ch-0) gets 1 action.
        { id: 'act-0', title: 'LinkedIn post', description: 'd', priority: 'high', relatedChannelId: 'ch-0', relatedHypothesisIds: [], dependsOnActionIds: [] },
        // Channel B (Reddit, ch-1) gets 3 actions.
        { id: 'act-1', title: 'Reddit AMA', description: 'd', priority: 'medium', relatedChannelId: 'ch-1', relatedHypothesisIds: [], dependsOnActionIds: [] },
        { id: 'act-2', title: 'Reddit comment outreach', description: 'd', priority: 'medium', relatedChannelId: 'ch-1', relatedHypothesisIds: [], dependsOnActionIds: [] },
        { id: 'act-3', title: 'Reddit subreddit post', description: 'd', priority: 'medium', relatedChannelId: 'ch-1', relatedHypothesisIds: [], dependsOnActionIds: [] },
      ],
    });
  }

  it('groups an action under its own channel\'s row, not interleaved with an unrelated channel\'s actions (channel-oriented visual grouping)', () => {
    const pkg = multiChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const byDecisionId = Object.fromEntries(nodes.map((n) => [n.data.sourceDecisionRef.decisionId, n]));

    // Every Reddit action sits closer to the Reddit channel's own row than
    // to LinkedIn's - the barycenter groups them together rather than
    // scattering them by overall array position.
    const linkedinY = byDecisionId['ch-0'].position.y;
    const redditY = byDecisionId['ch-1'].position.y;
    const redditActionYs = [byDecisionId['act-1'].position.y, byDecisionId['act-2'].position.y, byDecisionId['act-3'].position.y];
    for (const y of redditActionYs) {
      expect(Math.abs(y - redditY)).toBeLessThanOrEqual(Math.abs(y - linkedinY));
    }
  });

  it('supports a different number of activities per channel without error - a channel with 1 action and one with 3 both lay out cleanly', () => {
    const pkg = multiChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    expect(nodes).toHaveLength(7); // 1 objective + 2 channels + 4 actions
    expect(nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
  });

  it('never produces two nodes at the exact same position - no overlapping bounding boxes straight out of the mapper', () => {
    const pkg = multiChannelPackage();
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const sameColumnGroups = {};
    for (const n of nodes) {
      (sameColumnGroups[n.data.nodeType] ||= []).push(n.position.y);
    }
    for (const ys of Object.values(sameColumnGroups)) {
      expect(new Set(ys).size).toBe(ys.length); // every row within a column is unique
    }
  });

  it('is fully deterministic - the same package produces the exact same layout on repeated calls', () => {
    const pkg = multiChannelPackage();
    const run = () => mapStrategyDecisionPackageToGraph(pkg, 'export-1').nodes.map((n) => n.position);
    expect(run()).toEqual(run());
  });

  it('an action with no channel or hypothesis link at all still lays out (no crash) and trails after properly-anchored actions, never interleaved among them', () => {
    const pkg = minimalPackage({
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', channelName: 'LinkedIn', relatedObjectiveIds: [], priority: 'high', justification: { facts: [], assumptions: [] } }],
      actions: [
        { id: 'act-0', title: 'Linked action', description: 'd', priority: 'high', relatedChannelId: 'ch-0', relatedHypothesisIds: [], dependsOnActionIds: [] },
        { id: 'act-1', title: 'Orphan action', description: 'd', priority: 'medium', relatedHypothesisIds: [], dependsOnActionIds: [] },
      ],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const byDecisionId = Object.fromEntries(nodes.map((n) => [n.data.sourceDecisionRef.decisionId, n]));
    expect(byDecisionId['act-1'].position.y).toBeGreaterThan(byDecisionId['act-0'].position.y);
  });

  it('a test node is grouped near its hypothesis AND its related action when both exist', () => {
    const pkg = minimalPackage({
      channelDecisions: [{ id: 'ch-0', channelId: 'linkedin', channelName: 'LinkedIn', relatedObjectiveIds: [], priority: 'high', justification: { facts: [], assumptions: [] } }],
      hypotheses: [{ id: 'hyp-0', statement: 'H1', relatedObjectiveIds: [], confidence: 'medium', evidence: [] }],
      actions: [{ id: 'act-0', title: 'A1', description: 'd', priority: 'high', relatedChannelId: 'ch-0', relatedHypothesisIds: ['hyp-0'], dependsOnActionIds: [] }],
      experiments: [{ id: 'exp-0', title: 'E1', hypothesisId: 'hyp-0', method: 'm', successCriteria: 's', relatedActionIds: ['act-0'] }],
    });
    const { nodes } = mapStrategyDecisionPackageToGraph(pkg, 'export-1');
    const byDecisionId = Object.fromEntries(nodes.map((n) => [n.data.sourceDecisionRef.decisionId, n]));
    // With only one of each type in this fixture, the test node's row
    // should land on or very near its single hypothesis/action anchor.
    expect(Math.abs(byDecisionId['exp-0'].position.y - byDecisionId['act-0'].position.y)).toBeLessThanOrEqual(160);
  });
});
