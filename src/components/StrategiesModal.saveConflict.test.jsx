// AUTH-004 requirement 12 - "avoid silently overwriting newer changes
// from another browser." Proves the Save tab's conflict path: a 409
// from updateStrategy() must show the conflict panel (never a silent
// success, never a generic error swallowing the server's current row),
// and both resolution actions (Reload Latest / Overwrite Anyway) do
// what they say.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    cloud_title: 'Strategies', cloud_tab_save: 'Save', cloud_tab_load: 'Load',
    cloud_name_label: 'Name', cloud_name_placeholder: 'name', cloud_nodes: 'nodes',
    cloud_save_update_btn: 'Save', cloud_save_new_btn: 'Save as New',
    cloud_saving: 'Saving…', cloud_saved: 'Saved!',
    cloud_conflict_title: 'Changed elsewhere',
    cloud_conflict_hint: 'This strategy was changed in another browser or device since you loaded it.',
    cloud_conflict_reload_btn: 'Reload Latest',
    cloud_conflict_overwrite_btn: 'Overwrite Anyway',
  }[key] || key),
}));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const updateStrategy = vi.fn();
const createStrategy = vi.fn();
const listStrategies = vi.fn();
const getStrategy = vi.fn();
const deleteStrategy = vi.fn();
vi.mock('../services/strategies', () => ({
  listStrategies: (...a) => listStrategies(...a),
  getStrategy: (...a) => getStrategy(...a),
  createStrategy: (...a) => createStrategy(...a),
  updateStrategy: (...a) => updateStrategy(...a),
  deleteStrategy: (...a) => deleteStrategy(...a),
  // Defined INLINE in the factory, not referencing an outer variable -
  // vi.mock factories are hoisted above other top-level code, so a
  // class declared alongside them (not hoisted like a function
  // declaration) would hit a TDZ ReferenceError.
  StrategiesApiError: class StrategiesApiError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data; }
  },
  errorKeyForStatus: () => null,
}));

let storeState;
const setActiveCloudProject = vi.fn();
const addCloudProject = vi.fn();
const patchCloudProjectLocal = vi.fn();
const loadStrategy = vi.fn();
vi.mock('../store/useStore', () => ({
  useStore: () => storeState,
}));

import StrategiesModal from './StrategiesModal';
import { StrategiesApiError } from '../services/strategies';

describe('StrategiesModal SaveTab - stale-write conflict (AUTH-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com', isAuthenticated: true, isLoading: false });
    storeState = {
      setShowStrategies: vi.fn(),
      nodes: [{ id: 'n1' }], edges: [], productInfo: { name: 'P' }, aiSuggestions: null,
      activeProjectId: 'cloud-abc',
      activeProjectSource: 'cloud',
      activeCloudUpdatedAt: 'stale-timestamp',
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
  });

  it('a 409 from updateStrategy shows the conflict panel, not a silent success or a generic error message', async () => {
    const current = { id: 'cloud-abc', name: 'Changed by someone else', updatedAt: 'fresh-timestamp' };
    updateStrategy.mockRejectedValue(new StrategiesApiError(409, 'conflict', { current }));

    render(<StrategiesModal />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);

    await waitFor(() => expect(screen.getByText('Changed elsewhere')).toBeInTheDocument());
    expect(screen.getByText(/changed in another browser/i)).toBeInTheDocument();
    // Never silently treated as success - setActiveCloudProject must NOT have been called.
    expect(setActiveCloudProject).not.toHaveBeenCalled();
  });

  it('"Reload Latest" loads the server\'s current row and dismisses the conflict, discarding the local edit', async () => {
    const current = { id: 'cloud-abc', name: 'Changed by someone else', updatedAt: 'fresh-timestamp' };
    updateStrategy.mockRejectedValue(new StrategiesApiError(409, 'conflict', { current }));

    render(<StrategiesModal />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    await waitFor(() => expect(screen.getByText('Changed elsewhere')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Reload Latest' }));
    expect(loadStrategy).toHaveBeenCalledWith(current);
    expect(screen.queryByText('Changed elsewhere')).not.toBeInTheDocument();
  });

  it('"Overwrite Anyway" retries WITHOUT expectedUpdatedAt (an explicit, informed choice - never automatic)', async () => {
    const current = { id: 'cloud-abc', name: 'Changed by someone else', updatedAt: 'fresh-timestamp' };
    updateStrategy.mockRejectedValueOnce(new StrategiesApiError(409, 'conflict', { current }));
    updateStrategy.mockResolvedValueOnce({ id: 'cloud-abc', name: 'P', updatedAt: 'overwritten-timestamp' });

    render(<StrategiesModal />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    await waitFor(() => expect(screen.getByText('Changed elsewhere')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite Anyway' }));
    await waitFor(() => expect(setActiveCloudProject).toHaveBeenCalledWith('cloud-abc', 'overwritten-timestamp'));

    const secondCallArgs = updateStrategy.mock.calls[1];
    expect(secondCallArgs[1].expectedUpdatedAt).toBeUndefined();
  });

  it('a normal (non-conflicting) Save sends the current activeCloudUpdatedAt as expectedUpdatedAt', async () => {
    updateStrategy.mockResolvedValue({ id: 'cloud-abc', name: 'P', updatedAt: 't2' });
    render(<StrategiesModal />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);

    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1));
    expect(updateStrategy.mock.calls[0][0]).toBe('cloud-abc');
    expect(updateStrategy.mock.calls[0][1].expectedUpdatedAt).toBe('stale-timestamp');
  });
});
