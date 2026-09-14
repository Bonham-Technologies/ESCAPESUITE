// Measuring the track area once per gesture instead of once per pointer frame.
//
// Every timeline gesture converts a client coordinate into a timeline one, and
// the conversion needs two things the DOM only gives up through a forced
// layout: where the scrolling track container sits on screen, and where each
// `[data-track-id]` row sits inside it. Neither moves while the pointer is
// dragging — so they are measured on mousedown and held for the life of the
// gesture, and a move reads nothing from layout but `scrollLeft`/`scrollTop`,
// which are scroll-position properties rather than geometry.
//
// Rows are kept in the container's own **layout space** — each row's top
// measured from the top of the unscrolled track area — precisely so that
// scrolling during a drag does not invalidate them: a move re-derives the
// pointer's layout-space Y as `clientY - box.top + scrollTop`.
//
// Two things *do* move the box while a gesture runs, and both are listened for:
// a scroll anywhere in the ancestor chain (captured, because scroll does not
// bubble) and a window resize. Either drops the cache, and the next read
// re-measures — so a mid-drag scroll costs one extra measurement, not a clip
// dropped on the wrong track.
//
// Note what `resize` here does and does not cover: it is a **window** resize.
// Dragging the editor's panel splitter also resizes the track area without the
// window changing size, and that would *not* invalidate — but it cannot happen
// during one of these gestures, because the splitter drag is itself a pointer
// gesture and only one pointer is down at a time. If track rows ever start
// moving for reasons other than a scroll or a window resize (dynamic row
// heights, say), the hook to reach for is the `ResizeObserver` `useScrollSync`
// already installs on this same container, not a third listener here.
import { useCallback, useEffect, useMemo, useRef } from 'react';

/** One `[data-track-id]` row, in the track area's own layout space. */
export interface TrackRowBox {
  /** The row's `data-track-id`. */
  id: string;
  /** Its top edge, measured from the top of the *unscrolled* track area. */
  top: number;
  /** Its height in pixels. */
  height: number;
}

/** The track area as it stood when it was last measured. */
export interface TrackAreaBox {
  /** Client X of the container's left edge. */
  left: number;
  /** Client Y of the container's top edge. */
  top: number;
  /** The track rows, or null until something asks for them. */
  rows: TrackRowBox[] | null;
}

/** One gesture's worth of track-area geometry. */
export interface TrackAreaCache {
  /**
   * Take the measurement the gesture will use, and start watching for what
   * would make it stale. `container` may be null — the timeline can be
   * unmounted between the press and the first move — in which case nothing is
   * measured and the first read that does have a container takes it instead.
   */
  begin: (container: HTMLElement | null, withRows: boolean) => void;
  /** Drop the measurement and stop watching. Called on mouseup and on unmount. */
  end: () => void;
  /** The container's box, re-measured if a scroll or resize invalidated it. */
  read: (container: HTMLElement) => TrackAreaBox;
  /** The track rows, measured on first use if `begin` did not take them. */
  readRows: (container: HTMLElement) => TrackRowBox[];
}

/** Every `[data-track-id]` row, in the container's layout space. */
function measureRows(container: HTMLElement, box: TrackAreaBox): TrackRowBox[] {
  const scrollTop = container.scrollTop;
  const rows: TrackRowBox[] = [];
  container.querySelectorAll('[data-track-id]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    rows.push({
      // Non-null by construction: the elements come from the `[data-track-id]`
      // selector above, so the attribute is present.
      id: el.getAttribute('data-track-id')!,
      top: rect.top - box.top + scrollTop,
      height: rect.height,
    });
  });
  return rows;
}

/** One pass over the container, and optionally over its rows. */
function measureTrackArea(container: HTMLElement, withRows: boolean): TrackAreaBox {
  const rect = container.getBoundingClientRect();
  const box: TrackAreaBox = { left: rect.left, top: rect.top, rows: null };
  if (withRows) {
    box.rows = measureRows(container, box);
  }
  return box;
}

/**
 * A per-gesture measurement of the scrolling track area.
 *
 * One cache per gesture hook: each holds its own `invalidate`, so the three
 * gestures' scroll listeners are distinct and none can unbind another's.
 */
export function useTrackAreaCache(): TrackAreaCache {
  const boxRef = useRef<TrackAreaBox | null>(null);

  const invalidate = useCallback(() => {
    boxRef.current = null;
  }, []);

  const end = useCallback(() => {
    boxRef.current = null;
    // Both are no-ops when the gesture never started, which is what makes the
    // unmount cleanup below unconditional.
    document.removeEventListener('scroll', invalidate, true);
    window.removeEventListener('resize', invalidate);
  }, [invalidate]);

  const begin = useCallback(
    (container: HTMLElement | null, withRows: boolean) => {
      // Adding the same listener twice is a no-op, so no "already listening"
      // bookkeeping is needed — and none of it can go stale.
      document.addEventListener('scroll', invalidate, true);
      window.addEventListener('resize', invalidate);
      boxRef.current = container ? measureTrackArea(container, withRows) : null;
    },
    [invalidate]
  );

  const read = useCallback((container: HTMLElement): TrackAreaBox => {
    let box = boxRef.current;
    if (!box) {
      box = measureTrackArea(container, false);
      boxRef.current = box;
    }
    return box;
  }, []);

  const readRows = useCallback(
    (container: HTMLElement): TrackRowBox[] => {
      const box = read(container);
      if (!box.rows) {
        box.rows = measureRows(container, box);
      }
      return box.rows;
    },
    [read]
  );

  // A gesture that is still live when the timeline unmounts must not leave its
  // invalidation listeners behind.
  useEffect(() => end, [end]);

  // Memoised, not a fresh literal: the three gesture hooks name the cache in
  // their mousedown `useCallback` deps and `Timeline` passes those handlers
  // down as props, so an object rebuilt per render would make all three
  // callbacks vacuous and allocate three objects per pointer frame — which is
  // the very cost this module exists to remove. Every dep below is a
  // `useCallback` with a stable identity, so this never recomputes.
  return useMemo(() => ({ begin, end, read, readRows }), [begin, end, read, readRows]);
}
