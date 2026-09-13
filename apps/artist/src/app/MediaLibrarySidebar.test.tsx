// The left sidebar on its own: the collapse fork, and the uploader/picker/
// library only while it is open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('MediaLibrarySidebar', () => {
  it('names the library and offers the uploader while open', () => {
    render(<MediaLibrarySidebar collapsed={false} onToggle={vi.fn()} />);

    expect(screen.getByText('Media Library')).toHaveAttribute('id', 'media-library-title');
    expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument();
  });

  it('offers to collapse while open', () => {
    render(<MediaLibrarySidebar collapsed={false} onToggle={vi.fn()} />);

    const button = screen.getByTitle('Collapse sidebar');
    expect(button).toHaveAccessibleName('Collapse media library sidebar');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the title and the library contents while collapsed', () => {
    render(<MediaLibrarySidebar collapsed onToggle={vi.fn()} />);

    expect(screen.queryByText('Media Library')).not.toBeInTheDocument();
    expect(screen.queryByText('Drop media or click to browse')).not.toBeInTheDocument();
  });

  it('offers to expand while collapsed', () => {
    render(<MediaLibrarySidebar collapsed onToggle={vi.fn()} />);

    const button = screen.getByTitle('Expand sidebar');
    expect(button).toHaveAccessibleName('Expand media library sidebar');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('points the chevron the other way once collapsed', () => {
    const open = render(<MediaLibrarySidebar collapsed={false} onToggle={vi.fn()} />);
    const openPoints = open.container.querySelector('polyline')!.getAttribute('points');
    open.unmount();

    const shut = render(<MediaLibrarySidebar collapsed onToggle={vi.fn()} />);
    const shutPoints = shut.container.querySelector('polyline')!.getAttribute('points');

    expect(openPoints).toBe('15 18 9 12 15 6');
    expect(shutPoints).toBe('9 18 15 12 9 6');
  });

  it('asks its caller to toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MediaLibrarySidebar collapsed={false} onToggle={onToggle} />);

    await user.click(screen.getByTitle('Collapse sidebar'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
