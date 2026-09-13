// The narrow-width inspector toggle on its own.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileInspectorToggle } from './MobileInspectorToggle';

describe('MobileInspectorToggle', () => {
  it('offers to hide the inspector while it is open', () => {
    render(<MobileInspectorToggle collapsed={false} onToggle={vi.fn()} />);

    const button = screen.getByTitle('Toggle inspector');
    expect(button).toHaveAccessibleName('Hide inspector');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers to show the inspector while it is collapsed', () => {
    render(<MobileInspectorToggle collapsed onToggle={vi.fn()} />);

    const button = screen.getByTitle('Toggle inspector');
    expect(button).toHaveAccessibleName('Show inspector');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('asks its caller to toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MobileInspectorToggle collapsed onToggle={onToggle} />);

    await user.click(screen.getByTitle('Toggle inspector'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
