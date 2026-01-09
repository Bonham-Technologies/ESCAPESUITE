import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Clip } from '../store/types';

interface VirtualizedClip {
  clip: Clip;
  left: number;
  width: number;
}

interface UseVirtualizedTimelineOptions {
  /** All clips to virtualize */
  clips: Clip[];
  /** Pixels per second for time-to-pixel conversion */
  pixelsPerSecond: number;
  /** Extra pixels to render outside viewport (buffer) */
  overscan?: number;
}

interface UseVirtualizedTimelineResult {
  /** Clips that should be rendered (within viewport + overscan) */
  visibleClips: VirtualizedClip[];
  /** Callback to update scroll position */
  onScroll: (scrollLeft: number) => void;
  /** Callback to update container width */
  setContainerWidth: (width: number) => void;
  /** Current scroll position */
  scrollLeft: number;
  /** Current container width */
  containerWidth: number;
}

/**
 * Hook for virtualizing timeline clip rendering.
 * Only returns clips that are visible within the viewport (plus overscan buffer).
 *
 * Performance improvement: Instead of rendering all clips regardless of position,
 * this hook filters to only render clips that intersect the visible area.
 *
 * @example
 * const { visibleClips, onScroll, setContainerWidth } = useVirtualizedTimeline({
 *   clips: allClips,
 *   pixelsPerSecond: 50 * zoom,
 *   overscan: 200,
 * });
 */
export function useVirtualizedTimeline({
  clips,
  pixelsPerSecond,
  overscan = 200,
}: UseVirtualizedTimelineOptions): UseVirtualizedTimelineResult {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Memoize clip positions to avoid recalculating on every render
  const clipPositions = useMemo(() => {
    return clips.map(clip => ({
      clip,
      left: clip.timelinePosition * pixelsPerSecond,
      width: clip.duration * pixelsPerSecond,
    }));
  }, [clips, pixelsPerSecond]);

  // Filter to visible clips
  const visibleClips = useMemo(() => {
    if (containerWidth === 0) {
      // Before we know the container width, return all clips
      return clipPositions;
    }

    const viewportLeft = scrollLeft - overscan;
    const viewportRight = scrollLeft + containerWidth + overscan;

    return clipPositions.filter(({ left, width }) => {
      const right = left + width;
      // Clip is visible if it intersects the viewport
      return right >= viewportLeft && left <= viewportRight;
    });
  }, [clipPositions, scrollLeft, containerWidth, overscan]);

  const onScroll = useCallback((newScrollLeft: number) => {
    setScrollLeft(newScrollLeft);
  }, []);

  return {
    visibleClips,
    onScroll,
    setContainerWidth,
    scrollLeft,
    containerWidth,
  };
}

/**
 * Hook for tracking a container's scroll position and size.
 * Use with a scrollable container ref.
 */
export function useScrollTracker(
  containerRef: React.RefObject<HTMLElement>,
  onScroll: (scrollLeft: number) => void,
  onResize: (width: number) => void
) {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial size
    onResize(container.clientWidth);

    // Throttled scroll handler
    const handleScroll = () => {
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onScroll(container.scrollLeft);
      });
    };

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onResize(entry.contentRect.width);
      }
    });

    container.addEventListener('scroll', handleScroll, { passive: true });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [containerRef, onScroll, onResize]);
}

/**
 * Utility to group clips by track ID for efficient rendering.
 */
export function groupClipsByTrack(clips: VirtualizedClip[]): Map<string, VirtualizedClip[]> {
  const map = new Map<string, VirtualizedClip[]>();

  for (const item of clips) {
    const trackId = item.clip.trackId;
    const existing = map.get(trackId);
    if (existing) {
      existing.push(item);
    } else {
      map.set(trackId, [item]);
    }
  }

  return map;
}
