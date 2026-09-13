// The right sidebar on its own: the collapse fork, and the clip editor only
// while it is open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorSidebar } from './InspectorSidebar';
import { resetStoreForTest } from '../test/fixtures/projectStore';

beforeEach(() => {
  resetStoreForTest();
});

describe('InspectorSidebar', () => {
  it('labels itself by its own heading', () => {
    const { container } = render(<InspectorSidebar collapsed={false} onToggle={vi.fn()} />);

    expect(container.querySelector('aside')).toHaveAttribute('aria-labelledby', 'inspector-title');
    expect(screen.getByText('Inspector')).toHaveAttribute('id', 'inspector-title');
  });

  it('shows the clip editor while open', () => {
    render(<InspectorSidebar collapsed={false} onToggle={vi.fn()} />);

    expect(screen.getByText('Select a clip to edit')).toBeInTheDocument();
  });

  it('offers to hide while open', () => {
    render(<InspectorSidebar collapsed={false} onToggle={vi.fn()} />);

    const button = screen.getByTitle('Hide inspector');
    expect(button).toHaveAccessibleName('Hide inspector panel');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('drops the clip editor and offers to show while collapsed', () => {
    render(<InspectorSidebar collapsed onToggle={vi.fn()} />);

    expect(screen.queryByText('Select a clip to edit')).not.toBeInTheDocument();
    const button = screen.getByTitle('Show inspector');
    expect(button).toHaveAccessibleName('Show inspector panel');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Inspector')).toBeInTheDocument();
  });

  it('points the chevron the other way once collapsed', () => {
    const open = render(<InspectorSidebar collapsed={false} onToggle={vi.fn()} />);
    const openPoints = open.container.querySelector('polyline')!.getAttribute('points');
    open.unmount();

    const shut = render(<InspectorSidebar collapsed onToggle={vi.fn()} />);
    const shutPoints = shut.container.querySelector('polyline')!.getAttribute('points');

    expect(openPoints).toBe('9 18 15 12 9 6');
    expect(shutPoints).toBe('15 18 9 12 15 6');
  });

  it('asks its caller to toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<InspectorSidebar collapsed onToggle={onToggle} />);

    await user.click(screen.getByTitle('Show inspector'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
