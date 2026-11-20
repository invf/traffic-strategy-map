// AUTH-004B - "Prevent Accidental Cloud Strategy Duplicates": the Save
// tab must never create a second UUID for an already-cloud-backed
// project (requirements 1/2), must label and treat a Local Draft's
// first cloud save as an explicit Import (requirement 6) and activate
// the result (requirement 7), must warn on a duplicate name before any
// create (requirements 4/5), and must not fire a second POST from a
// fast double-click (requirement 8).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    cloud_title: 'Strategies', cloud_tab_save: 'Save', cloud_tab_load: 'Load',
    cloud_name_label: 'Name', cloud_name_placeholder: 'name', cloud_nodes: 'nodes',
    cloud_save_update_btn: 'Save', cloud_save_new_btn: 'Save as New',
    cloud_import_btn: 'Import to Account',
    cloud_import_name_conflict: 'A cloud project with this name already exists. Choose a different name.',
    cloud_saving: 'Saving…', cloud_saved: 'Saved!',
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
  // Defined inline in the factory - vi.mock factories are hoisted above
  // other top-level code, so a class declared alongside them hits a TDZ
  // ReferenceError (see StrategiesModal.saveConflict.test.jsx's identical fix).
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
vi.mock('../store/useStore', () => ({ useStore: () => storeState }));

import StrategiesModal from './StrategiesModal';

// Queried by position, not by text: the update button's own label
// legitimately flips between "Save" and "Saved!" right after a success
// (the same transient this app already shows after any save), which
// would make a name-based query flaky exactly then. The create/import/
// new button is always SaveTab's LAST button; when hasActiveCloudProject
// the update button is always the one immediately before it.
function clickCreateButton() {
  const buttons = screen.getAllByRole('button');
  return buttons[buttons.length - 1];
}
function clickUpdateButton() {
  const buttons = screen.getAllByRole('button');
  return buttons[buttons.length - 2];
}

describe('StrategiesModal SaveTab - duplicate prevention (AUTH-004B)', () => {
  let promptSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com', isAuthenticated: true, isLoading: false });
  });
  afterEach(() => { promptSpy?.mockRestore(); });

  it('requirement 6: with no active cloud project, the button reads "Import to Account", not a generic Save label', () => {
    storeState = {
      setShowStrategies: vi.fn(), nodes: [{ id: 'n1' }], edges: [], productInfo: { name: 'P' }, aiSuggestions: null,
      cloudProjects: [],
      activeProjectId: 'proj_local_1', activeProjectSource: 'local', activeCloudUpdatedAt: null,
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    render(<StrategiesModal />);
    expect(screen.getByRole('button', { name: /Import to Account/i })).toBeInTheDocument();
    // Only the "Save" TAB button exists with that exact name - no second,
    // generic "Save"/"Save to Cloud" action button alongside Import.
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('requirements 1/2/7: a FIRST cloud save creates exactly one UUID and activates it; a REPEATED Save only ever PATCHes that same UUID, never POSTs again', async () => {
    createStrategy.mockResolvedValue({ id: 'cloud-new-1', name: 'My Plan — Strategy', updatedAt: 't1' });
    storeState = {
      setShowStrategies: vi.fn(), nodes: [{ id: 'n1' }], edges: [], productInfo: { name: 'My Plan' }, aiSuggestions: null,
      cloudProjects: [],
      activeProjectId: 'proj_local_1', activeProjectSource: 'local', activeCloudUpdatedAt: null,
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    const { rerender } = render(<StrategiesModal />);
    fireEvent.click(clickCreateButton());

    await waitFor(() => expect(createStrategy).toHaveBeenCalledTimes(1));
    expect(setActiveCloudProject).toHaveBeenCalledWith('cloud-new-1', 't1');

    // Simulate the store now reflecting the newly active cloud project (as the real store would after setActiveCloudProject).
    updateStrategy.mockResolvedValue({ id: 'cloud-new-1', name: 'My Plan — Strategy', updatedAt: 't2' });
    storeState = { ...storeState, activeProjectId: 'cloud-new-1', activeProjectSource: 'cloud', activeCloudUpdatedAt: 't1' };
    rerender(<StrategiesModal />);

    fireEvent.click(clickUpdateButton());
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(1));
    expect(updateStrategy.mock.calls[0][0]).toBe('cloud-new-1');
    // A second, ordinary Save - still the SAME UUID, still never a new POST.
    fireEvent.click(clickUpdateButton());
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledTimes(2));
    expect(updateStrategy.mock.calls[1][0]).toBe('cloud-new-1');
    expect(createStrategy).toHaveBeenCalledTimes(1); // still just the one, original create
  });

  it('requirement 3: "Save as New" from an already-cloud-backed project POSTs a brand-new UUID, distinct from the active one', async () => {
    createStrategy.mockResolvedValue({ id: 'cloud-brand-new', name: 'Copy', updatedAt: 't1' });
    storeState = {
      setShowStrategies: vi.fn(), nodes: [], edges: [], productInfo: { name: 'Copy' }, aiSuggestions: null,
      cloudProjects: [{ id: 'cloud-existing', name: 'Existing' }],
      activeProjectId: 'cloud-existing', activeProjectSource: 'cloud', activeCloudUpdatedAt: 't0',
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    render(<StrategiesModal />);
    fireEvent.click(screen.getByRole('button', { name: /Save as New/i }));

    await waitFor(() => expect(createStrategy).toHaveBeenCalledTimes(1));
    expect(setActiveCloudProject).toHaveBeenCalledWith('cloud-brand-new', 't1');
    expect(updateStrategy).not.toHaveBeenCalled();
  });

  it('requirements 4/5: a duplicate name prompts for a different one before creating, and never silently updates the existing same-named project', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('My Plan (2)');
    createStrategy.mockResolvedValue({ id: 'cloud-new-2', name: 'My Plan (2)', updatedAt: 't1' });
    storeState = {
      setShowStrategies: vi.fn(), nodes: [], edges: [], productInfo: { name: 'X' }, aiSuggestions: null,
      cloudProjects: [{ id: 'cloud-other', name: 'My Plan' }],
      activeProjectId: 'proj_local_1', activeProjectSource: 'local', activeCloudUpdatedAt: null,
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    render(<StrategiesModal />);
    const input = screen.getByPlaceholderText('name');
    fireEvent.change(input, { target: { value: 'My Plan' } });
    fireEvent.click(clickCreateButton());

    await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createStrategy).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Plan (2)' })));
    // Never a PATCH to the existing same-named project's id.
    expect(updateStrategy).not.toHaveBeenCalled();
  });

  it('requirement 5: cancelling the duplicate-name prompt aborts entirely - no create, no update, no active-project change', async () => {
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    storeState = {
      setShowStrategies: vi.fn(), nodes: [], edges: [], productInfo: { name: 'X' }, aiSuggestions: null,
      cloudProjects: [{ id: 'cloud-other', name: 'My Plan' }],
      activeProjectId: 'proj_local_1', activeProjectSource: 'local', activeCloudUpdatedAt: null,
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    render(<StrategiesModal />);
    const input = screen.getByPlaceholderText('name');
    fireEvent.change(input, { target: { value: 'My Plan' } });
    fireEvent.click(clickCreateButton());

    await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(1));
    expect(createStrategy).not.toHaveBeenCalled();
    expect(setActiveCloudProject).not.toHaveBeenCalled();
  });

  it('requirement 8: two rapid clicks on the create/import button only ever fire ONE createStrategy call', async () => {
    let resolveCreate;
    createStrategy.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    storeState = {
      setShowStrategies: vi.fn(), nodes: [], edges: [], productInfo: { name: 'X' }, aiSuggestions: null,
      cloudProjects: [],
      activeProjectId: 'proj_local_1', activeProjectSource: 'local', activeCloudUpdatedAt: null,
      setActiveCloudProject, addCloudProject, patchCloudProjectLocal, loadStrategy,
    };
    render(<StrategiesModal />);
    const input = screen.getByPlaceholderText('name');
    fireEvent.change(input, { target: { value: 'Unique Name' } });
    const button = clickCreateButton();

    fireEvent.click(button);
    fireEvent.click(button); // fired before the first request resolves
    fireEvent.click(button);

    resolveCreate({ id: 'cloud-x', name: 'Unique Name', updatedAt: 't1' });
    await waitFor(() => expect(setActiveCloudProject).toHaveBeenCalledTimes(1));
    expect(createStrategy).toHaveBeenCalledTimes(1);
  });
});
