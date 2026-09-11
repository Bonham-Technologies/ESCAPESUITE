// The pointer's promise: which transform a press here would start.
//
// Split out of the mouse state machine because it is the one part of it with
// no state at all — a drag mode in, a CSS cursor keyword out.
import type { DragMode } from './types';

/** Get cursor based on drag mode */
export function getCursorForMode(mode: DragMode): string {
  switch (mode) {
    case 'move': return 'move';
    case 'rotate': return 'crosshair';
    case 'resize-n':
    case 'resize-s': return 'ns-resize';
    case 'resize-e':
    case 'resize-w': return 'ew-resize';
    case 'resize-nw':
    case 'resize-se': return 'nwse-resize';
    case 'resize-ne':
    case 'resize-sw': return 'nesw-resize';
    default: return 'default';
  }
}
