// ADV-003 - mirrors useCloudProjectsSync.test.jsx's exact convention
// (mock useAuth + the service, use the REAL store). Additionally covers
// the `?project=<uuid>` URL-arrival behavior: the critical property is
// that an id is NEVER applied unless it is actually present in the
// server-verified list the fetch just returned (requirement C/D - a URL
// value is never authorization by itself).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('./useAuth', () => ({ useAuth: () => mockUseAuth() }));

const listAdveserProjects = vi.fn();
vi.mock('../services/adveserProjects', () => ({ listAdveserProjects: (...a) => listAdveserProjects(...a) }));

import { useAdveserProjectsSync } from './useAdveserProjectsSync';
import { useStore } from '../store/useStore';

const RESET_STATE = {
  adveserProjects: [],
  activeAdveserProjectId: null,
};

// jsdom's actual default origin (set by the test environment, not
// necessarily "http://localhost/") - replaceState refuses to cross
// origins, so every URL used here is built relative to it.
const ORIGIN = window.location.origin;
function setUrl(pathAndQuery) {
  window.history.replaceState({}, '', `${ORIGIN}${pathAndQuery}`);
}

describe('useAdveserProjectsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState(RESET_STATE);
    setUrl('/');
  });

  afterEach(() => {
    setUrl('/');
  });

  it('while signed-out, never calls listAdveserProjects and the list stays empty', async () => {
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null });
    renderHook(() => useAdveserProjectsSync());

    expect(listAdveserProjects).not.toHaveBeenCalled();
    expect(useStore.getState().adveserProjects).toEqual([]);
  });

  it('becoming authenticated fetches and hydrates the ADVESER Projects list exactly once', async () => {
    const list = [{ id: 'proj-1', name: 'Shared Project', role: 'owner' }];
    listAdveserProjects.mockResolvedValue(list);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual(list));
    expect(listAdveserProjects).toHaveBeenCalledTimes(1);
  });

  it('switching the authenticated email wholesale-replaces the list, never merges', async () => {
    const listA = [{ id: 'a-1', name: "A's project", role: 'owner' }];
    const listB = [{ id: 'b-1', name: "B's project", role: 'owner' }];
    listAdveserProjects.mockResolvedValueOnce(listA).mockResolvedValueOnce(listB);

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    const { rerender } = renderHook(() => useAdveserProjectsSync());
    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual(listA));

    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'b@example.com' });
    rerender();
    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual(listB));

    expect(useStore.getState().adveserProjects.some((p) => p.id === 'a-1')).toBe(false);
  });

  it('signing out clears the list and the active selection', async () => {
    useStore.setState({ adveserProjects: [{ id: 'p-1', name: 'Was active', role: 'owner' }], activeAdveserProjectId: 'p-1' });
    mockUseAuth.mockReturnValue({ status: 'signed-out', email: null });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual([]));
    expect(useStore.getState().activeAdveserProjectId).toBeNull();
  });

  it('a `?project=` URL param matching a project in the fetched list is applied as the active project', async () => {
    setUrl('/?project=proj-42');
    const list = [{ id: 'proj-42', name: 'Linked From Launch Studio', role: 'collaborator' }];
    listAdveserProjects.mockResolvedValue(list);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().activeAdveserProjectId).toBe('proj-42'));
  });

  it('a `?project=` URL param that does NOT match any project in the fetched list is silently ignored - never applied, never treated as authorization', async () => {
    setUrl('/?project=does-not-exist');
    const list = [{ id: 'proj-42', name: 'A real project', role: 'owner' }];
    listAdveserProjects.mockResolvedValue(list);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual(list));
    expect(useStore.getState().activeAdveserProjectId).toBeNull();
  });

  it('the `project` param is stripped from the URL after being consumed', async () => {
    setUrl('/?project=proj-42&other=keep');
    listAdveserProjects.mockResolvedValue([{ id: 'proj-42', name: 'X', role: 'owner' }]);
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().activeAdveserProjectId).toBe('proj-42'));
    expect(window.location.search).not.toContain('project=');
    expect(window.location.search).toContain('other=keep');
  });

  it('a failed fetch hydrates an empty list rather than leaving a stale one', async () => {
    useStore.setState({ adveserProjects: [{ id: 'stale', name: 'Stale', role: 'owner' }] });
    listAdveserProjects.mockRejectedValue(new Error('503'));
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com' });
    renderHook(() => useAdveserProjectsSync());

    await waitFor(() => expect(useStore.getState().adveserProjects).toEqual([]));
  });
});
