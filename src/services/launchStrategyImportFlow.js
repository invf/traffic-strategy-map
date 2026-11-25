// ADV-004-FIX-2 - orchestrates the full "Import Strategy from Launch
// Studio" action, fixed for the Production contamination bug: selecting
// an ADVESER Project is only a CONTEXT choice (useStore.js's own comment
// on activeAdveserProjectId) - it never guarantees the corresponding
// cloud strategy is the one currently loaded on the canvas. The
// PREVIOUS version of this function merged the imported package directly
// into `useStore.getState().nodes/edges` - whatever happened to be on
// screen, completely unrelated or not - before ever checking which
// strategy (if any) actually belongs to this project. That is the exact
// root cause of the reported "8 added, 0 updated" overlap: the import
// landed on top of an unrelated, already-open graph.
//
// Fixed shape: this function never reads or writes the ACTIVE canvas
// (`useStore.getState().nodes/edges`) at any point during generation or
// persistence. It always resolves the correct target explicitly:
//   - No existing strategy for this project (first import): reconcile
//     against an EMPTY graph (nothing to merge with at all - the mapped
//     nodes ARE the result) and create a new row.
//   - An existing strategy for this project (re-import): fetch THAT
//     strategy's own full, actually-persisted nodes/edges via
//     getStrategy(existing.id) - never whatever is visible on screen -
//     and reconcile against those, then update that SAME row in place.
// Only after persistence succeeds does it touch the canvas at all, via
// loadStrategy() - the same atomic "replace canvas + active identity"
// primitive every other cloud-project switch in this app already uses.
// If createStrategy/updateStrategy throws, execution never reaches that
// line, so a failed persistence leaves the active canvas completely
// untouched - no partial in-memory mutation of whatever the user had
// open (requirement 5).
//
// Deliberately a plain function, not a React hook - it has no component-
// bound state of its own, just a sequence of store reads/writes (via
// Zustand's vanilla getState/setState, which works outside React) and
// service calls. Exported separately from the UI so the ADD-vs-UPDATE
// branch and the result summary are testable without mounting any
// component.

import { useStore } from '../store/useStore';
import { getApprovedStrategyExport } from './launchStrategyImport';
import { findStrategyByProjectId, getStrategy, createStrategy, updateStrategy } from './strategies';
import { mapStrategyDecisionPackageToGraph, reconcileImportedGraph } from '../utils/strategyDecisionMapping';

export async function importLaunchStrategy(adveserProjectId, adveserProjectName) {
  const exported = await getApprovedStrategyExport(adveserProjectId);
  if (!exported) {
    return { status: 'no-export' };
  }

  const { nodes: mappedNodes, edges: mappedEdges } = mapStrategyDecisionPackageToGraph(exported.strategyDecisionPackage, exported.id);

  // The ONLY lookup this function trusts to decide "does a strategy
  // already exist for this project" - the project_id column itself,
  // never whichever strategy happens to be active/visible right now.
  const existingSummary = await findStrategyByProjectId(adveserProjectId);

  let strategyId;
  let updatedAt;
  let finalProductInfo;
  let finalAiSuggestions;
  let updatedCount;
  let addedCount;
  let preservedCount;
  let finalNodes;
  let finalEdges;

  if (existingSummary) {
    // Re-import: reconcile against THIS project's own strategy's REAL,
    // currently-persisted content - a full fetch, never the list-row
    // summary (which doesn't even carry edges) and never the canvas.
    const existingFull = await getStrategy(existingSummary.id);
    const result = reconcileImportedGraph(existingFull.nodes || [], existingFull.edges || [], mappedNodes, mappedEdges);
    finalNodes = result.nodes;
    finalEdges = result.edges;
    updatedCount = result.updatedCount;
    addedCount = result.addedCount;
    preservedCount = result.preservedCount;
    finalProductInfo = existingFull.productInfo;
    finalAiSuggestions = existingFull.aiSuggestions;

    const saved = await updateStrategy(existingSummary.id, { nodes: finalNodes, edges: finalEdges, sourceLaunchAnalysisId: exported.id });
    strategyId = saved.id;
    updatedAt = saved.updatedAt;
  } else {
    // First import: nothing exists yet for this project - reconciling
    // against an empty graph is just "every mapped node is new", the
    // same collision-avoidance pass runs regardless (a fresh grid never
    // collides with nothing), and nothing on screen is read or touched.
    const result = reconcileImportedGraph([], [], mappedNodes, mappedEdges);
    finalNodes = result.nodes;
    finalEdges = result.edges;
    updatedCount = result.updatedCount;
    addedCount = result.addedCount;
    preservedCount = result.preservedCount;
    finalProductInfo = { name: adveserProjectName || 'Strategy from Launch Studio' };
    finalAiSuggestions = null;

    const saved = await createStrategy({
      name: adveserProjectName || 'Strategy from Launch Studio',
      nodes: finalNodes,
      edges: finalEdges,
      productInfo: finalProductInfo,
      projectId: adveserProjectId,
      sourceLaunchAnalysisId: exported.id,
    });
    strategyId = saved.id;
    updatedAt = saved.updatedAt;
    useStore.getState().addCloudProject(saved);
  }

  // Only now, after persistence has actually succeeded, replace the
  // canvas - requirement 1/2's "automatically display" - using the SAME
  // atomic primitive (id/source/activeProjectSource/dirty-baseline all
  // set together) every other cloud-project switch already uses.
  useStore.getState().loadStrategy({
    id: strategyId,
    nodes: finalNodes,
    edges: finalEdges,
    productInfo: finalProductInfo,
    aiSuggestions: finalAiSuggestions,
    updatedAt,
  });

  return { status: 'imported', updatedCount, addedCount, preservedCount, strategyId };
}
