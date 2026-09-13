// The timeline panel's height: the drag that resizes it, the double-click
// that resets it, and the value persisted between sessions.
//
// Its effect is the editor's **fifth**, so `App` calls this hook eighth.
//
// The effect's deps are `[isResizing, timelineHeight]`, so both `document`
// listeners and both `document.body.style` writes are torn down and redone on
// every clamped pixel of a drag. That churn is load-bearing rather than waste:
// it is how `handleResizeEnd` comes to close over the final height and persist
// it. `src/hooks/useDocumentListener.ts` deliberately is not used here — it
// keeps the handler in a ref and re-binds only on `eventType`/`enabled`, which
// would break exactly that.
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TIMELINE_HEIGHT } from './appConstants';
import { clampTimelineHeight, heightFromPointer, readStoredTimelineHeight, storeTimelineHeight } from './timelineHeight';
import type React from 'react';
import type { ShowNotification } from './useNotification';

/** What the resize gesture needs from outside. */
export interface TimelineHeightDeps {
  showNotification: ShowNotification;
}

/** The panel's height, and the two gestures that change it. */
export interface TimelineHeightControl {
  /** The timeline panel's height in pixels, applied as the footer's inline style. */
  timelineHeight: number;
  /** A drag is in progress; the grab strip shows an active state. */
  isResizing: boolean;
  /** `onMouseDown` for the grab strip. */
  handleResizeStart: (e: React.MouseEvent) => void;
  /** `onDoubleClick` for the grab strip: back to the default height. */
  handleResizeDoubleClick: () => void;
}

export function useTimelineHeight({ showNotification }: TimelineHeightDeps): TimelineHeightControl {
  // The initialiser stays lazy: it reads localStorage, and passing
  // readStoredTimelineHeight() would re-read it on every render.
  const [timelineHeight, setTimelineHeight] = useState(readStoredTimelineHeight);
  const [isResizing, setIsResizing] = useState(false);

  // Timeline resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleResizeDoubleClick = useCallback(() => {
    setTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
    storeTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
    showNotification('Timeline height reset', 'info');
  }, [showNotification]);

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent) => {
      // Calculate new height based on mouse position from bottom of window
      const newHeight = heightFromPointer(e.clientY, window.innerHeight);
      const clampedHeight = clampTimelineHeight(newHeight);
      setTimelineHeight(clampedHeight);
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
      // Save to localStorage
      storeTimelineHeight(timelineHeight);
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // Add resize cursor to body while dragging
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, timelineHeight]);

  return { timelineHeight, isResizing, handleResizeStart, handleResizeDoubleClick };
}
