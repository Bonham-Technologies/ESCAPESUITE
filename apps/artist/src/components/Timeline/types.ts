// Shapes shared by the timeline modules.
//
// `Timeline` owns the pointer gestures — dragging a clip and trimming its edges
// — but `TimelineTrack` has to draw them, so both need to name the same thing
// without either importing the other.
import type { TrimOrigin } from './timelineGeometry';

/** A clip being dragged: where it started, and where the pointer has taken it. */
export interface DragState {
  clipId: string;
  originalTrackId: string;
  originalPosition: number;
  currentTrackId: string;
  currentPosition: number;
  snappedPosition: number | null;
  /**
   * The other clips the drop will move by the same time — the clips linked to
   * the dragged one, unless Alt is held (ESCSUITE-355) — so their boxes follow
   * the ghost. Absent when there are none.
   */
  companions?: ReadonlySet<string>;
}

/** A clip edge being dragged, with the trim it started from so it can be re-derived. */
export interface TrimState {
  clipId: string;
  edge: 'start' | 'end';
  /** The clip's trim and position when the gesture began — `computeTrimUpdate`'s `origin`. */
  origin: TrimOrigin;
}
