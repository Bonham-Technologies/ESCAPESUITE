// Shapes shared by the timeline modules.
//
// `Timeline` owns the pointer gestures — dragging a clip and trimming its edges
// — but `TimelineTrack` has to draw them, so both need to name the same thing
// without either importing the other.

/** A clip being dragged: where it started, and where the pointer has taken it. */
export interface DragState {
  clipId: string;
  originalTrackId: string;
  originalPosition: number;
  currentTrackId: string;
  currentPosition: number;
  snappedPosition: number | null;
  offsetX: number; // Mouse offset from clip left edge
}

/** A clip edge being dragged, with the trim it started from so it can be re-derived. */
export interface TrimState {
  clipId: string;
  edge: 'start' | 'end';
  originalStartTime: number;
  originalEndTime: number;
  originalTimelinePosition: number;
}
