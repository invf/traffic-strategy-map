// ADV-003 - isolated test for the ADVESER Projects selector itself (not
// through the full TopBar). Mocks useStore/useAuth/useTranslation
// directly, same convention as AccountButton.test.jsx - this file is
// about what the selector renders/does for each state, not about the
// store or sync-hook logic already covered in their own test files.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    adveser_projects_label: 'ADVESER Projects',
    adveser_projects_empty: 'No ADVESER Projects yet',
    adveser_projects_empty_hint: 'Create one in Launch Studio.',
    adveser_projects_open_in_launch_studio: 'Open Launch Studio',
    adveser_projects_role_owner: 'Owner',
    adveser_projects_role_collaborator: 'Collaborator',
    adveser_projects_import_strategy: 'Import strategy from Launch Studio',
    adveser_projects_import_strategy_loading: 'Importing…',
    adveser_projects_import_strategy_no_export: 'No approved strategy yet.',
    adveser_projects_import_strategy_error: 'Could not import the strategy. Please try again.',
    adveser_projects_import_strategy_unavailable: 'Strategy import is not available yet.',
    adveser_projects_import_added: 'added',
    adveser_projects_import_updated: 'updated',
    adveser_projects_import_preserved: 'of your edits preserved',
    adveser_projects_open_strategy: 'Open strategy',
    adveser_projects_update_from_launch_studio: 'Update from Launch Studio',
    adveser_projects_popup_blocked: 'Your browser blocked the new tab.',
    adveser_projects_popup_blocked_link: 'Click here to open the strategy',
  }[key] || key),
}));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

let storeState;
const setActiveAdveserProject = vi.fn((id) => { storeState.activeAdveserProjectId = id; });
const hydrateAdveserProjects = vi.fn((list) => { storeState.adveserProjects = list; });
vi.mock('../store/useStore', () => ({ useStore: () => storeState }));

// ADV-003-FIX-4: the selector now re-fetches the project list (and
// therefore the canonical names it carries) each time the dropdown opens
// - mocked here so every existing test keeps exercising only the already-
// hydrated store state, exactly as before this fix, unless a test
// explicitly asserts on this call.
const mockListAdveserProjects = vi.fn().mockResolvedValue([]);
vi.mock('../services/adveserProjects', () => ({ listAdveserProjects: (...args) => mockListAdveserProjects(...args) }));

// ADV-004-FIX-2 (final correction): the selector now looks up whether a
// cloud strategy already exists for the active project - defaults to
// "none yet" so every pre-existing test (written before this lookup
// existed) keeps exercising the "Import" (not "Open"/"Update") action,
// unless a test explicitly overrides it.
const mockFindStrategyByProjectId = vi.fn().mockResolvedValue(null);
vi.mock('../services/strategies', () => ({ findStrategyByProjectId: (...args) => mockFindStrategyByProjectId(...args) }));

// ADV-004 release-readiness fix: a 404 (backend feature flag off) must
// render a distinct, accurate "not available yet" message, never the
// generic "could not import, try again" one implying a retry might help.
const mockImportLaunchStrategy = vi.fn();
vi.mock('../services/launchStrategyImportFlow', () => ({ importLaunchStrategy: (...args) => mockImportLaunchStrategy(...args) }));

import AdveserProjectsSelector from './AdveserProjectsSelector';

function baseStore(overrides = {}) {
  return {
    adveserProjects: [],
    activeAdveserProjectId: null,
    setActiveAdveserProject,
    hydrateAdveserProjects,
    ...overrides,
  };
}

// ADV-004-FIX-2 (final correction): opening/updating a strategy opens a
// real browser tab - mocked so no test touches a real window, and so
// call order/timing (synchronous, before any await - required for
// popup blockers to allow it) and the exact navigated URL are both
// assertable.
let mockWindowOpen;

describe('AdveserProjectsSelector (ADV-003)', () => {
  beforeEach(() => {
    mockListAdveserProjects.mockReset().mockResolvedValue([]);
    hydrateAdveserProjects.mockClear();
    mockFindStrategyByProjectId.mockReset().mockResolvedValue(null);
    mockImportLaunchStrategy.mockReset();
    mockWindowOpen = vi.fn(() => ({ closed: false, location: { href: '' }, close: vi.fn() }));
    vi.stubGlobal('open', mockWindowOpen);
  });

  it('renders nothing at all while signed out - Local Drafts/Quick Strategy are completely unaffected by its absence', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    storeState = baseStore();
    const { container } = render(<AdveserProjectsSelector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a meaningful empty state when there are no ADVESER Projects', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore();
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    expect(screen.getByText('No ADVESER Projects yet')).toBeInTheDocument();
  });

  it('lists every accessible project with its role, and distinguishes owner vs collaborator', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({
      adveserProjects: [
        { id: 'p1', name: 'Project Alpha', role: 'owner' },
        { id: 'p2', name: 'Project Beta', role: 'collaborator' },
      ],
    });
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Project Beta')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Collaborator')).toBeInTheDocument();
  });

  it('clicking a project calls setActiveAdveserProject with its id and closes the dropdown', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }] });
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    fireEvent.click(screen.getByText('Project Alpha'));

    expect(setActiveAdveserProject).toHaveBeenCalledWith('p1');
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });

  it('never renders any project the store did not supply - this component selects only from the authoritative list, never from anything else', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Only This One', role: 'owner' }] });
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    expect(screen.getAllByText(/Only This One|Owner/)).toHaveLength(2);
  });

  it('the "Open Launch Studio" link points at Launch Studio, carrying the active project id when one is selected', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({
      adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }],
      activeAdveserProjectId: 'p1',
    });
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(mockFindStrategyByProjectId).toHaveBeenCalled());

    const link = screen.getByText('Open Launch Studio').closest('a');
    expect(link.getAttribute('href')).toContain('project=p1');
  });

  // ADV-003-FIX-4 (requirement 4: "refresh project names when appropriate")
  it('re-fetches the project list the moment the dropdown is opened, so a name renamed elsewhere shows up without a full page reload', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Stale Cached Name', role: 'owner' }] });
    mockListAdveserProjects.mockResolvedValue([{ id: 'p1', name: 'Renamed Elsewhere', role: 'owner' }]);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    await waitFor(() => expect(mockListAdveserProjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hydrateAdveserProjects).toHaveBeenCalledWith([{ id: 'p1', name: 'Renamed Elsewhere', role: 'owner' }]));
  });

  it('a failed refresh on open leaves the previously-hydrated list showing - never an error, never a blank menu', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Still Showing', role: 'owner' }] });
    mockListAdveserProjects.mockRejectedValue(new Error('network error'));

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    await waitFor(() => expect(mockListAdveserProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Still Showing')).toBeInTheDocument();
    expect(hydrateAdveserProjects).not.toHaveBeenCalled();
  });

  // ===== ADV-004-FIX-2 (final correction): which action is offered =====

  it('with no linked strategy yet, only the generating "Import" action is offered', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    await waitFor(() => expect(mockFindStrategyByProjectId).toHaveBeenCalledWith('p1'));
    expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument();
    expect(screen.queryByText('Open strategy')).not.toBeInTheDocument();
    expect(screen.queryByText('Update from Launch Studio')).not.toBeInTheDocument();
  });

  it('once a strategy is already linked, "Open strategy" and "Update from Launch Studio" are offered instead of "Import"', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

    await waitFor(() => expect(screen.getByText('Open strategy')).toBeInTheDocument());
    expect(screen.getByText('Update from Launch Studio')).toBeInTheDocument();
    expect(screen.queryByText('Import strategy from Launch Studio')).not.toBeInTheDocument();
  });

  // ===== Scenario: existing strategy opens without unintended regeneration =====

  it('"Open strategy" navigates directly to the existing strategy\'s URL and never calls importLaunchStrategy at all', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Open strategy')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Open strategy'));

    expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen.mock.calls[0][0]).toContain('strategy=existing-strategy-1');
    expect(mockImportLaunchStrategy).not.toHaveBeenCalled(); // never regenerates merely because the user wants to look at it
  });

  // ===== Scenario: new tab receives the correct strategy id =====

  it('on a successful first import, the blank tab is navigated to a URL carrying the REAL, server-assigned strategy id', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'imported', addedCount: 8, updatedCount: 0, preservedCount: 0, strategyId: 'new-strategy-xyz' });

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());

    const blankTab = { closed: false, location: { href: '' }, close: vi.fn() };
    mockWindowOpen.mockReturnValue(blankTab);

    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    // The blank tab must be opened BEFORE the import resolves (a real
    // click handler, synchronously) - confirmed by it already existing
    // the moment importLaunchStrategy was invoked.
    expect(mockWindowOpen).toHaveBeenCalledWith('', '_blank');

    await waitFor(() => expect(blankTab.location.href).toContain('strategy=new-strategy-xyz'));
  });

  // ===== Scenario: popup-blocked fallback =====

  it('when the popup is blocked, a real clickable link to the new strategy is offered instead of silently failing', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'imported', addedCount: 1, updatedCount: 0, preservedCount: 0, strategyId: 'new-strategy-xyz' });
    mockWindowOpen.mockReturnValue(null); // blocked

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('Click here to open the strategy')).toBeInTheDocument());
    const link = screen.getByText('Click here to open the strategy').closest('a');
    expect(link.getAttribute('href')).toContain('strategy=new-strategy-xyz');
  });

  it('"Open strategy" also handles a blocked popup gracefully, with a real link to the existing strategy', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockWindowOpen.mockReturnValue(null);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Open strategy')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Open strategy'));

    await waitFor(() => expect(screen.getByText('Your browser blocked the new tab.')).toBeInTheDocument());
    const link = screen.getByText('Click here to open the strategy').closest('a');
    expect(link.getAttribute('href')).toContain('strategy=existing-strategy-1');
  });

  // ===== Scenario: import failure never leaves a misleading blank tab =====

  it('on a genuine import failure, the blank tab is closed and the original tab shows an actionable error', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    const serverError = new Error('Failed (503)');
    serverError.status = 503;
    mockImportLaunchStrategy.mockRejectedValue(serverError);

    const blankTab = { closed: false, location: { href: '' }, close: vi.fn() };
    mockWindowOpen.mockReturnValue(blankTab);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(blankTab.close).toHaveBeenCalledTimes(1)); // never left open and blank
    expect(screen.getByText('Could not import the strategy. Please try again.')).toBeInTheDocument();
  });

  // ADV-004 release-readiness check: the import route is mounted only
  // when the backend's own feature flag is on (default OFF) - a 404 is
  // the unambiguous signal for "not enabled yet" (see
  // launchStrategyImport.js's own comment), and must render distinctly
  // from a genuine error.
  it('a 404 from the import flow (backend feature flag off) shows "not available yet", never the generic retry-implying error message', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    const notFound = new Error('Failed to read the approved strategy export (404)');
    notFound.status = 404;
    mockImportLaunchStrategy.mockRejectedValue(notFound);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('Strategy import is not available yet.')).toBeInTheDocument());
    expect(screen.queryByText('Could not import the strategy. Please try again.')).not.toBeInTheDocument();
  });

  it('a successful import with no approved export yet shows the "no export" message', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'no-export' });

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('No approved strategy yet.')).toBeInTheDocument());
  });

  it('a successful import shows the added/updated/preserved summary', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue(null);
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'imported', addedCount: 2, updatedCount: 1, preservedCount: 3, strategyId: 's1' });

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Import strategy from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    // Matched as a function (not a string/regex) because the sentence is
    // split across sibling text nodes by the interpolated {count}/{label}
    // JSX expressions - RTL's default text matcher only matches within a
    // single node. Restricted to a leaf element (no element children) so
    // only the innermost wrapper matches, not the outer summary/link
    // container that shares the same recursive textContent.
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el.children.length === 0 && el.textContent === '2 added, 1 updated, 3 of your edits preserved')
      ).toBeInTheDocument()
    );
  });

  // ===== Scenario: an explicit "Update from Launch Studio" regenerates, "Open" never does =====

  it('"Update from Launch Studio" calls importLaunchStrategy (the ONLY action that does) and navigates to the (possibly same) strategy id', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockFindStrategyByProjectId.mockResolvedValue({ id: 'existing-strategy-1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'imported', addedCount: 1, updatedCount: 2, preservedCount: 1, strategyId: 'existing-strategy-1' });

    const blankTab = { closed: false, location: { href: '' }, close: vi.fn() };
    mockWindowOpen.mockReturnValue(blankTab);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    await waitFor(() => expect(screen.getByText('Update from Launch Studio')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Update from Launch Studio'));

    expect(mockImportLaunchStrategy).toHaveBeenCalledWith('p1', 'Project Alpha');
    await waitFor(() => expect(blankTab.location.href).toContain('strategy=existing-strategy-1'));
  });
});
