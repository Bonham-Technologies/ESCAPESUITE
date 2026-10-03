// Where a dragged keyframe is allowed to land (ESCSUITE-183).
//
// `moveClipKeyframe` deletes whatever already sits within
// `KEYFRAME_TIME_EPSILON` of the time it is told to move a keyframe to, so a
// drag must not be able to aim for one. Both keyframe drags — the diamond on a
// `KeyframeTrack` row (`KeyframePanel/hooks/useKeyframeDrag.ts`) and the point
// in the graph (`KeyframePanel/KeyframeGraph.tsx`) — clamp the pointer's time
// through this module on every move, so the point stops at the edge of a
// neighbour's forbidden window instead of following the pointer into it and
// snapping back on release: the shape ESCSUITE-88 ruled against for a locked
// track's own drag, and the shape a trim has not had since ESCSUITE-161.
//
// It lives here, beside `KEYFRAME_TIME_EPSILON`, rather than in either hook,
// because both hooks made the identical numeric decision and had to be fixed
// twice (review of ESCSUITE-183, finding 3) — and because the decision is pure
// arithmetic that deserves tests of its own rather than only being reachable
// through two hooks' pointer plumbing.
import { KEYFRAME_TIME_EPSILON } from './animation';

/**
 * A hair past `KEYFRAME_TIME_EPSILON` itself, so a landing on a window's edge
 * measures back as *outside* the epsilon it was computed from. In exact
 * arithmetic `occupiedTime ± KEYFRAME_TIME_EPSILON` is exactly one epsilon
 * away; in floating point it is not always — `Math.abs(3 - (3 + 0.001))` comes
 * back `0.0009999999999998899`, which IS `< 0.001` — so without the margin a
 * landing the clamp meant to allow can still read as occupied to anything that
 * asks the strict `< KEYFRAME_TIME_EPSILON` question (`moveClipKeyframe`
 * itself, among others).
 *
 * Private to this module: six decades below the epsilon it rides on, ~8 ulps at
 * `t ≈ 1e6 s`, and three decades inside the `toBeCloseTo(…, 6)` tolerance the
 * tests use, so it never changes which times are "near" one another.
 */
const CLAMP_MARGIN = 1e-9;

/** One forbidden span of time: no keyframe may land strictly inside it. */
export interface OccupiedWindow {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The forbidden windows around a set of occupied keyframe times, merged where
 * two windows overlap or touch (there is no legal landing between them), sorted
 * ascending.
 *
 * Built ONCE per gesture — in `startDrag` / `handleKeyframeMouseDown` — and
 * never per pointer move: the keyframe array cannot change under a live drag,
 * and `KeyframePanel/keyframeGestures.perf.test.ts` pins the count for both
 * drags.
 */
export function occupiedWindows(times: readonly number[]): readonly OccupiedWindow[] {
  const sorted = [...times].sort((a, b) => a - b);
  const windows: OccupiedWindow[] = [];

  for (const time of sorted) {
    const lo = time - KEYFRAME_TIME_EPSILON - CLAMP_MARGIN;
    const hi = time + KEYFRAME_TIME_EPSILON + CLAMP_MARGIN;
    const last = windows[windows.length - 1];
    if (last && lo <= last.hi) {
      // Two keyframes closer than twice the epsilon leave nothing legal
      // between them, so their windows become one: a pointer aimed into the
      // gap comes back out the side it went in by, rather than being parked on
      // an "edge" that is still inside the other one's window.
      windows[windows.length - 1] = { lo: last.lo, hi: Math.max(last.hi, hi) };
    } else {
      windows.push({ lo, hi });
    }
  }

  return windows;
}

/**
 * Where a dragged keyframe lands for a pointer at `time`.
 *
 * `time` itself when it is inside no window. Otherwise the window's edge on the
 * side the pointer approached from — `previousTime` at or left of `lo` means it
 * came from the left and stops at `lo`, at or right of `hi` means it came from
 * the right and stops at `hi`, and a `previousTime` inside the window (only
 * reachable from a keyframe sitting exactly one epsilon from its neighbour,
 * close enough to be inside the window and far enough not to be excluded from
 * the occupied list) takes whichever edge is nearer. If that edge falls outside
 * `[min, max]` the other one is used instead — a neighbour at the clip's own
 * end has to push the point left, not right and then back onto itself — and
 * `null` is returned when neither edge is legal, which happens only when the
 * merged window covers the whole clip. A `null` means the move is ignored: the
 * keyframe stays where it is.
 *
 * Allocation-free, and called on every pointer move; the window list is
 * per-property and short, so a linear scan is the whole algorithm.
 */
export function clampToLegalTime(
  time: number,
  previousTime: number,
  windows: readonly OccupiedWindow[],
  min: number,
  max: number
): number | null {
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    if (time <= window.lo || time >= window.hi) continue;

    const fromLeft = previousTime <= window.lo
      ? true
      : previousTime >= window.hi
        ? false
        : time - window.lo <= window.hi - time;

    const approached = fromLeft ? window.lo : window.hi;
    if (approached >= min && approached <= max) return approached;

    const other = fromLeft ? window.hi : window.lo;
    if (other >= min && other <= max) return other;

    return null;
  }

  return time;
}
