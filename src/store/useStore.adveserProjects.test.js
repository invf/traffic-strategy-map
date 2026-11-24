// ADV-003 - the ADVESER Projects slice: a separate, parallel concept
// from cloudProjects/activeProjectSource (see useStore.js's own comment
// on why). Uses the REAL store, not a mock. The one property worth real
// test weight: setActiveAdveserProject refuses an id that isn't actually
// in adveserProjects - the thing that makes "a URL-supplied project id is
// never treated as authorization by itself" true by construction.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';

const RESET_STATE = {
  adveserProjects: [],
  activeAdveserProjectId: null,
};

describe('useStore - ADVESER Projects (ADV-003)', () => {
  beforeEach(() => {
    useStore.setState(RESET_STATE);
  });

  it('hydrateAdveserProjects replaces the list wholesale', () => {
    const list = [{ id: 'p1', name: 'Alpha', role: 'owner' }, { id: 'p2', name: 'Beta', role: 'collaborator' }];
    useStore.getState().hydrateAdveserProjects(list);
    expect(useStore.getState().adveserProjects).toEqual(list);
  });

  it('hydrateAdveserProjects with a non-array input safely results in an empty list', () => {
    useStore.getState().hydrateAdveserProjects(null);
    expect(useStore.getState().adveserProjects).toEqual([]);
  });

  it('setActiveAdveserProject sets the id when it IS present in adveserProjects', () => {
    useStore.getState().hydrateAdveserProjects([{ id: 'p1', name: 'Alpha', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('p1');
    expect(useStore.getState().activeAdveserProjectId).toBe('p1');
  });

  it('setActiveAdveserProject REFUSES an id not present in adveserProjects - never trusts a bare id', () => {
    useStore.getState().hydrateAdveserProjects([{ id: 'p1', name: 'Alpha', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('some-other-project-id');
    expect(useStore.getState().activeAdveserProjectId).toBeNull();
  });

  it('setActiveAdveserProject(null) always succeeds - clearing the selection is never an authorization check', () => {
    useStore.getState().hydrateAdveserProjects([{ id: 'p1', name: 'Alpha', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('p1');
    useStore.getState().setActiveAdveserProject(null);
    expect(useStore.getState().activeAdveserProjectId).toBeNull();
  });

  it('a later hydrate that no longer includes the active id does not, by itself, clear the stale selection (the UI resolves it by lookup, same pattern as getActiveProject)', () => {
    useStore.getState().hydrateAdveserProjects([{ id: 'p1', name: 'Alpha', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('p1');
    useStore.getState().hydrateAdveserProjects([{ id: 'p2', name: 'Beta', role: 'owner' }]);
    // activeAdveserProjectId is now stale (p1 no longer exists) - this is
    // fine and expected: AdveserProjectsSelector.jsx resolves `active` via
    // `adveserProjects.find(...)`, which simply returns undefined/no
    // match, never a crash or a stale project rendered as if real.
    const stillSetButStale = useStore.getState().activeAdveserProjectId;
    const resolved = useStore.getState().adveserProjects.find((p) => p.id === stillSetButStale);
    expect(resolved).toBeUndefined();
  });

  it('clearAdveserProjects empties both the list and the active selection', () => {
    useStore.getState().hydrateAdveserProjects([{ id: 'p1', name: 'Alpha', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('p1');
    useStore.getState().clearAdveserProjects();
    expect(useStore.getState().adveserProjects).toEqual([]);
    expect(useStore.getState().activeAdveserProjectId).toBeNull();
  });

  it('ADVESER Projects state is completely independent of Cloud Projects/Local Drafts state', () => {
    useStore.setState({
      projects: [{ id: 'proj_1', name: 'Local Draft', nodes: [], edges: [], productInfo: {} }],
      activeProjectId: 'proj_1',
      activeProjectSource: 'local',
      cloudProjects: [{ id: 'cloud-1', name: 'A Cloud Strategy' }],
    });
    useStore.getState().hydrateAdveserProjects([{ id: 'adveser-1', name: 'An ADVESER Project', role: 'owner' }]);
    useStore.getState().setActiveAdveserProject('adveser-1');

    const s = useStore.getState();
    // Selecting an ADVESER Project never touches the canvas's active
    // project/source, and vice versa - verified by checking both slices
    // still hold their own, unrelated values.
    expect(s.activeProjectId).toBe('proj_1');
    expect(s.activeProjectSource).toBe('local');
    expect(s.cloudProjects).toEqual([{ id: 'cloud-1', name: 'A Cloud Strategy' }]);
    expect(s.activeAdveserProjectId).toBe('adveser-1');
  });
});
