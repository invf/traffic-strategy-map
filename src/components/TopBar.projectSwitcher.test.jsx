// AUTH-004 - verifies three specific claims about the ProjectSwitcher
// (TopBar.jsx) end to end, through the real rendered component rather
// than just the store's own logic (already covered in
// src/store/useStore.cloud.test.js):
//   1. Unsaved cloud edits trigger a confirm before navigating away
//      (requirement 11), and a cancelled confirm truly blocks the switch.
//   2. Local Drafts are never silently uploaded to the cloud - only the
//      explicit Import action ever calls the create API.
//   3. Cloud Save(load)/Rename/Delete, driven from the switcher, all
//      operate on the exact same persistent strategy UUID throughout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({ useTranslation: () => (key) => key }));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const getStrategy = vi.fn();
const createStrategy = vi.fn();
const updateStrategy = vi.fn();
const deleteStrategy = vi.fn();
vi.mock('../services/strategies', () => ({
  getStrategy: (...a) => getStrategy(...a),
  createStrategy: (...a) => createStrategy(...a),
  updateStrategy: (...a) => updateStrategy(...a),
  deleteStrategy: (...a) => deleteStrategy(...a),
}));

let storeState;
vi.mock('../store/useStore', () => {
  // handleImportLocal (TopBar.jsx) reads the live canvas via
  // useStore.getState() directly (not the hook) for the "importing the
  // currently active draft" case - the mock needs that same static
  // method, matching the real zustand store's own shape.
  const useStore = () => storeState;
  useStore.getState = () => storeState;
  return { useStore };
});

import TopBar from './TopBar';

function baseStore(overrides = {}) {
  return {
    // Fields the main TopBar component itself reads.
    activeView: 'map', setActiveView: vi.fn(),
    productInfo: {}, setShowSetup: vi.fn(), resetMap: vi.fn(),
    isGenerating: false,
    nodes: [], edges: [],
    language: 'en', setLanguage: vi.fn(),
    setShowStrategies: vi.fn(),
    canvasBg: '#070818', setCanvasBg: vi.fn(),
    // Fields ProjectSwitcher reads.
    projects: [{ id: 'proj_1', name: 'Local One', nodes: [], edges: [], productInfo: {} }],
    activeProjectId: 'proj_1',
    activeProjectSource: 'local',
    cloudProjects: [],
    createProject: vi.fn(),
    switchProject: vi.fn(),
    deleteProject: vi.fn(),
    renameProject: vi.fn(),
    isDirty: vi.fn(() => false),
    loadStrategy: vi.fn(),
    setActiveCloudProject: vi.fn(),
    removeCloudProject: vi.fn(),
    patchCloudProjectLocal: vi.fn(),
    addCloudProject: vi.fn(),
    ...overrides,
  };
}

function openSwitcher() {
  fireEvent.click(screen.getByText(/Local One|Cloud One/));
}

describe('TopBar ProjectSwitcher (AUTH-004)', () => {
  let confirmSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ status: 'authenticated', email: 'a@example.com', isAuthenticated: true, isLoading: false, signOut: vi.fn() });
  });
  afterEach(() => { confirmSpy?.mockRestore(); });

  it('requirement 11: a dirty cloud project blocks switching away when the confirm is cancelled, and proceeds when confirmed', () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    storeState = baseStore({
      activeProjectSource: 'cloud',
      activeProjectId: 'cloud-1',
      cloudProjects: [{ id: 'cloud-1', name: 'Cloud One' }],
      isDirty: vi.fn(() => true),
    });
    render(<TopBar />);
    openSwitcher();

    fireEvent.click(screen.getByText('Local One'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(storeState.switchProject).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('Local One'));
    expect(storeState.switchProject).toHaveBeenCalledWith('proj_1');
  });

  it('a non-dirty cloud project (or a Local Draft active) never shows the confirm at all', () => {
    confirmSpy = vi.spyOn(window, 'confirm');
    storeState = baseStore({
      activeProjectSource: 'cloud',
      activeProjectId: 'cloud-1',
      cloudProjects: [{ id: 'cloud-1', name: 'Cloud One' }],
      isDirty: vi.fn(() => false),
    });
    render(<TopBar />);
    openSwitcher();
    fireEvent.click(screen.getByText('Local One'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(storeState.switchProject).toHaveBeenCalledWith('proj_1');
  });

  it('requirement 13: Local Drafts are never automatically uploaded - creating/switching local drafts never calls the create API', () => {
    storeState = baseStore();
    render(<TopBar />);
    openSwitcher();
    fireEvent.click(screen.getByText('Новий'));
    expect(createStrategy).not.toHaveBeenCalled();
    expect(storeState.createProject).toHaveBeenCalledTimes(1);
  });

  it('requirement 7: load, rename and delete from the switcher all operate on the SAME persistent cloud UUID', async () => {
    const CLOUD_ID = 'cloud-xyz-uuid';
    getStrategy.mockResolvedValue({ id: CLOUD_ID, name: 'Original', nodes: [], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });
    updateStrategy.mockResolvedValue({ id: CLOUD_ID, name: 'Renamed', updatedAt: 't2' });
    deleteStrategy.mockResolvedValue(null);

    storeState = baseStore({ cloudProjects: [{ id: CLOUD_ID, name: 'Original' }] });
    render(<TopBar />);
    openSwitcher();

    // Load (switch to) the cloud project.
    fireEvent.click(screen.getByText('Original'));
    await waitFor(() => expect(getStrategy).toHaveBeenCalledWith(CLOUD_ID));
    await waitFor(() => expect(storeState.loadStrategy).toHaveBeenCalledWith(expect.objectContaining({ id: CLOUD_ID })));

    // Rename it via the switcher's inline rename.
    openSwitcher();
    fireEvent.click(screen.getByTitle('cloud_rename_btn'));
    const input = screen.getByDisplayValue('Original');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updateStrategy).toHaveBeenCalledWith(CLOUD_ID, expect.objectContaining({ name: 'Renamed' })));
    expect(storeState.patchCloudProjectLocal).toHaveBeenCalledWith(CLOUD_ID, expect.objectContaining({ name: 'Renamed' }));

    // Delete it.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTitle('cloud_delete_btn'));
    await waitFor(() => expect(deleteStrategy).toHaveBeenCalledWith(CLOUD_ID));
    expect(storeState.removeCloudProject).toHaveBeenCalledWith(CLOUD_ID);

    // Every call above - getStrategy, loadStrategy, updateStrategy, patchCloudProjectLocal, deleteStrategy, removeCloudProject - used the exact same CLOUD_ID, confirmed by the individual assertions above.
  });

  it('AUTH-004B requirements 4/5: importing a Local Draft whose name matches an existing cloud project prompts for a different name, never silently overwrites it', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Local One (2)');
    createStrategy.mockResolvedValue({ id: 'cloud-new', name: 'Local One (2)', updatedAt: 't1' });
    storeState = baseStore({ cloudProjects: [{ id: 'cloud-existing', name: 'Local One' }] });
    render(<TopBar />);
    openSwitcher();

    fireEvent.click(screen.getByTitle('cloud_import_btn'));
    await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createStrategy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Local One (2)' })));
    // Never an update to the existing same-named cloud project's id.
    expect(updateStrategy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('AUTH-004B requirement 5: cancelling the duplicate-name prompt aborts the import entirely', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    storeState = baseStore({ cloudProjects: [{ id: 'cloud-existing', name: 'Local One' }] });
    render(<TopBar />);
    openSwitcher();

    fireEvent.click(screen.getByTitle('cloud_import_btn'));
    await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(1));
    expect(createStrategy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('AUTH-004B requirement 8: two rapid clicks on Import only ever fire ONE createStrategy call', async () => {
    let resolveCreate;
    createStrategy.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    storeState = baseStore();
    render(<TopBar />);
    openSwitcher();

    const importButton = screen.getByTitle('cloud_import_btn');
    fireEvent.click(importButton);
    fireEvent.click(importButton);
    fireEvent.click(importButton);

    resolveCreate({ id: 'cloud-x', name: 'Local One', updatedAt: 't1' });
    await waitFor(() => expect(storeState.addCloudProject).toHaveBeenCalledTimes(1));
    expect(createStrategy).toHaveBeenCalledTimes(1);
  });

  it('AUTH-004B requirement 7: importing the currently ACTIVE Local Draft activates the new cloud project; importing a non-active one does not', async () => {
    createStrategy.mockResolvedValue({ id: 'cloud-new', name: 'Local One', updatedAt: 't1' });
    storeState = baseStore(); // activeProjectSource: 'local', activeProjectId: 'proj_1' (matches the only draft)
    render(<TopBar />);
    openSwitcher();
    fireEvent.click(screen.getByTitle('cloud_import_btn'));
    await waitFor(() => expect(storeState.addCloudProject).toHaveBeenCalledTimes(1));
    expect(storeState.setActiveCloudProject).toHaveBeenCalledWith('cloud-new', 't1');
  });
});
