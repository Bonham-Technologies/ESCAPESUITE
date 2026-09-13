// The drag strip above the timeline on its own.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineResizeHandle } from './TimelineResizeHandle';
import styles from '../App.module.css';

describe('TimelineResizeHandle', () => {
  it('names the gesture it supports', () => {
    render(<TimelineResizeHandle isResizing={false} onMouseDown={vi.fn()} onDoubleClick={vi.fn()} />);

    expect(screen.getByTitle('Drag to resize timeline (double-click to reset)')).toBeInTheDocument();
  });

  it('looks idle when no drag is in progress', () => {
    render(<TimelineResizeHandle isResizing={false} onMouseDown={vi.fn()} onDoubleClick={vi.fn()} />);

    const handle = screen.getByTitle('Drag to resize timeline (double-click to reset)');
    expect(handle).not.toHaveClass(styles.resizeHandleActive);
    expect(handle).toHaveClass(styles.resizeHandle);
  });

  it('looks active while a drag is in progress', () => {
    render(<TimelineResizeHandle isResizing onMouseDown={vi.fn()} onDoubleClick={vi.fn()} />);

    expect(screen.getByTitle('Drag to resize timeline (double-click to reset)')).toHaveClass(
      styles.resizeHandleActive
    );
  });

  it('reports the drag starting', () => {
    const onMouseDown = vi.fn();
    render(<TimelineResizeHandle isResizing={false} onMouseDown={onMouseDown} onDoubleClick={vi.fn()} />);

    fireEvent.mouseDown(screen.getByTitle('Drag to resize timeline (double-click to reset)'));

    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it('reports the double-click that resets the height', () => {
    const onDoubleClick = vi.fn();
    render(<TimelineResizeHandle isResizing={false} onMouseDown={vi.fn()} onDoubleClick={onDoubleClick} />);

    fireEvent.doubleClick(screen.getByTitle('Drag to resize timeline (double-click to reset)'));

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
