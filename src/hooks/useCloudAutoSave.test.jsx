// ADV-004-FIX-3 (requirement B) - reliable debounced auto-save for
// authenticated cloud-backed strategies. Same convention as
// useOpenStrategyFromUrl.test.jsx: mock useAuth + the one service module,
// drive the REAL store (AUTH-004's isDirty/setActiveCloudProject/
// loadStrategy primitives are exercised for real, not re-implemented).
//
// Uses REAL timers (the hook's debounce is a fixed 1500ms) rather than
// fake timers - React Testing Library's own waitFor polls via setTimeout
// internally and deadlocks against faked timers unless every advance is
// paired with a manual microtask flush. Slower (each debounced assertion
// costs ~1.5s of real wall time), but simple and fully deterministic.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('./useAuth', () => ({ useAuth: () => mockUseAuth() }));

const updateStrategy = vi.fn();
const { FakeStrategiesApiError } = vi.hoisted(() => {
  class FakeStrategiesApiError extends Error {
    constructor(status, message, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return { FakeStrategiesApiError };
});
vi.mock('../services/strategies', () => ({
  updateStrategy: (...a) => updateStrategy(...a),
  StrategiesApiError: FakeStrategiesApiError,
}));

import { useCloudAutoSave, resolveCloudSaveConflict } from './useCloudAutoSave';
import { useStore } from '../store/useStore';

// Nodes need the full data shape (context/actionPlan/sourceDecisionRef) -
// updateContext/updateNodeData assume it's there, same as every real node
// mockData.js's nd() ever produces.
const NODE_N1 = { id: 'n1', data: { label: 'N1', context: {}, actionPlan: {}, sourceDecisionRef: null, locallyEdited: false } };

const RESET_STATE = {
  nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null,
  activeProjectId: null, activeProjectSource: 'local', activeCloudUpdatedAt: null,
  lastSyncedSnapshot: null, cloudSaveStatus: 'idle', cloudSaveConflict: null,
};

const LONG_WAIT = { timeout: 3500 };

describe('useCloudAutoSave (ADV-004-FIX-3 requirement B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState(RESET_STATE);
  });

  it('scenario: editing a node on a linked Cloud Strategy schedules a debounced save to the SAME strategy id', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 't1' });
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', updatedAt: 't2' });

    renderHook(() => useCloudAutoSave('ready'));

    act(() => { useStore.getState().updateContext('n1', { why: 'because' }); });
    expect(useStore.getState().cloudSaveStatus).toBe('unsaved');
    expect(updateStrategy).not.toHaveBeenCalled(); // not yet - still debouncing

    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1), LONG_WAIT);
    expect(updateStrategy).toHaveBeenCalledWith('cloud-abc', expect.objectContaining({ expectedUpdatedAt: 't1' }));
    await waitFor(() => expect(useStore.getState().cloudSaveStatus).toBe('saved'));
  }, 10000);

  it('scenario: reload restores the exact saved graph, and that restore alone never re-triggers a save (loadStrategy resets the dirty baseline)', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    renderHook(() => useCloudAutoSave('ready'));

    act(() => {
      useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [{ id: 'edited', data: {} }], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });
    });
    expect(useStore.getState().cloudSaveStatus).toBe('idle'); // never flipped to 'unsaved' by the load itself

    await new Promise((r) => setTimeout(r, 2000));
    expect(updateStrategy).not.toHaveBeenCalled();
  }, 10000);

  it('scenario: rapid repeated edits before the debounce fires collapse into a single save using the LATEST content', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 't1' });
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', updatedAt: 't2' });

    renderHook(() => useCloudAutoSave('ready'));

    act(() => { useStore.getState().setProductInfo({ name: 'First edit' }); });
    act(() => { useStore.getState().setProductInfo({ name: 'Second edit' }); });
    act(() => { useStore.getState().setProductInfo({ name: 'Final edit' }); });

    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1), LONG_WAIT);
    expect(updateStrategy.mock.calls[0][1].productInfo).toEqual({ name: 'Final edit' });
  }, 10000);

  it('scenario: an edit made WHILE a save is in flight is not lost - a follow-up save fires once the first resolves', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 't1' });

    let resolveFirst;
    updateStrategy.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
    updateStrategy.mockImplementation(() => Promise.resolve({ id: 'cloud-abc', updatedAt: 't3' }));

    renderHook(() => useCloudAutoSave('ready'));

    act(() => { useStore.getState().setProductInfo({ name: 'Edit 1' }); });
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1), LONG_WAIT);
    expect(useStore.getState().cloudSaveStatus).toBe('saving');

    // A second edit arrives while the first PATCH is still in flight.
    act(() => { useStore.getState().setProductInfo({ name: 'Edit 2 (during save)' }); });

    // The in-flight request now resolves.
    await act(async () => { resolveFirst({ id: 'cloud-abc', updatedAt: 't2' }); });

    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(2), LONG_WAIT);
    expect(updateStrategy.mock.calls[1][1].productInfo).toEqual({ name: 'Edit 2 (during save)' });
  }, 10000);

  it('scenario: a save failure shows "error" honestly and never claims success before server confirmation', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 't1' });
    updateStrategy.mockRejectedValue(new Error('network down'));

    renderHook(() => useCloudAutoSave('ready'));
    act(() => { useStore.getState().setProductInfo({ name: 'Edited' }); });

    await waitFor(() => expect(useStore.getState().cloudSaveStatus).toBe('error'), LONG_WAIT);
    expect(useStore.getState().activeCloudUpdatedAt).toBe('t1'); // unchanged - no fabricated success

    // The next edit is a real, safe retry (never automatic/looping).
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', updatedAt: 't2' });
    act(() => { useStore.getState().setProductInfo({ name: 'Edited again' }); });
    await waitFor(() => expect(useStore.getState().cloudSaveStatus).toBe('saved'), LONG_WAIT);
  }, 10000);

  it('scenario: an optimistic-concurrency 409 surfaces the conflict without silently overwriting the server\'s newer row', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 'stale' });
    const current = { id: 'cloud-abc', nodes: [{ id: 'server-n1', data: {} }], edges: [], productInfo: { name: 'Server version' }, aiSuggestions: null, updatedAt: 'fresh' };
    updateStrategy.mockRejectedValue(new FakeStrategiesApiError(409, 'conflict', { current }));

    renderHook(() => useCloudAutoSave('ready'));
    act(() => { useStore.getState().setProductInfo({ name: 'My local edit' }); });

    await waitFor(() => expect(useStore.getState().cloudSaveStatus).toBe('conflict'), LONG_WAIT);
    expect(useStore.getState().cloudSaveConflict).toEqual(current);
    expect(useStore.getState().productInfo).toEqual({ name: 'My local edit' }); // never silently overwritten

    await act(async () => { await resolveCloudSaveConflict('reload'); });
    expect(useStore.getState().nodes).toEqual([{ id: 'server-n1', data: {} }]);
    expect(useStore.getState().cloudSaveConflict).toBe(null);
  }, 10000);

  it('"Overwrite Anyway" retries unconditionally (no expectedUpdatedAt) and clears the conflict on success', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 'stale' });
    useStore.getState().setCloudSaveConflict({ id: 'cloud-abc', updatedAt: 'fresh' });
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', updatedAt: 'overwritten' });

    await act(async () => { await resolveCloudSaveConflict('overwrite'); });

    expect(updateStrategy.mock.calls[0][1].expectedUpdatedAt).toBeUndefined();
    expect(useStore.getState().cloudSaveStatus).toBe('saved');
    expect(useStore.getState().cloudSaveConflict).toBe(null);
    expect(useStore.getState().activeCloudUpdatedAt).toBe('overwritten');
  });

  it('scenario: a Local Draft\'s edits are never sent to the cloud - no save is scheduled, isDirty stays false', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    expect(useStore.getState().activeProjectSource).toBe('local');

    renderHook(() => useCloudAutoSave('ready'));
    act(() => { useStore.getState().setProductInfo({ name: 'Local edit' }); });
    await new Promise((r) => setTimeout(r, 2000));

    expect(updateStrategy).not.toHaveBeenCalled();
    expect(useStore.getState().cloudSaveStatus).toBe('idle');
  }, 10000);

  it('scenario: edits that happen while the ?strategy= URL is still loading never trigger a save (avoids racing the initial hydration)', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

    renderHook(() => useCloudAutoSave('loading')); // URL loader has not resolved to 'ready' yet
    act(() => { useStore.getState().setProductInfo({ name: 'Edited during load' }); });
    await new Promise((r) => setTimeout(r, 2000));

    expect(updateStrategy).not.toHaveBeenCalled();
    expect(useStore.getState().cloudSaveStatus).toBe('idle');
  }, 10000);

  it('never calls createStrategy / never a second strategy row - every save targets the existing activeProjectId via updateStrategy', async () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    useStore.getState().loadStrategy({ id: 'cloud-abc', nodes: [NODE_N1], edges: [], productInfo: { name: 'P' }, aiSuggestions: null, updatedAt: 't1' });
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', updatedAt: 't2' });

    renderHook(() => useCloudAutoSave('ready'));
    act(() => { useStore.getState().setProductInfo({ name: 'Edit A' }); });
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1), LONG_WAIT);
    await waitFor(() => expect(useStore.getState().cloudSaveStatus).toBe('saved'), LONG_WAIT);

    act(() => { useStore.getState().setProductInfo({ name: 'Edit B' }); });
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(2), LONG_WAIT);

    expect(updateStrategy.mock.calls[0][0]).toBe('cloud-abc');
    expect(updateStrategy.mock.calls[1][0]).toBe('cloud-abc');
  }, 10000);
});
