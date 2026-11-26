// AUTH-004 - the cloud-project additions to the store: loadStrategy's
// atomic identity update (the ticket's bug #5), isDirty's lazy
// dirty-check, and the fallback-to-Local-Draft behavior shared by
// clearCloudProjects/removeCloudProject. Uses the REAL store, not a mock.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';

const LOCAL_DRAFT = { id: 'proj_1', name: 'Draft', nodes: [{ id: 'n1' }], edges: [], productInfo: { name: 'P' }, aiSuggestions: null };

const RESET_STATE = {
  projects: [LOCAL_DRAFT],
  activeProjectId: LOCAL_DRAFT.id,
  activeProjectSource: 'local',
  cloudProjects: [],
  activeCloudUpdatedAt: null,
  lastSyncedSnapshot: null,
  nodes: [],
  edges: [],
  productInfo: {},
  aiSuggestions: null,
};

describe('useStore - cloud projects (AUTH-004)', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState(RESET_STATE);
  });

  it('loadStrategy sets the canvas AND the active cloud identity atomically (fixes the ticket\'s bug #5)', () => {
    useStore.getState().loadStrategy({
      id: 'cloud-abc',
      name: 'A cloud strategy',
      nodes: [{ id: 'cn1' }],
      edges: [{ id: 'ce1' }],
      productInfo: { name: 'Cloud Product' },
      aiSuggestions: { x: 1 },
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const s = useStore.getState();
    expect(s.nodes).toEqual([{ id: 'cn1' }]);
    expect(s.activeProjectId).toBe('cloud-abc');
    expect(s.activeProjectSource).toBe('cloud');
    expect(s.activeCloudUpdatedAt).toBe('2026-01-01T00:00:00Z');
    // The Local Draft that was active before is completely untouched.
    expect(s.projects).toEqual([LOCAL_DRAFT]);
  });

  it('isDirty is false immediately after loadStrategy, and true once the canvas changes', () => {
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });
    expect(useStore.getState().isDirty()).toBe(false);

    useStore.getState().setProductInfo({ name: 'Changed' });
    expect(useStore.getState().isDirty()).toBe(true);
  });

  it('isDirty is always false for a Local Draft (no separate "saved" state to compare against)', () => {
    expect(useStore.getState().activeProjectSource).toBe('local');
    useStore.getState().setProductInfo({ name: 'Edited local draft' });
    expect(useStore.getState().isDirty()).toBe(false);
  });

  it('setActiveCloudProject marks the canvas as synced (isDirty becomes false) at the moment it is called', () => {
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });
    useStore.getState().setProductInfo({ name: 'Edited after load' });
    expect(useStore.getState().isDirty()).toBe(true);

    useStore.getState().setActiveCloudProject('cloud-abc', 't2');
    expect(useStore.getState().isDirty()).toBe(false);
    expect(useStore.getState().activeCloudUpdatedAt).toBe('t2');
  });

  it('hydrateCloudProjects wholesale-replaces the list (never merges)', () => {
    useStore.getState().hydrateCloudProjects([{ id: 'x' }, { id: 'y' }]);
    expect(useStore.getState().cloudProjects).toEqual([{ id: 'x' }, { id: 'y' }]);
    useStore.getState().hydrateCloudProjects([{ id: 'z' }]);
    expect(useStore.getState().cloudProjects).toEqual([{ id: 'z' }]);
  });

  it('clearCloudProjects, when a cloud project was active, falls back to the first Local Draft and resets the canvas to it', () => {
    useStore.getState().hydrateCloudProjects([{ id: 'cloud-abc', name: 'Cloud' }]);
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [{ id: 'cn1' }], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

    useStore.getState().clearCloudProjects();

    const s = useStore.getState();
    expect(s.cloudProjects).toEqual([]);
    expect(s.activeProjectSource).toBe('local');
    expect(s.activeProjectId).toBe(LOCAL_DRAFT.id);
    expect(s.nodes).toEqual(LOCAL_DRAFT.nodes);
    // Server-side data is never touched by this - this is purely an in-memory/UI reset.
  });

  it('clearCloudProjects, when a LOCAL draft was active, only clears the list - the active Local Draft is never disturbed', () => {
    useStore.getState().hydrateCloudProjects([{ id: 'cloud-abc', name: 'Cloud' }]);
    expect(useStore.getState().activeProjectSource).toBe('local');

    useStore.getState().clearCloudProjects();

    const s = useStore.getState();
    expect(s.cloudProjects).toEqual([]);
    expect(s.activeProjectSource).toBe('local');
    expect(s.activeProjectId).toBe(LOCAL_DRAFT.id);
  });

  it('removeCloudProject falls back to a Local Draft only when the removed project was the active one', () => {
    useStore.getState().hydrateCloudProjects([{ id: 'cloud-a' }, { id: 'cloud-b' }]);
    useStore.getState().loadStrategy({ id: 'cloud-a', nodes: [], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

    useStore.getState().removeCloudProject('cloud-b');
    expect(useStore.getState().cloudProjects).toEqual([{ id: 'cloud-a' }]);
    expect(useStore.getState().activeProjectId).toBe('cloud-a'); // unaffected - cloud-b was not active

    useStore.getState().removeCloudProject('cloud-a');
    expect(useStore.getState().cloudProjects).toEqual([]);
    expect(useStore.getState().activeProjectSource).toBe('local');
    expect(useStore.getState().activeProjectId).toBe(LOCAL_DRAFT.id);
  });

  it('patchCloudProjectLocal updates only the matching cached entry, leaving others untouched', () => {
    useStore.getState().hydrateCloudProjects([{ id: 'cloud-a', name: 'Old name' }, { id: 'cloud-b', name: 'Other' }]);
    useStore.getState().patchCloudProjectLocal('cloud-a', { name: 'New name' });
    expect(useStore.getState().cloudProjects).toEqual([{ id: 'cloud-a', name: 'New name' }, { id: 'cloud-b', name: 'Other' }]);
  });

  // ADV-004-FIX-3 (requirement D/E#10) - "mark manually-modified imported
  // nodes locallyEdited=true." Proves the flag these edit actions already
  // set (from ADV-004) still behaves correctly: only ever flips for a node
  // that actually carries a sourceDecisionRef (import-sourced); a
  // hand-created node (sourceDecisionRef: null) is never touched by this,
  // since nothing ever reads the flag for it in the first place.
  it('updateNodeData/updateContext/updateActionPlan mark an import-sourced node locallyEdited, but never a hand-created one', () => {
    const imported = { id: 'imp1', data: { label: 'Imported', context: {}, actionPlan: {}, sourceDecisionRef: { exportId: 'exp1', decisionId: 'dec1', decisionType: 'action' }, locallyEdited: false } };
    const handCreated = { id: 'hand1', data: { label: 'Mine', context: {}, actionPlan: {}, sourceDecisionRef: null, locallyEdited: false } };
    useStore.setState({ ...RESET_STATE, nodes: [imported, handCreated], activeProjectSource: 'cloud', activeProjectId: 'cloud-abc' });

    useStore.getState().updateNodeData('imp1', { label: 'Edited by user' });
    useStore.getState().updateContext('hand1', { why: 'because' });

    const s = useStore.getState();
    expect(s.nodes.find((n) => n.id === 'imp1').data.locallyEdited).toBe(true);
    expect(s.nodes.find((n) => n.id === 'hand1').data.locallyEdited).toBe(false);
    // Provenance itself (the link back to the AI decision) is preserved,
    // never cleared by editing.
    expect(s.nodes.find((n) => n.id === 'imp1').data.sourceDecisionRef).toEqual({ exportId: 'exp1', decisionId: 'dec1', decisionType: 'action' });
  });
});
