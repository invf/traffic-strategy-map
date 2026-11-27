// ADV-004 - deterministic (NO LLM) conversion of a Launch Studio Strategy
// Decision Package into Traffic Strategy Map's existing node/edge graph
// model, plus the merge-safe reconciliation that applies a (re-)import
// without ever clobbering a node the user has since hand-edited.
//
// Pure functions only - no Zustand, no fetch - so both halves are fully
// unit-testable without a store or a network call (same separation
// useStore.js's own node/edge helpers already keep from the store logic
// around them). src/services/launchStrategyImportFlow.js calls these two
// functions directly against the SPECIFIC project's own actually-
// persisted content (never the active canvas - see that file's own
// header for the ADV-004-FIX-2 contamination bug this fixes).
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

// ADV-005 - Structured Graph Layout. Strategic Objective -> Channel ->
// Preparation (Hypotheses/Actions) -> Experiments -> Evaluation (results,
// added later, organically - never synthesized here). Investigated
// whether an existing layout library was needed first: no - this project
// already only uses React Flow's own node/position model directly (no
// dagre/elkjs in package.json, per FIX-2's own "no heavy new layout
// dependency" precedent), and a standard layered-DAG barycenter heuristic
// is well within what a ~40-line pure function can do correctly.
//
// Runs as a single pass AFTER every node/edge in this import has been
// built (mapStrategyDecisionPackageToGraph calls this right before
// returning) - operates purely on the abstract node/edge shape, not on
// StrategyDecisionPackage-specific fields, so it makes no strategic
// decision of its own: it only ever reads relationships (edges) the
// mapper ABOVE already decided, same "deterministic, never re-planning"
// discipline as the rest of this file.
//
// Per column (nodeType), left to right in strategic order:
//   - A node's desired row is the AVERAGE row of its predecessors (nodes
//     with an edge pointing INTO it) that are already positioned in an
//     EARLIER column - the standard barycenter heuristic, which both
//     "groups activities logically by channel" (an action's predecessor
//     is its channel node) and "minimizes edge crossings" without a real
//     layout engine.
//   - A node with NO positioned predecessor at all (an objective itself,
//     or a genuinely unlinked action/test) sorts AFTER every anchored
//     node in its column, in its own trailing group, by original array
//     order - "avoid long disconnected chains without clear strategic
//     context" by keeping the unanchored ones visually separate rather
//     than randomly interleaved among properly-grouped ones.
// Fully deterministic: the same nodes/edges always produce the same
// positions, and "support graphs with multiple channels and different
// numbers of actions" falls out naturally (no fixed-size assumptions
// anywhere - a channel with 1 action and one with 6 both just get as
// many rows as they need).
const LAYOUT_COLUMN_ORDER = ['idea', 'channel', 'hypothesis', 'action', 'test'];

function computeLayeredLayout(nodes, edges) {
  const predecessorsOf = new Map();
  for (const e of edges) {
    if (!predecessorsOf.has(e.target)) predecessorsOf.set(e.target, []);
    predecessorsOf.get(e.target).push(e.source);
  }

  const rowById = new Map();

  for (const column of LAYOUT_COLUMN_ORDER) {
    const colNodes = nodes.filter((n) => n.data.nodeType === column);
    const keyed = colNodes.map((n, originalIndex) => {
      const anchoredPreds = (predecessorsOf.get(n.id) || []).filter((pid) => rowById.has(pid));
      const hasAnchor = anchoredPreds.length > 0;
      const key = hasAnchor ? anchoredPreds.reduce((sum, pid) => sum + rowById.get(pid), 0) / anchoredPreds.length : originalIndex;
      return { n, key, hasAnchor };
    });
    keyed.sort((a, b) => (a.hasAnchor !== b.hasAnchor ? (a.hasAnchor ? -1 : 1) : a.key - b.key));
    keyed.forEach((k, rowIndex) => rowById.set(k.n.id, rowIndex));
  }

  return nodes.map((n) => ({
    ...n,
    position: { x: COLUMN_X[n.data.nodeType] ?? 40, y: 40 + (rowById.get(n.id) ?? 0) * ROW_Y_STEP },
  }));
}

// ADV-004-FIX-2 - collision avoidance for newly ADDED nodes on a
// re-import into a graph that already has real content at arbitrary,
// user-moved positions. Deliberately simple and dependency-free (no
// dagre/elkjs - "do not introduce a heavy new graph-layout library") -
// this project already uses React Flow's own node/position model
// directly; approximate bounding boxes and a deterministic downward
// shift are enough to satisfy "avoid overlapping node bounding boxes"
// and "support predictable repeated imports" without a real layout
// engine. An UPDATED or PRESERVED node never goes through this - it
// keeps its own existing (possibly user-moved) position untouched,
// which is what "respect existing node positions and user changes"
// actually requires; this path exists ONLY for a decision that has no
// existing node at all yet.
const NODE_WIDTH = 260;
const NODE_HEIGHT = 140;
const COLLISION_GAP = 24;

function rectFor(node) {
  return { x: node.position.x, y: node.position.y, width: NODE_WIDTH, height: NODE_HEIGHT };
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width + COLLISION_GAP &&
    a.x + a.width + COLLISION_GAP > b.x &&
    a.y < b.y + b.height + COLLISION_GAP &&
    a.y + a.height + COLLISION_GAP > b.y
  );
}

// Walks straight down the node's own column from its default grid slot
// until no occupied rect overlaps it - stays in the same x (preserving
// the type-based column grouping the mapper already uses, which is also
// this file's "avoid unnecessary edge crossings where feasible" effort:
// same-type nodes stay visually grouped rather than scattered). Fully
// deterministic given the same occupied set, so repeated imports against
// an unchanged graph produce the same placement every time. Bounded to
// 500 steps so a pathological number of occupied rects can never hang -
// if still colliding at that point the node is placed anyway rather than
// block the import.
function findCollisionFreePosition(desired, occupiedRects) {
  let candidate = { x: desired.x, y: desired.y };
  for (let i = 0; i < 500; i += 1) {
    const candidateRect = { x: candidate.x, y: candidate.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    const collides = occupiedRects.some((r) => rectsOverlap(candidateRect, r));
    if (!collides) return candidate;
    candidate = { x: candidate.x, y: candidate.y + NODE_HEIGHT + COLLISION_GAP };
  }
  return candidate;
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
    // ADV-005 - null for every node except a mapped channel (overridden
    // explicitly where that's built below) - see mockData.js's nd() for
    // why this is a universal, predictable-shape field rather than one
    // only 'channel' nodes happen to carry.
    channelId: null,
  };
}

// ADV-005 - every statement is labeled by what it actually is (a fact vs
// an assumption), never collapsed into one undifferentiated string -
// "preserve assumptions, evidence and unknowns without turning them into
// verified facts" applies here exactly as it already does in Launch
// Studio's own StrategyDecisionReview.tsx. Reused for objectives,
// hypotheses, experiments and channels alike - the one place this file
// turns a StrategicJustification into display text.
function describeJustification(justification) {
  if (!justification) return '';
  const facts = (justification.facts || []).map((f) => f.statement);
  const assumptions = (justification.assumptions || []).map((a) => a.statement);
  const parts = [];
  if (facts.length) parts.push(facts.join('; '));
  if (assumptions.length) parts.push(`Assumption: ${assumptions.join('; ')}`);
  return parts.join(' — ');
}

// ADV-005 - context.why: "strategic rationale," kept logically separate
// from tactics/execution (which live in actionPlan instead). Combines
// this channel's own justification with the objective(s) it was chosen to
// serve, and names any channel-specific unknowns explicitly rather than
// silently dropping them.
function buildChannelRationale(c, relatedObjectiveStatements) {
  const parts = [];
  const justificationText = describeJustification(c.justification);
  if (justificationText) parts.push(justificationText);
  if (relatedObjectiveStatements.length) parts.push(`Supports: ${relatedObjectiveStatements.join('; ')}`);
  if (c.unknowns?.length) parts.push(`Unknown: ${c.unknowns.join('; ')}`);
  return parts.join(' — ');
}

// ADV-005 - context.expectedResult: a qualitative statement of the
// outcome, distinct from actionPlan.kpi's own measurement-method detail.
// Prefers a KPI's own target (the most concrete signal of "what success
// looks like") over the more general positioning text, and never
// fabricates one when neither is known.
function buildExpectedResult(c) {
  const kpiTargets = (c.kpis || []).filter((k) => k.target).map((k) => `${k.metric} → ${k.target}`);
  if (kpiTargets.length) return kpiTargets.join('; ');
  return c.positioningAndMessaging || '';
}

// ADV-005 - actionPlan.kpi: "measurable indicators and methods" - unlike
// an action's single kpi, a channel may have several; each one names both
// the metric and HOW it's measured, never just a bare number.
function formatKpis(kpis) {
  if (!kpis?.length) return '';
  return kpis.map((k) => `${k.metric} (${k.measurementMethod})${k.target ? ` → ${k.target}` : ''}`).join('; ');
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
  // Placeholder - every node's real position is assigned by
  // computeLayeredLayout at the very end, once every node/edge below
  // exists for it to actually compute a layout from.
  const PENDING_POSITION = { x: 0, y: 0 };

  // decisionId -> real react-flow node id, built up as each section is
  // mapped, so later sections (actions depending on channels/hypotheses,
  // experiments depending on hypotheses/actions) can resolve a real edge
  // target even though the package itself only ever uses ITS OWN ids.
  const nodeIdByDecisionId = new Map();

  const objectiveStatementById = new Map((pkg.objectives || []).map((o) => [o.id, o.statement]));

  (pkg.objectives || []).forEach((o) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(o.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: PENDING_POSITION,
      data: baseNodeData('idea', o.statement, describeJustification(o.justification), o.priority, 'todo', exportId, o.id, 'objective'),
    });
  });

  (pkg.channelDecisions || []).forEach((c) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(c.id, id);
    const relatedObjectiveStatements = (c.relatedObjectiveIds || []).map((objId) => objectiveStatementById.get(objId)).filter(Boolean);
    nodes.push({
      id,
      type: 'custom',
      position: PENDING_POSITION,
      data: {
        ...baseNodeData('channel', c.channelName || c.channelId, describeJustification(c.justification), c.priority, 'todo', exportId, c.id, 'channel'),
        // ADV-005 - the canonical catalog id, kept distinct from `label`
        // (the display name set above) - see mockData.js's nd() header.
        channelId: c.channelId || null,
        // Channel-level sequencing - resolved below once every earlier
        // channel in this same forEach already has a real id, same
        // backward-only pattern actions' dependsOnActionIds already uses.
        dependencies: (c.dependsOnChannelIds || []).map((depId) => nodeIdByDecisionId.get(depId)).filter(Boolean),
        // ADV-005 (owner correction) - map to the SEMANTICALLY correct
        // fields, tactics/execution kept separate from rationale:
        context: {
          why: buildChannelRationale(c, relatedObjectiveStatements),
          product: c.valueProposition || '',
          audience: c.targetAudience || '',
          expectedResult: buildExpectedResult(c),
        },
        actionPlan: {
          todo: c.recommendedTactics || c.implementationSteps?.[0] || '',
          tools: c.requiredResources?.tools?.length ? c.requiredResources.tools.join(', ') : '',
          kpi: formatKpis(c.kpis),
          deadline: c.estimatedTimeframe?.end || c.estimatedTimeframe?.label || '',
          executionStatus: 'pending',
          actionItems: c.implementationSteps || [],
          plannedTimeframe: c.estimatedTimeframe || null,
        },
      },
    });
    for (const objId of c.relatedObjectiveIds || []) {
      const sourceId = nodeIdByDecisionId.get(objId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
    for (const depId of c.dependsOnChannelIds || []) {
      const sourceId = nodeIdByDecisionId.get(depId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  (pkg.hypotheses || []).forEach((h) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(h.id, id);
    const evidenceDesc = (h.evidence || []).map((f) => f.statement).join('; ');
    nodes.push({
      id,
      type: 'custom',
      position: PENDING_POSITION,
      data: baseNodeData('hypothesis', h.statement, evidenceDesc, h.confidence, 'todo', exportId, h.id, 'hypothesis'),
    });
    for (const objId of h.relatedObjectiveIds || []) {
      const sourceId = nodeIdByDecisionId.get(objId);
      if (sourceId) edges.push(makeEdge(sourceId, id));
    }
  });

  (pkg.actions || []).forEach((a) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(a.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: PENDING_POSITION,
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

  (pkg.experiments || []).forEach((e) => {
    const id = genNodeId();
    nodeIdByDecisionId.set(e.id, id);
    nodes.push({
      id,
      type: 'custom',
      position: PENDING_POSITION,
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

  // ADV-005 - a channel's suggestedExperimentIds can only be resolved
  // once the experiments section above has run (experiments are mapped
  // AFTER channels, so their real node ids don't exist yet during the
  // channel forEach) - a final, explicit pass here, after every decision
  // in this package has a real node id.
  (pkg.channelDecisions || []).forEach((c) => {
    const channelNodeId = nodeIdByDecisionId.get(c.id);
    if (!channelNodeId) return;
    for (const expId of c.suggestedExperimentIds || []) {
      const targetId = nodeIdByDecisionId.get(expId);
      if (targetId) edges.push(makeEdge(channelNodeId, targetId));
    }
  });

  return { nodes: computeLayeredLayout(nodes, edges), edges };
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
//  1. mapped decision, no existing match          -> ADD as a new node,
//     collision-free (see findCollisionFreePosition above)
//  2. mapped decision, existing match, NOT edited  -> UPDATE in place,
//     keeping the existing node's own position untouched
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
      // Collision avoidance against EVERY node already placed so far in
      // this reconciliation (pre-existing nodes at their own real
      // positions, plus every earlier node this same batch already
      // added) - never against an unrelated graph, since resultNodes
      // only ever starts from THIS decision's own existingNodes (see
      // launchStrategyImportFlow.js's own fix).
      const occupiedRects = resultNodes.map(rectFor);
      const freePosition = findCollisionFreePosition(mapped.position, occupiedRects);
      const placedNode = freePosition === mapped.position ? mapped : { ...mapped, position: freePosition };
      resultNodes.push(placedNode);
      resolvedNodeId.set(decisionId, placedNode.id);
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
