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

describe('AdveserProjectsSelector (ADV-003)', () => {
  beforeEach(() => {
    mockListAdveserProjects.mockReset().mockResolvedValue([]);
    hydrateAdveserProjects.mockClear();
    mockImportLaunchStrategy.mockReset();
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

  it('the "Open Launch Studio" link points at Launch Studio, carrying the active project id when one is selected', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({
      adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }],
      activeAdveserProjectId: 'p1',
    });
    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));

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

  // ADV-004 release-readiness check: the import route is mounted only
  // when the backend's own feature flag is on (default OFF) - a 404 is
  // the unambiguous signal for "not enabled yet" (see
  // launchStrategyImport.js's own comment), and must render distinctly
  // from a genuine error.
  it('a 404 from the import flow (backend feature flag off) shows "not available yet", never the generic retry-implying error message', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    // Never resolves - keeps the ADV-003-FIX-4 refresh-on-open effect from
    // racing with this test's own click and overwriting storeState mid-test.
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    const notFound = new Error('Failed to read the approved strategy export (404)');
    notFound.status = 404;
    mockImportLaunchStrategy.mockRejectedValue(notFound);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('Strategy import is not available yet.')).toBeInTheDocument());
    expect(screen.queryByText('Could not import the strategy. Please try again.')).not.toBeInTheDocument();
  });

  it('a genuine (non-404) failure still shows the generic error message, unchanged from before this fix', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    const serverError = new Error('Failed to read the approved strategy export (503)');
    serverError.status = 503;
    mockImportLaunchStrategy.mockRejectedValue(serverError);

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('Could not import the strategy. Please try again.')).toBeInTheDocument());
    expect(screen.queryByText('Strategy import is not available yet.')).not.toBeInTheDocument();
  });

  it('a successful import with no approved export yet shows the "no export" message', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'no-export' });

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    await waitFor(() => expect(screen.getByText('No approved strategy yet.')).toBeInTheDocument());
  });

  it('a successful import shows the added/updated/preserved summary', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    storeState = baseStore({ adveserProjects: [{ id: 'p1', name: 'Project Alpha', role: 'owner' }], activeAdveserProjectId: 'p1' });
    mockListAdveserProjects.mockImplementation(() => new Promise(() => {}));
    mockImportLaunchStrategy.mockResolvedValue({ status: 'imported', addedCount: 2, updatedCount: 1, preservedCount: 3, strategyId: 's1' });

    render(<AdveserProjectsSelector />);
    fireEvent.click(screen.getByTitle('ADVESER Projects'));
    fireEvent.click(screen.getByText('Import strategy from Launch Studio'));

    // Matched as a function (not a string/regex) because the sentence is
    // split across sibling text nodes by the interpolated {count}/{label}
    // JSX expressions - RTL's default text matcher only matches within a
    // single node.
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el.textContent === '2 added, 1 updated, 3 of your edits preserved')
      ).toBeInTheDocument()
    );
  });
});
