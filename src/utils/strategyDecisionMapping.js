// ADV-004 - deterministic (NO LLM) conversion of a Launch Studio Strategy
// Decision Package into Traffic Strategy Map's existing node/edge graph
// model, plus the merge-safe reconciliation that applies a (re-)import
// without ever clobbering a node the user has since hand-edited.
//
// Pure functions only - no Zustand, no fetch - so both halves are fully
// unit-testable without a store or a network call (same separation
// useStore.js's own node/edge helpers already keep from the store logic
// around them). useStore.js's importStrategyGraph action is a thin wrapper
// calling these two functions and set()-ing the result.
//
// "Primary strategist is Launch Studio" is enforced structurally here:
// this file only ever TRANSCRIBES an already-decided package into nodes -
// it makes no strategic choice itself (no scoring, no filtering, no
// re-ordering by anything other than the package's own index order).

let idCounter = 0;
// Small, self-contained id generator - NOT imported from useStore.js
// deliberately: this file stays a pure utility with zero store
// dependency, consistent with every other file in src/utils/. The actual
// uniqueness property only needs to hold within one mapping call (ids are
// immediately consumed as react-flow node ids, never persisted
// independently), so a counter + timestamp is enough, same spirit as
// useStore.js's own uid().
function genNodeId() {
  idCounter += 1;
  return `n_${Date.now()}_${idCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function genEdgeId(sourceId, targetId) {
  return `e_${sourceId}_${targetId}`;
}

const COLUMN_X = { idea: 40, channel: 360, hypothesis: 680, action: 1000, test: 1320 };
const ROW_Y_STEP = 160;

function positionFor(nodeType, rowIndex) {
  return { x: COLUMN_X[nodeType] ?? 40, y: 40 + rowIndex * ROW_Y_STEP };
}

function baseNodeData(nodeType, label, description, priority, status, exportId, decisionId, decisionType) {
  return {
    label,
    nodeType,
    status,
    priority,
    description,
    context: { why: '', product: '', audience: '', expectedResult: '' },
    actionPlan: { todo: '', tools: '', kpi: '', deadline: '', executionStatus: 'pending', actionItems: [], plannedTimeframe: null },
    comments: [],
    dependencies: [],
    sourceDecisionRef: { exportId, decisionId, decisionType },
    locallyEdited: false,
  };
}

// Pure mapping - every rule below is deterministic and order-preserving;
// nothing here ever asks an LLM to decide anything. `result`/`next_step`
// nodes are deliberately NOT synthesized here (see this file's own
// header and the ADV-004 plan: nothing has executed yet at import time) -
// they're created later, organically, through the ordinary node-creation
// UI as the user works through actions/tests.
export function mapStrategyDecisionPackageToGraph(pkg, exportId) {
  const nodes = [];
  const edges = [];

  // decisionId -> real react-flow node id, built up as each section is
  // mapped, so later sections (actions depending on channels/hypotheses,
  // experiments depending on hypotheses/actions) can resolve a real edge
  // target even though the package itself only ever uses ITS OWN ids.
  const nodeIdByDecisionId = new Map();

  (pkg.objectives || []).forEach((o, i) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(o.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: positionFor('idea', i),
      data: baseNodeData('idea', o.statement, describeJustification(o.justification), o.priority, 'todo', exportId, o.id, 'objective'),
    });
  });

  (pkg.channelDecisions || []).forEach((c, i) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(c.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: positionFor('channel', i),
      data: baseNodeData('channel', c.channelId, describeJustification(c.justification), c.priority, 'todo', exportId, c.id, 'channel'),
    });
    for (const objId of c.relatedObjectiveIds || []) {
      const sourceId = nodeIdByDecisionId.get(objId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  (pkg.hypotheses || []).forEach((h, i) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(h.id, id);
    const evidenceDesc = (h.evidence || []).map((f) => f.statement).join('; ');
    nodes.push({
      id,
      type: 'custom',
      position: positionFor('hypothesis', i),
      data: baseNodeData('hypothesis', h.statement, evidenceDesc, h.confidence, 'todo', exportId, h.id, 'hypothesis'),
    });
    for (const objId of h.relatedObjectiveIds || []) {
      const sourceId = nodeIdByDecisionId.get(objId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  (pkg.actions || []).forEach((a, i) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(a.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: positionFor('action', i),
      data: {
        ...baseNodeData('action', a.title, a.description, a.priority, 'todo', exportId, a.id, 'action'),
        // dependencies is resolved to REAL node ids below, once every
        // action in this package has been assigned one - an action can
        // depend on an EARLIER action in the same array, which by this
        // point in the forEach already has a real id in the map.
        dependencies: (a.dependsOnActionIds || []).map((depId) => nodeIdByDecisionId.get(depId)).filter(Boolean),
        actionPlan: {
          todo: a.title,
          tools: '',
          kpi: a.kpi ? `${a.kpi.metric}${a.kpi.target ? ` → ${a.kpi.target}` : ''}` : '',
          deadline: a.plannedTimeframe?.end || a.plannedTimeframe?.label || '',
          executionStatus: 'pending',
          actionItems: [a.title],
          plannedTimeframe: a.plannedTimeframe || null,
        },
      },
    });
    const relatedId = a.relatedChannelId ? nodeIdByDecisionId.get(a.relatedChannelId) : undefined;
    if (relatedId) edges.push(makeEdge(relatedId, id));
    for (const hypId of a.relatedHypothesisIds || []) {
      const sourceId = nodeIdByDecisionId.get(hypId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
    for (const depId of a.dependsOnActionIds || []) {
      const sourceId = nodeIdByDecisionId.get(depId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  (pkg.experiments || []).forEach((e, i) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(e.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: positionFor('test', i),
      data: {
        ...baseNodeData('test', e.title, `${e.method} — success: ${e.successCriteria}`, 'medium', 'todo', exportId, e.id, 'experiment'),
        dependencies: (e.relatedActionIds || []).map((depId) => nodeIdByDecisionId.get(depId)).filter(Boolean),
      },
    });
    const hypSourceId = nodeIdByDecisionId.get(e.hypothesisId);
    if (hypSourceId) edges.push(makeEdge(hypSourceId, id));
    for (const actId of e.relatedActionIds || []) {
      const sourceId = nodeIdByDecisionId.get(actId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  return { nodes, edges };
}

function describeJustification(justification) {
  if (!justification) return '';
  const facts = (justification.facts || []).map((f) => f.statement);
  const assumptions = (justification.assumptions || []).map((a) => a.statement);
  return [...facts, ...assumptions].join('; ');
}

function makeEdge(sourceId, targetId) {
  return {
    id: genEdgeId(sourceId, targetId),
    source: sourceId,
    target: targetId,
    type: 'custom',
    animated: false,
    data: { edgeStyle: 'sequence', pathType: 'smoothstep' },
  };
}

// Merge-safe reconciliation - never a wholesale replace like
// generateMap/loadStrategy. Indexes EXISTING nodes by
// sourceDecisionRef.decisionId (only nodes that have one at all are ever
// candidates); every rule below is the direct implementation of the
// ADV-004 ticket's "do not overwrite manually edited graphs during
// re-import or regeneration":
//
//  1. mapped decision, no existing match          -> ADD as a new node
//  2. mapped decision, existing match, NOT edited  -> UPDATE in place
//  3. mapped decision, existing match, locallyEdited -> PRESERVE (skip)
//  4. existing import-sourced node, no longer in the mapped set -> LEAVE
//     IN PLACE (never auto-deleted)
//  5. existing node with NO sourceDecisionRef at all (hand-created)
//     -> never touched, full stop; not even considered above
export function reconcileImportedGraph(existingNodes, existingEdges, mappedNodes, mappedEdges) {
  const existingByDecisionId = new Map();
  for (const n of existingNodes) {
    const decisionId = n.data?.sourceDecisionRef?.decisionId;
    if (decisionId) existingByDecisionId.set(decisionId, n);
  }

  // decisionId -> the REAL node id this reconciliation ends up using for
  // it (either the existing node's own id, preserved, or the freshly
  // mapped node's id for a brand-new addition) - needed so edges can be
  // re-pointed at the correct (possibly pre-existing) node id rather than
  // the mapper's own freshly-generated one.
  const resolvedNodeId = new Map();

  let updatedCount = 0;
  let addedCount = 0;
  let preservedCount = 0;

  const resultNodes = [...existingNodes];

  for (const mapped of mappedNodes) {
    const decisionId = mapped.data.sourceDecisionRef.decisionId;
    const existing = existingByDecisionId.get(decisionId);

    if (!existing) {
      resultNodes.push(mapped);
      resolvedNodeId.set(decisionId, mapped.id);
      addedCount += 1;
      continue;
    }

    resolvedNodeId.set(decisionId, existing.id);

    if (existing.data?.locallyEdited) {
      preservedCount += 1;
      continue;
    }

    const idx = resultNodes.findIndex((n) => n.id === existing.id);
    if (idx !== -1) {
      resultNodes[idx] = {
        ...existing,
        data: {
          ...mapped.data,
          // The dependencies array mapStrategyDecisionPackageToGraph built
          // points at the MAPPED nodes' own fresh ids - re-resolved below,
          // after every decision in this batch has a resolvedNodeId, so an
          // action depending on an existing (preserved-id) node still
          // points at the correct, real, possibly-pre-existing node id.
          dependencies: mapped.data.dependencies,
          locallyEdited: false,
        },
      };
      updatedCount += 1;
    }
  }

  // Second pass: re-point every newly-added/updated node's `dependencies`
  // at the RESOLVED node ids (which may differ from the mapper's own
  // fresh ids when an existing node was reused) - done after the loop
  // above so every decisionId in this batch is guaranteed to be resolved
  // first, regardless of array order.
  const mappedDecisionIdByFreshId = new Map(mappedNodes.map((n) => [n.id, n.data.sourceDecisionRef.decisionId]));
  for (let i = 0; i < resultNodes.length; i += 1) {
    const n = resultNodes[i];
    const decisionId = n.data?.sourceDecisionRef?.decisionId;
    const wasJustMappedOrUpdated = decisionId && resolvedNodeId.has(decisionId) && !n.data.locallyEdited;
    if (!wasJustMappedOrUpdated || !Array.isArray(n.data.dependencies) || n.data.dependencies.length === 0) continue;
    resultNodes[i] = {
      ...n,
      data: {
        ...n.data,
        dependencies: n.data.dependencies.map((depFreshId) => {
          const depDecisionId = mappedDecisionIdByFreshId.get(depFreshId);
          return (depDecisionId && resolvedNodeId.get(depDecisionId)) || depFreshId;
        }),
      },
    };
  }

  // Edges: re-point source/target at resolvedNodeId where the mapper's
  // fresh node id was reused for an EXISTING node; drop an edge entirely
  // if either side never resolved to a real node (should not happen in
  // practice, but never emit a dangling edge).
  const existingEdgeKeys = new Set(existingEdges.map((e) => `${e.source}->${e.target}`));
  const newEdges = [];
  for (const e of mappedEdges) {
    const sourceDecisionId = mappedDecisionIdByFreshId.get(e.source);
    const targetDecisionId = mappedDecisionIdByFreshId.get(e.target);
    const resolvedSource = (sourceDecisionId && resolvedNodeId.get(sourceDecisionId)) || e.source;
    const resolvedTarget = (targetDecisionId && resolvedNodeId.get(targetDecisionId)) || e.target;
    const key = `${resolvedSource}->${resolvedTarget}`;
    if (existingEdgeKeys.has(key)) continue; // already present, never a duplicate
    existingEdgeKeys.add(key);
    newEdges.push({ ...e, id: genEdgeId(resolvedSource, resolvedTarget), source: resolvedSource, target: resolvedTarget });
  }

  return {
    nodes: resultNodes,
    edges: [...existingEdges, ...newEdges],
    updatedCount,
    addedCount,
    preservedCount,
  };
}
