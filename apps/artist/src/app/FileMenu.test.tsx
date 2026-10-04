// The header's File dropdown on its own, driven entirely through its props.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  // `props` is the same object, handed back whole so a test can re-render the
  // component with one value changed.
  return { ...merged, ...view, props: merged };
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

// ESCSUITE-216: the markup promised a menu (`aria-haspopup="menu"` over a
// `role="menu"`) and delivered four plain buttons — an `aria-required-children`
// violation, and no keyboard model at all. The APG menu pattern is below. The
// artist package carries no axe runtime, so the structural half is asserted
// directly here; the axe audit of the same open menu lives in
// `apps/e2e/tests/accessibility/core.spec.ts`.
describe('FileMenu as a real menu (ESCSUITE-216)', () => {
  it('owns nothing but menuitems and a separator', () => {
    renderMenu();

    const menu = screen.getByRole('menu', { name: 'File options' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'New ProjectCtrl+N',
      'Open Project...Ctrl+O',
      'Save ProjectCtrl+S',
      'Export Video...Ctrl+E',
    ]);
    // Every child carries a role the `menu` role allows — which is what
    // `aria-required-children` is really asking.
    expect(Array.from(menu.children).map((child) => child.getAttribute('role'))).toEqual([
      'menuitem',
      'menuitem',
      'menuitem',
      'separator',
      'menuitem',
    ]);
  });

  it('puts focus on the first item when the menu opens', () => {
    const { rerender, props } = renderMenu({ isOpen: false });
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    rerender(<FileMenu {...props} isOpen />);

    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('keeps exactly one tab stop — the active item', () => {
    renderMenu();

    expect(screen.getAllByRole('menuitem').map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('names the menu it controls while it is open, and names nothing while it is shut', () => {
    const { rerender, props } = renderMenu({ isOpen: false });
    const trigger = screen.getByRole('button', { name: 'File menu' });
    expect(trigger).not.toHaveAttribute('aria-controls');

    rerender(<FileMenu {...props} isOpen />);

    const menu = screen.getByRole('menu', { name: 'File options' });
    expect(menu.id).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });
});

describe('FileMenu arrow-key navigation (ESCSUITE-216)', () => {
  const labels = (items: HTMLElement[]) => items.map((item) => item.textContent);

  it('moves focus down one item, and takes the tab stop with it', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowDown}');

    const items = screen.getAllByRole('menuitem');
    expect(items[1]).toHaveFocus();
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('wraps round from the last item to the first', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[3]).toHaveFocus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('moves focus up, wrapping from the first item to the last', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('menuitem')[3]).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
  });

  it('jumps to the first item on Home and the last on End', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{End}');
    expect(screen.getAllByRole('menuitem')[3]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it.each(['{ArrowLeft}', '{ArrowRight}', 'a'])(
    'leaves focus alone on %s — a key the menu does not navigate on',
    async (key) => {
      const user = userEvent.setup();
      renderMenu();
      await user.keyboard('{ArrowDown}');

      await user.keyboard(key);

      const items = screen.getAllByRole('menuitem');
      expect(items[1]).toHaveFocus();
      expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1]);
    }
  );

  it('steps over an item that cannot take focus', async () => {
    const user = userEvent.setup();
    renderMenu({ isSaving: true });
    const items = screen.getAllByRole('menuitem');
    expect(labels(items)[2]).toBe('Save ProjectCtrl+S');

    await user.keyboard('{ArrowDown}{ArrowDown}');

    expect(items[3]).toHaveFocus();
  });

  it('ends on the last item that can take focus', async () => {
    const user = userEvent.setup();
    renderMenu({ canExport: false });

    await user.keyboard('{End}');

    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
  });
});

describe('FileMenu Escape, Tab and activation (ESCSUITE-216)', () => {
  it('closes on Escape and gives focus back to the File button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderMenu();
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'File menu' })).toHaveFocus();
  });

  it('keeps Escape from reaching the editor behind it', async () => {
    // The editor's own Escape cascade (`useAppKeyboardShortcuts`) is a window
    // listener; closing the menu must not also clear a crop mode, the in/out
    // points or the selection behind it. The 'a' proves the spy is wired.
    const user = userEvent.setup();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', spy);
    renderMenu();

    await user.keyboard('a{Escape}');

    window.removeEventListener('keydown', spy);
    expect(seen).toEqual(['a']);
  });

  it('closes on Tab and leaves the focus move to the browser', async () => {
    const user = userEvent.setup();
    const seen: Array<[string, boolean]> = [];
    const spy = (e: KeyboardEvent) => seen.push([e.key, e.defaultPrevented]);
    window.addEventListener('keydown', spy);
    const { onClose } = renderMenu();

    await user.keyboard('{Tab}');

    window.removeEventListener('keydown', spy);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([['Tab', false]]);
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', '[Space]'],
  ])('activates the focused item on %s', async (_key, keys) => {
    const user = userEvent.setup();
    const { onLoadProject, onClose } = renderMenu();
    await user.keyboard('{ArrowDown}');

    await user.keyboard(keys);

    expect(onLoadProject).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
