// The timeline's zoom steps: one factor of 1.25 in each direction.
//
// Binds no effects, so its place in `App`'s hook order is free; it is sixth
// because the keyboard-shortcut hook takes both handlers as parameters and the
// footer's two buttons call the same ones.
import { useCallback } from 'react';

/** The current scale, and the way to change it. */
export interface TimelineZoomDeps {
  zoom: number;
  setZoom: (zoom: number) => void;
}

/** The two zoom steps, shared by the footer buttons and `+`/`-`. */
export interface TimelineZoom {
  handleZoomIn: () => void;
  handleZoomOut: () => void;
}

export function useTimelineZoom({ zoom, setZoom }: TimelineZoomDeps): TimelineZoom {
  // Handle zoom
  const handleZoomIn = useCallback(() => {
    setZoom(zoom * 1.25);
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(zoom / 1.25);
  }, [zoom, setZoom]);

  return { handleZoomIn, handleZoomOut };
}
