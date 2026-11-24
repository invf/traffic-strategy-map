// ADV-003 - isolated test for the ADVESER Projects selector itself (not
// through the full TopBar). Mocks useStore/useAuth/useTranslation
// directly, same convention as AccountButton.test.jsx - this file is
// about what the selector renders/does for each state, not about the
// store or sync-hook logic already covered in their own test files.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../i18n/useTranslation', () => ({
  useTranslation: () => (key) => ({
    adveser_projects_label: 'ADVESER Projects',
    adveser_projects_empty: 'No ADVESER Projects yet',
    adveser_projects_empty_hint: 'Create one in Launch Studio.',
    adveser_projects_open_in_launch_studio: 'Open Launch Studio',
    adveser_projects_role_owner: 'Owner',
    adveser_projects_role_collaborator: 'Collaborator',
  }[key] || key),
}));

const mockUseAuth = vi.fn();
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

let storeState;
const setActiveAdveserProject = vi.fn((id) => { storeState.activeAdveserProjectId = id; });
vi.mock('../store/useStore', () => ({ useStore: () => storeState }));

import AdveserProjectsSelector from './AdveserProjectsSelector';

function baseStore(overrides = {}) {
  return {
    adveserProjects: [],
    activeAdveserProjectId: null,
    setActiveAdveserProject,
    ...overrides,
  };
}

describe('AdveserProjectsSelector (ADV-003)', () => {
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
});
