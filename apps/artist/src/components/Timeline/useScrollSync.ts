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
// a ResizeObserver instead.
import { useCallback, useEffect, type RefObject } from 'react';

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
  // Sync ruler scroll (horizontal) and track headers scroll (vertical) with track container scroll
  const handleTrackScroll = useCallback(() => {
    if (trackContainerRef.current) {
      // Sync horizontal scroll with ruler
      if (rulerRef.current) {
        rulerRef.current.scrollLeft = trackContainerRef.current.scrollLeft;
      }
      // Sync vertical scroll with track headers
      if (trackHeadersRef.current) {
        trackHeadersRef.current.scrollTop = trackContainerRef.current.scrollTop;
      }
      // Update virtualization with new scroll position
      onVirtualScroll(trackContainerRef.current.scrollLeft);
    }
  }, [onVirtualScroll, trackContainerRef, rulerRef, trackHeadersRef]);

  // Sync track container scroll when track headers are scrolled
  const handleHeadersScroll = useCallback(() => {
    if (trackHeadersRef.current && trackContainerRef.current) {
      trackContainerRef.current.scrollTop = trackHeadersRef.current.scrollTop;
    }
  }, [trackHeadersRef, trackContainerRef]);

  // Track container width for virtualization
  useEffect(() => {
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
