// The left sidebar on its own: the collapse fork, and the uploader/picker/
// library only while it is open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaLibrarySidebar } from './MediaLibrarySidebar';
import { resetStoreForTest } from '../test/fixtures/projectStore';

// The library's children reach for IndexedDB, the project file reader and the
// media probe on mount; the App suites replace the same four modules.
vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble());
vi.mock('../core/projectManager', async () => (await import('../test/appDoubles')).projectManagerDouble());
vi.mock('../core/videoProcessor', async () => (await import('../test/appDoubles')).videoProcessorDouble());

beforeEach(() => {
  resetStoreForTest();
});

/**
 * The sidebar with its required props, any of which a test can override.
 *
 * Two of them are pure pass-throughs the sidebar has no behaviour of its own
 * for — the picker's confirm-open report and the uploader's project-file handoff
 * — and every case below needs them filled in.
 */
const renderSidebar = (overrides: Partial<ComponentProps<typeof MediaLibrarySidebar>> = {}) =>
  render(
    <MediaLibrarySidebar
      collapsed={false}
      onToggle={vi.fn()}
      onConfirmOpenChange={vi.fn()}
      onProjectFile={vi.fn()}
      {...overrides}
    />
  );

describe('MediaLibrarySidebar', () => {
  it('names the library and offers the uploader while open', () => {
    renderSidebar();

    expect(screen.getByText('Media Library')).toHaveAttribute('id', 'media-library-title');
    expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument();
  });

  it('offers to collapse while open', () => {
    renderSidebar();

    const button = screen.getByTitle('Collapse sidebar');
    expect(button).toHaveAccessibleName('Collapse media library sidebar');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the title and the library contents while collapsed', () => {
    renderSidebar({ collapsed: true });

    expect(screen.queryByText('Media Library')).not.toBeInTheDocument();
    expect(screen.queryByText('Drop media or click to browse')).not.toBeInTheDocument();
  });

  it('offers to expand while collapsed', () => {
    renderSidebar({ collapsed: true });

    const button = screen.getByTitle('Expand sidebar');
    expect(button).toHaveAccessibleName('Expand media library sidebar');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('points the chevron the other way once collapsed', () => {
    const open = renderSidebar();
    const openPoints = open.container.querySelector('polyline')!.getAttribute('points');
    open.unmount();

    const shut = renderSidebar({ collapsed: true });
    const shutPoints = shut.container.querySelector('polyline')!.getAttribute('points');

    expect(openPoints).toBe('15 18 9 12 15 6');
    expect(shutPoints).toBe('9 18 15 12 9 6');
  });

  it('asks its caller to toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderSidebar({ onToggle });

    await user.click(screen.getByTitle('Collapse sidebar'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("passes the picker's confirm-open report through to its caller", async () => {
    const user = userEvent.setup();
    const onConfirmOpenChange = vi.fn();
    renderSidebar({ onConfirmOpenChange });

    await user.selectOptions(screen.getByLabelText('Resolution'), '4K');

    expect(screen.getByTestId('resolution-change-confirm')).toBeInTheDocument();
    expect(onConfirmOpenChange).toHaveBeenCalledWith(true);
  });

  it("passes the uploader's project file through to its caller", async () => {
    const onProjectFile = vi.fn();
    renderSidebar({ onProjectFile });
    const dropped = new File(['{}'], 'my.veditor', { type: '' });

    const zone = screen.getByText('Drop media or click to browse').parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });

    await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(dropped));
  });
});
