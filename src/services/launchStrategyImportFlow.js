// ADV-004-FIX-2 - orchestrates the full "Import Strategy from Launch
// Studio" / "Update from Launch Studio" action, fixed for the Production
// contamination bug: selecting an ADVESER Project is only a CONTEXT
// choice (useStore.js's own comment on activeAdveserProjectId) - it never
// guarantees the corresponding cloud strategy is the one currently
// loaded on the canvas. The ORIGINAL version of this function merged the
// imported package directly into `useStore.getState().nodes/edges` -
// whatever happened to be on screen, completely unrelated or not -
// before ever checking which strategy (if any) actually belongs to this
// project. That is the exact root cause of the reported "8 added, 0
// updated" overlap: the import landed on top of an unrelated,
// already-open graph.
//
// This function never reads or writes the ACTIVE canvas at any point -
// not even after a successful import (ADV-004-FIX-2 final correction:
// the result now opens in a NEW BROWSER TAB, which loads the strategy
// independently from persistent storage via useOpenStrategyFromUrl.js,
// never from this tab's in-memory state - see that hook's own header).
// This is what makes "the original tab and its currently open graph must
// remain completely unchanged" true unconditionally, success or failure,
// not just on failure. It always resolves the correct target explicitly:
//   - No existing strategy for this project (first import): reconcile
//     against an EMPTY graph (nothing to merge with at all - the mapped
//     nodes ARE the result) and create a new row.
//   - An existing strategy for this project (re-import / explicit
//     "Update from Launch Studio"): fetch THAT strategy's own full,
//     actually-persisted nodes/edges via getStrategy(existing.id) -
//     never whatever is visible on screen - and reconcile against those,
//     then update that SAME row in place.
// If createStrategy/updateStrategy throws, the caller's own popup/tab
// handling (AdveserProjectsSelector.jsx) is responsible for not leaving
// a misleading blank tab open - this function itself touches nothing
// else on any failure.
//
// Deliberately a plain function, not a React hook - it has no component-
// bound state of its own, just a sequence of store reads (addCloudProject
// only, via Zustand's vanilla getState, which works outside React) and
// service calls. Exported separately from the UI so the ADD-vs-UPDATE
// branch and the result summary are testable without mounting any
// component.
//
// ADV-004-FIX-2 (final correction) - "open that strategy" vs "update
// from Launch Studio" are now two DISTINCT, explicit actions
// (AdveserProjectsSelector.jsx calls this function only for the
// first-import and the explicit-update cases; simply OPENING an already-
// linked strategy never calls this function at all, so it never
// regenerates or reconciles anything merely because the user wants to
// look at it).

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
  let updatedCount;
  let addedCount;
  let preservedCount;

  if (existingSummary) {
    // Re-import: reconcile against THIS project's own strategy's REAL,
    // currently-persisted content - a full fetch, never the list-row
    // summary (which doesn't even carry edges) and never the canvas.
    const existingFull = await getStrategy(existingSummary.id);
    const result = reconcileImportedGraph(existingFull.nodes || [], existingFull.edges || [], mappedNodes, mappedEdges);
    updatedCount = result.updatedCount;
    addedCount = result.addedCount;
    preservedCount = result.preservedCount;

    const saved = await updateStrategy(existingSummary.id, { nodes: result.nodes, edges: result.edges, sourceLaunchAnalysisId: exported.id });
    strategyId = saved.id;
  } else {
    // First import: nothing exists yet for this project - reconciling
    // against an empty graph is just "every mapped node is new", the
    // same collision-avoidance pass runs regardless (a fresh grid never
    // collides with nothing), and nothing on screen is read or touched.
    const result = reconcileImportedGraph([], [], mappedNodes, mappedEdges);
    updatedCount = result.updatedCount;
    addedCount = result.addedCount;
    preservedCount = result.preservedCount;

    const saved = await createStrategy({
      name: adveserProjectName || 'Strategy from Launch Studio',
      nodes: result.nodes,
      edges: result.edges,
      productInfo: { name: adveserProjectName || 'Strategy from Launch Studio' },
      projectId: adveserProjectId,
      sourceLaunchAnalysisId: exported.id,
    });
    strategyId = saved.id;
    // Still useful here even though this tab's canvas is never switched
    // to it - keeps the existing Cloud Projects list (TopBar's
    // ProjectSwitcher) in sync so the strategy is "available later
    // through the existing Cloud Projects interface" (requirement 7)
    // without that list needing its own separate refetch.
    useStore.getState().addCloudProject(saved);
  }

  return { status: 'imported', updatedCount, addedCount, preservedCount, strategyId };
}
