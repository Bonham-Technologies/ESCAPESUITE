// Keeping the timeline's three scrolling panes pointed at the same place.
//
// The ruler, the track headers and the track container are separate scroll
// boxes stacked into a cross: the ruler runs along the top and shares the
// track container's *horizontal* offset, the headers run down the left and
// share its *vertical* offset. Only two of the three are ever driven by a
// user gesture (the container, and the headers when scrolled directly), so
// the mirroring is one-way per handler rather than a loop.
//
// The container's width is the other thing that leaves this file: the
// virtualiser needs it to decide which clips are near enough the viewport to
// draw, and it changes on resize rather than on scroll, so it is watched with
// a ResizeObserver instead. It is measured in a layout effect, not a passive
// one (ESCSUITE-13 round 2, MINOR-6): a passive effect runs after the browser
// has already painted, so the very first frame rendered with `containerWidth`
// still at its initial 0 — `Timeline` treats that as "no viewport known" and
// every clip takes the whole-clip path for one frame, including a clip whose
// box is wide enough that the whole-clip path clamps its canvas, producing a
// visibly compressed waveform for that one frame. A layout effect runs
// before paint, so the browser never shows the unmeasured frame at all.
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** The panes to mirror, and the virtualiser to tell about it. */
export interface ScrollSyncDeps {
  /** The scrolling track area — the pane the other two follow. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** The ruler, which follows the container horizontally. */
  rulerRef: RefObject<HTMLDivElement | null>;
  /** The track header column, which follows the container vertically. */
  trackHeadersRef: RefObject<HTMLDivElement | null>;
  /** `useVirtualizedTimeline`'s `onScroll`: the new horizontal offset. */
  onVirtualScroll: (scrollLeft: number) => void;
  /** `useVirtualizedTimeline`'s `setContainerWidth`, fed by the ResizeObserver. */
  setContainerWidth: (width: number) => void;
}

/** The two `onScroll` handlers the timeline's panes bind to. */
export interface ScrollSync {
  /** `onScroll` for the track container: mirrors to ruler, headers, virtualiser. */
  handleTrackScroll: () => void;
  /** `onScroll` for the track headers: mirrors their vertical offset back. */
  handleHeadersScroll: () => void;
}

export function useScrollSync({
  trackContainerRef,
  rulerRef,
  trackHeadersRef,
  onVirtualScroll,
  setContainerWidth,
}: ScrollSyncDeps): ScrollSync {
  // One `onVirtualScroll` call per animation frame, with whatever `scrollLeft`
  // is current when the frame runs (ESCSUITE-13 round 2, MAJOR-1(c)): a
  // trackpad or an inertial scroll can fire many `scroll` events inside one
  // frame, and `onVirtualScroll` feeds `scrollLeft` into React state that
  // every on-screen clip's waveform re-samples against — uncoalesced, that is
  // one full re-sample per visible audio clip per scroll *event*, not per
  // frame. The ruler and the headers are plain DOM writes with nothing
  // downstream to re-render, so they stay synchronous.
  const scrollRafRef = useRef<number | null>(null);
  const latestScrollLeftRef = useRef(0);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  const handleTrackScroll = useCallback(() => {
    const container = trackContainerRef.current;
    if (!container) return;

    // Sync horizontal scroll with ruler
    if (rulerRef.current) {
      rulerRef.current.scrollLeft = container.scrollLeft;
    }
    // Sync vertical scroll with track headers
    if (trackHeadersRef.current) {
      trackHeadersRef.current.scrollTop = container.scrollTop;
    }

    latestScrollLeftRef.current = container.scrollLeft;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      onVirtualScroll(latestScrollLeftRef.current);
    });
  }, [onVirtualScroll, trackContainerRef, rulerRef, trackHeadersRef]);

  // Sync track container scroll when track headers are scrolled
  const handleHeadersScroll = useCallback(() => {
    if (trackHeadersRef.current && trackContainerRef.current) {
      trackContainerRef.current.scrollTop = trackHeadersRef.current.scrollTop;
    }
  }, [trackHeadersRef, trackContainerRef]);

  // Track container width for virtualization. A layout effect, not a
  // passive one — see the header comment's MINOR-6 note.
  useLayoutEffect(() => {
    const container = trackContainerRef.current;
    if (!container) return;

    // Set initial width
    setContainerWidth(container.clientWidth);

    // Observe resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [setContainerWidth, trackContainerRef]);

  return { handleTrackScroll, handleHeadersScroll };
}
