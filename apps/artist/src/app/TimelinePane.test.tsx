// The bottom pane on its own: its height, its controls and the zoom readout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { TimelinePane } from './TimelinePane';
import { resetStoreForTest } from '../test/fixtures/projectStore';
import { installResizeObserverDouble, type ResizeObserverDouble } from '../test/doubles/resizeObserver';

let resizeObserver: ResizeObserverDouble;

beforeEach(() => {
  resizeObserver = installResizeObserverDouble();
  resetStoreForTest();
});

afterEach(() => {
  resizeObserver.uninstall();
});

function renderPane(overrides: Partial<ComponentProps<typeof TimelinePane>> = {}) {
  const props = {
    height: 320,
    zoom: 1,
    onAddTrack: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onExportSelection: vi.fn(),
  };
  const merged = { ...props, ...overrides };
  const view = render(<TimelinePane {...merged} />);
  return { ...merged, ...view };
}

describe('TimelinePane', () => {
  it('takes the height it is given', () => {
    const { container } = renderPane({ height: 420 });

    expect(container.querySelector('footer')).toHaveStyle({ height: '420px' });
  });

  it('renders the timeline underneath its controls', () => {
    renderPane();

    expect(screen.getByText('Add Track')).toBeInTheDocument();
    expect(screen.getByText('Track 1')).toBeInTheDocument();
  });

  it('adds a track with no arguments', async () => {
    const user = userEvent.setup();
    const { onAddTrack } = renderPane();

    await user.click(screen.getByRole('button', { name: 'Add new track' }));

    expect(onAddTrack).toHaveBeenCalledTimes(1);
    expect(onAddTrack).toHaveBeenCalledWith();
  });

  it('zooms in and out', async () => {
    const user = userEvent.setup();
    const { onZoomIn, onZoomOut } = renderPane();

    await user.click(screen.getByTitle('Zoom in'));
    await user.click(screen.getByTitle('Zoom out'));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('reads the zoom out as a whole percentage, in the label and the text', () => {
    renderPane({ zoom: 1.25 });

    const readout = screen.getByText('125%');
    expect(readout).toHaveAttribute('aria-label', 'Zoom level 125%');
  });

  it('rounds an awkward zoom factor', () => {
    renderPane({ zoom: 0.8192 });

    expect(screen.getByText('82%')).toHaveAttribute('aria-label', 'Zoom level 82%');
  });
});
