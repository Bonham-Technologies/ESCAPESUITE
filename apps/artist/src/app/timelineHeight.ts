// Timeline panel height: clamping, localStorage persistence and the
// pointer-to-height conversion the resize drag uses.
//
// Pure functions: `localStorage` is the only side effect, isolated in
// `readStoredTimelineHeight`/`storeTimelineHeight` so the maths itself
// (`clampTimelineHeight`, `heightFromPointer`) is testable without a DOM.
import {
  DEFAULT_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
  TIMELINE_HEIGHT_KEY,
} from './appConstants';

/**
 * Clamp a candidate timeline height to the panel's allowed range.
 *
 * `Math.max`/`Math.min` propagate `NaN` rather than clamping it — a value
 * that reaches here as `NaN` (see `readStoredTimelineHeight`) stays `NaN`.
 */
export function clampTimelineHeight(value: number): number {
  return Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, value));
}

/**
 * The timeline height to start from: the clamped, persisted value, or
 * `DEFAULT_TIMELINE_HEIGHT` when nothing is stored yet.
 */
export function readStoredTimelineHeight(): number {
  const saved = localStorage.getItem(TIMELINE_HEIGHT_KEY);
  return saved ? clampTimelineHeight(parseInt(saved, 10)) : DEFAULT_TIMELINE_HEIGHT;
}

/** Persist a timeline height so it survives a reload. */
export function storeTimelineHeight(height: number): void {
  localStorage.setItem(TIMELINE_HEIGHT_KEY, height.toString());
}

/** The timeline height a resize-drag pointer at `clientY` implies. */
export function heightFromPointer(clientY: number, viewportHeight: number): number {
  return viewportHeight - clientY;
}
