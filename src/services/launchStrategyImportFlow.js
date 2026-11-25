// ADV-004 - orchestrates the full "Import Strategy from Launch Studio"
// action: fetch the approved export, merge it into the graph (never a
// wholesale replace - see useStore.js's importStrategyGraph), then
// persist to the ONE cloud strategy row linked to this ADVESER project
// (creating it on first import, updating it in place on every later
// re-import - the one-row-per-project idempotency model this repo's own
// migrations establish).
//
// Deliberately a plain function, not a React hook - it has no component-
// bound state of its own, just a sequence of store reads/writes (via
// Zustand's vanilla getState/setState, which works outside React) and
// service calls. Exported separately from the UI so the ADD-vs-UPDATE
// branch and the result summary are testable without mounting any
// component.

import { useStore } from '../store/useStore';
import { getApprovedStrategyExport } from './launchStrategyImport';
import { findStrategyByProjectId, createStrategy, updateStrategy } from './strategies';

export async function importLaunchStrategy(adveserProjectId, adveserProjectName) {
  const exported = await getApprovedStrategyExport(adveserProjectId);
  if (!exported) {
    return { status: 'no-export' };
  }

  const { updatedCount, addedCount, preservedCount } = useStore.getState().importStrategyGraph(
    exported.strategyDecisionPackage,
    exported.id
  );

  const { nodes, edges, productInfo } = useStore.getState();
  const existing = await findStrategyByProjectId(adveserProjectId);

  let strategyId;
  let updatedAt;
  if (existing) {
    const saved = await updateStrategy(existing.id, { nodes, edges, sourceLaunchAnalysisId: exported.id });
    strategyId = saved.id;
    updatedAt = saved.updatedAt;
  } else {
    const saved = await createStrategy({
      name: adveserProjectName || 'Strategy from Launch Studio',
      nodes,
      edges,
      productInfo,
      projectId: adveserProjectId,
      sourceLaunchAnalysisId: exported.id,
    });
    strategyId = saved.id;
    updatedAt = saved.updatedAt;
    useStore.getState().addCloudProject(saved);
  }

  // Whether this project's strategy was just created or updated, it is
  // now the active cloud project with a fresh dirty-check baseline -
  // same "the one place that (re)establishes this" role
  // setActiveCloudProject already documents in useStore.js.
  useStore.getState().setActiveCloudProject(strategyId, updatedAt);

  return { status: 'imported', updatedCount, addedCount, preservedCount, strategyId };
}
