// AUTH-004 - the bridge between useAuth's status/email transitions and
// the store's cloud-project list. Mocks useAuth and services/strategies
// only - the REAL zustand store (src/store/useStore.js) is used, so
// these assertions are about the actual hydrate/clear/no-merge behavior
// the ticket requires, not a reimplementation of it in a mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('./useAuth', () => ({ useAuth: () => mockUseAuth() }));

const listStrategies = vi.fn();
vi.mock('../services/strategies', () => ({ listStrategies: (...a) => listStrategies(...a) }));

import { useCloudProjectsSync } from './useCloudProjectsSync';
import { useStore } from '../store/useStore';

const RESET_STATE = {
  projects: [{ id: 'proj_local_1', name: 'My Local Draft', nodes: [], edges: [], productInfo: {} }],
  activeProjectId: 'proj_local_1',
  activeProjectSource: 'local',
  cloudProjects: [],
  activeCloudUpdatedAt: null,
  lastSyncedSnapshot: null,
};

describe('useCloudProjectsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState(RESET_STATE);
  });

  it('scenario 1 (anonymous local draft): while signed-out, never calls listStrategies and cloudProjects stays empty', async () => {
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null });
    renderHook(() => useCloudProjectsSync());

    expect(listStrategies).not.toHaveBeenCalled();
    expect(useStore.getState().cloudProjects).toEqual([]);
    // The Local Draft is completely unaffected by this hook.
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().activeProjectId).toBe('proj_local_1');
  });

  it('scenario 2 (login/account hydration): becoming authenticated fetches and hydrates the cloud project list exactly once', async () => {
    const list = [{ id: 'cloud-1', name: 'A cloud project', updatedAt: '2026-01-01T00:00:00Z' }];
    listStrategies.mockResolvedValue(list);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useCloudProjectsSync());

    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual(list));
    expect(listStrategies).toHaveBeenCalledTimes(1);
  });

  it('scenario 4/6 (two accounts, one browser): switching the authenticated email wholesale-replaces the list, never merges', async () => {
    const listA = [{ id: 'a-1', name: "A's project" }];
    const listB = [{ id: 'b-1', name: "B's project" }];
    listStrategies.mockResolvedValueOnce(listA).mockResolvedValueOnce(listB);

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    const { rerender } = renderHook(() => useCloudProjectsSync());
    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual(listA));

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'b@example.com' });
    rerender();
    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual(listB));

    // The critical assertion: zero residual entries from A's list survive the switch.
    expect(useStore.getState().cloudProjects.some((p) => p.id === 'a-1')).toBe(false);
  });

  it('scenario 5/7 (logout then different account): signing out clears the cloud list and falls back to a Local Draft, leaving Local Drafts untouched', async () => {
    useStore.setState({
      ...RESET_STATE,
      cloudProjects: [{ id: 'cloud-1', name: 'Was active cloud project' }],
      activeProjectId: 'cloud-1',
      activeProjectSource: 'cloud',
      activeCloudUpdatedAt: '2026-01-01T00:00:00Z',
    });
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null });
    renderHook(() => useCloudProjectsSync());

    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual([]));
    expect(useStore.getState().activeProjectSource).toBe('local');
    expect(useStore.getState().activeProjectId).toBe('proj_local_1');
    // The Local Draft itself was never touched by the sign-out.
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().projects[0].id).toBe('proj_local_1');
  });

  it('scenario 3 (cross-browser-equivalent consistency): hydrating from the same server list is a pure function of that list, not of prior state', async () => {
    const list = [{ id: 'shared-1', name: 'Same for everyone' }];
    listStrategies.mockResolvedValue(list);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });

    renderHook(() => useCloudProjectsSync());
    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual(list));
    const firstResult = useStore.getState().cloudProjects;

    // Simulate a second, independent "browser" starting from a totally
    // different prior state, hydrated from the exact same server list.
    useStore.setState({ ...RESET_STATE, projects: [{ id: 'different_local', name: 'Unrelated', nodes: [], edges: [], productInfo: {} }] });
    renderHook(() => useCloudProjectsSync());
    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual(list));

    expect(useStore.getState().cloudProjects).toEqual(firstResult);
  });

  it('race safety: a slower, now-stale fetch resolving after a faster account switch never overwrites the newer result', async () => {
    let resolveSlowA;
    listStrategies
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlowA = resolve; }))
      .mockResolvedValueOnce([{ id: 'b-1', name: "B's project" }]);

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    const { rerender } = renderHook(() => useCloudProjectsSync());

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'b@example.com' });
    rerender();
    await waitFor(() => expect(useStore.getState().cloudProjects).toEqual([{ id: 'b-1', name: "B's project" }]));

    // A's slow fetch finally resolves AFTER B's already landed - must be discarded, not applied.
    resolveSlowA([{ id: 'a-1', name: "A's project" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().cloudProjects).toEqual([{ id: 'b-1', name: "B's project" }]);
  });
});
