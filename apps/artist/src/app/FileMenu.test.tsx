// The header's File dropdown on its own, driven entirely through its props.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { FileMenu } from './FileMenu';
import styles from '../App.module.css';

function renderMenu(overrides: Partial<ComponentProps<typeof FileMenu>> = {}) {
  const props = {
    isOpen: true,
    onToggle: vi.fn(),
    onClose: vi.fn(),
    onNewProject: vi.fn(),
    onLoadProject: vi.fn(),
    onSaveProject: vi.fn(),
    onExport: vi.fn(),
    isLoading: false,
    isSaving: false,
    canExport: true,
  };
  const merged = { ...props, ...overrides };
  const view = render(<FileMenu {...merged} />);
  return { ...merged, ...view };
}

describe('FileMenu', () => {
  it('shows a closed menu as a collapsed File button', () => {
    renderMenu({ isOpen: false });

    const button = screen.getByRole('button', { name: 'File menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu', { name: 'File options' })).not.toBeInTheDocument();
  });

  it('marks the button expanded and lists the four items when open', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'File menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'File options' })).toBeInTheDocument();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByText('Open Project...')).toBeInTheDocument();
    expect(screen.getByText('Save Project')).toBeInTheDocument();
    expect(screen.getByText('Export Video...')).toBeInTheDocument();
  });

  it('labels each item with its keyboard shortcut', () => {
    renderMenu();

    expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+O')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+E')).toBeInTheDocument();
  });

  it('asks to be toggled when the File button is pressed', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderMenu({ isOpen: false });

    await user.click(screen.getByRole('button', { name: 'File menu' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside, through the backdrop', async () => {
    const user = userEvent.setup();
    const { onClose, container } = renderMenu();

    const backdrop = container.querySelector(`.${styles.menuBackdrop}`)!;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no backdrop while closed', () => {
    const { container } = renderMenu({ isOpen: false });

    expect(container.querySelector(`.${styles.menuBackdrop}`)).toBeNull();
  });

  it.each([
    ['New Project', 'onNewProject'],
    ['Open Project...', 'onLoadProject'],
    ['Save Project', 'onSaveProject'],
    ['Export Video...', 'onExport'],
  ] as const)('runs %s and then closes the menu', async (label, handler) => {
    const user = userEvent.setup();
    const props = renderMenu();

    await user.click(screen.getByText(label));

    expect(props[handler]).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Open while a project is loading', () => {
    renderMenu({ isLoading: true });

    expect(screen.getByText('Open Project...').closest('button')).toBeDisabled();
    expect(screen.getByText('Save Project').closest('button')).toBeEnabled();
  });

  it('disables Save while a save is in flight', () => {
    renderMenu({ isSaving: true });

    expect(screen.getByText('Save Project').closest('button')).toBeDisabled();
    expect(screen.getByText('Open Project...').closest('button')).toBeEnabled();
  });

  it('disables Export with nothing on the timeline', () => {
    renderMenu({ canExport: false });

    expect(screen.getByText('Export Video...').closest('button')).toBeDisabled();
  });

  it('enables Export once there is something to export', () => {
    renderMenu({ canExport: true });

    expect(screen.getByText('Export Video...').closest('button')).toBeEnabled();
  });
});
