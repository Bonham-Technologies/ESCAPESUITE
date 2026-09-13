// The editor's top bar on its own: the dashboard link's build-mode fork, the
// project-name field, and the quick Save/Export buttons. The File dropdown it
// nests has its own file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { AppHeader } from './AppHeader';

// isStandaloneMode is decided at build time, so the offline branch is only
// reachable by replacing it.
const { isStandaloneMode } = vi.hoisted(() => ({ isStandaloneMode: vi.fn(() => false) }));
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isStandaloneMode,
}));

beforeEach(() => {
  isStandaloneMode.mockReturnValue(false);
});

function renderHeader(overrides: Partial<ComponentProps<typeof AppHeader>> = {}) {
  const props = {
    projectName: 'My Film',
    onRenameProject: vi.fn(),
    fileMenuOpen: false,
    onToggleFileMenu: vi.fn(),
    onCloseFileMenu: vi.fn(),
    onNewProject: vi.fn(),
    onLoadProject: vi.fn(),
    onSaveProject: vi.fn(),
    onExport: vi.fn(),
    isLoading: false,
    isSaving: false,
    canExport: true,
  };
  const merged = { ...props, ...overrides };
  const view = render(<AppHeader {...merged} />);
  return { ...merged, ...view };
}

describe('AppHeader', () => {
  it('shows the wordmark and a link back to the suite', () => {
    renderHeader();

    expect(screen.getByRole('heading', { name: 'ESCAPEARTIST' })).toBeInTheDocument();
    const link = screen.getByTitle('Back to ESCAPE Suite');
    expect(link).toHaveAttribute('href', '/');
  });

  it('drops the dashboard link in the standalone build', () => {
    isStandaloneMode.mockReturnValue(true);

    renderHeader();

    expect(screen.queryByTitle('Back to ESCAPE Suite')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ESCAPEARTIST' })).toBeInTheDocument();
  });

  it('shows the project name in an editable field', () => {
    renderHeader();

    expect(screen.getByLabelText('Project name')).toHaveValue('My Film');
  });

  it('reports the new value when the project is renamed', async () => {
    const user = userEvent.setup();
    const { onRenameProject } = renderHeader({ projectName: '' });

    await user.type(screen.getByLabelText('Project name'), 'A');

    expect(onRenameProject).toHaveBeenCalledWith('A');
  });

  it('saves from the quick button', async () => {
    const user = userEvent.setup();
    const { onSaveProject } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(onSaveProject).toHaveBeenCalledTimes(1);
  });

  it('disables the quick save button while a save is in flight', () => {
    renderHeader({ isSaving: true });

    expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled();
  });

  it('exports from the Export button', async () => {
    const user = userEvent.setup();
    const { onExport } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Export video' }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('disables Export with nothing on the timeline', () => {
    renderHeader({ canExport: false });

    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled();
  });

  it('hands the File menu its open state and its handlers', async () => {
    const user = userEvent.setup();
    const { onToggleFileMenu } = renderHeader();

    const fileButton = screen.getByRole('button', { name: 'File menu' });
    expect(fileButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(fileButton);

    expect(onToggleFileMenu).toHaveBeenCalledTimes(1);
  });

  it('opens the File dropdown when told it is open', async () => {
    const user = userEvent.setup();
    const { onNewProject, onCloseFileMenu } = renderHeader({ fileMenuOpen: true });

    expect(screen.getByRole('menu', { name: 'File options' })).toBeInTheDocument();
    await user.click(screen.getByText('New Project'));

    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(onCloseFileMenu).toHaveBeenCalledTimes(1);
  });

  it('passes the loading flag down to the menu Open item', () => {
    renderHeader({ fileMenuOpen: true, isLoading: true });

    expect(screen.getByText('Open Project...').closest('button')).toBeDisabled();
  });

  it('opens a project from the menu', async () => {
    const user = userEvent.setup();
    const { onLoadProject } = renderHeader({ fileMenuOpen: true });

    await user.click(screen.getByText('Open Project...'));

    expect(onLoadProject).toHaveBeenCalledTimes(1);
  });
});
