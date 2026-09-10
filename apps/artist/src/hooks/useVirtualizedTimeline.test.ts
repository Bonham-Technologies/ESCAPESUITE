import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useVirtualizedTimeline, useScrollTracker, groupClipsByTrack } from './useVirtualizedTimeline';
import type { Clip } from '../store/types';
import { installResizeObserverDouble } from '../test/doubles/resizeObserver';

// Helper to create a mock clip
function createMockClip(id: string, trackId: string, timelinePosition: number, duration: number): Clip {
  return {
    id,
    sourceVideoId: 'source-1',
    name: `Clip ${id}`,
    startTime: 0,
    endTime: duration,
    duration,
    trackId,
    timelinePosition,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0 },
  };
}

describe('useVirtualizedTimeline', () => {
  const pixelsPerSecond = 50;

  it('returns all clips when container width is 0 (initial state)', () => {
    const clips = [
      createMockClip('1', 'track-1', 0, 5),
      createMockClip('2', 'track-1', 10, 5),
      createMockClip('3', 'track-1', 20, 5),
    ];

    const { result } = renderHook(() =>
      useVirtualizedTimeline({ clips, pixelsPerSecond })
    );

    // Before container width is set, returns all clips
    expect(result.current.visibleClips.length).toBe(3);
  });

  it('filters clips based on viewport', () => {
    const clips = [
      createMockClip('1', 'track-1', 0, 5),    // 0-250px
      createMockClip('2', 'track-1', 10, 5),   // 500-750px
      createMockClip('3', 'track-1', 20, 5),   // 1000-1250px
      createMockClip('4', 'track-1', 30, 5),   // 1500-1750px
    ];

    const { result } = renderHook(() =>
      useVirtualizedTimeline({ clips, pixelsPerSecond, overscan: 100 })
    );

    // Set container width and scroll position
    act(() => {
      result.current.setContainerWidth(500);
    });

    // At scroll 0, with 500px width and 100px overscan, viewport is -100 to 600
    // Clips visible: 1 (0-250) and 2 (500-750)
    expect(result.current.visibleClips.length).toBe(2);
    expect(result.current.visibleClips.map(vc => vc.clip.id)).toEqual(['1', '2']);
  });

  it('updates visible clips when scrolling', () => {
    const clips = [
      createMockClip('1', 'track-1', 0, 5),    // 0-250px
      createMockClip('2', 'track-1', 10, 5),   // 500-750px
      createMockClip('3', 'track-1', 20, 5),   // 1000-1250px
      createMockClip('4', 'track-1', 30, 5),   // 1500-1750px
    ];

    const { result } = renderHook(() =>
      useVirtualizedTimeline({ clips, pixelsPerSecond, overscan: 100 })
    );

    act(() => {
      result.current.setContainerWidth(500);
    });

    // Scroll to 1000px, viewport is 900-1600
    act(() => {
      result.current.onScroll(1000);
    });

    // Clips visible: 3 (1000-1250) and 4 (1500-1750)
    expect(result.current.visibleClips.length).toBe(2);
    expect(result.current.visibleClips.map(vc => vc.clip.id)).toEqual(['3', '4']);
  });

  it('includes clips that partially intersect viewport', () => {
    const clips = [
      createMockClip('1', 'track-1', 0, 5),    // 0-250px
    ];

    const { result } = renderHook(() =>
      useVirtualizedTimeline({ clips, pixelsPerSecond, overscan: 0 })
    );

    act(() => {
      result.current.setContainerWidth(100);
    });

    // Scroll to 200px, viewport is 200-300
    // Clip 1 ends at 250, so it should still be visible
    act(() => {
      result.current.onScroll(200);
    });

    expect(result.current.visibleClips.length).toBe(1);
  });

  it('calculates correct pixel positions', () => {
    const clips = [
      createMockClip('1', 'track-1', 2, 3), // position 2s, duration 3s
    ];

    const { result } = renderHook(() =>
      useVirtualizedTimeline({ clips, pixelsPerSecond: 100 })
    );

    const visibleClip = result.current.visibleClips[0];
    expect(visibleClip.left).toBe(200); // 2s * 100px/s
    expect(visibleClip.width).toBe(300); // 3s * 100px/s
  });
});

describe('groupClipsByTrack', () => {
  it('groups clips by track ID', () => {
    const clips = [
      { clip: createMockClip('1', 'track-1', 0, 5), left: 0, width: 250 },
      { clip: createMockClip('2', 'track-2', 0, 5), left: 0, width: 250 },
      { clip: createMockClip('3', 'track-1', 10, 5), left: 500, width: 250 },
    ];

    const grouped = groupClipsByTrack(clips);

    expect(grouped.size).toBe(2);
    expect(grouped.get('track-1')?.length).toBe(2);
    expect(grouped.get('track-2')?.length).toBe(1);
  });

  it('returns empty map for empty input', () => {
    const grouped = groupClipsByTrack([]);
    expect(grouped.size).toBe(0);
  });
});

describe('useScrollTracker', () => {
  let observer: ReturnType<typeof installResizeObserverDouble>;

  beforeEach(() => {
    vi.useFakeTimers();
    observer = installResizeObserverDouble();
  });

  afterEach(() => {
    cleanup();
    observer.uninstall();
    vi.useRealTimers();
  });

  /** A scrollable container with the metrics jsdom otherwise reports as 0. */
  function container(clientWidth = 800, scrollLeft = 0): HTMLDivElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(element, 'scrollLeft', { value: scrollLeft, writable: true, configurable: true });
    return element;
  }

  it('reports the container width as soon as it is observed', () => {
    const onScroll = vi.fn();
    const onResize = vi.fn();
    const ref = { current: container(640) };

    renderHook(() => useScrollTracker(ref, onScroll, onResize));

    expect(onResize).toHaveBeenCalledExactlyOnceWith(640);
    expect(observer.observed).toEqual([ref.current]);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('does nothing when the ref is not attached yet', () => {
    const onScroll = vi.fn();
    const onResize = vi.fn();

    renderHook(() =>
      useScrollTracker({ current: null } as unknown as React.RefObject<HTMLElement>, onScroll, onResize)
    );

    expect(onResize).not.toHaveBeenCalled();
    expect(observer.observed).toEqual([]);
  });

  it('reports the scroll position once per animation frame', () => {
    const onScroll = vi.fn();
    const element = container();
    const ref = { current: element };

    renderHook(() => useScrollTracker(ref, onScroll, vi.fn()));

    element.scrollLeft = 120;
    element.dispatchEvent(new Event('scroll'));
    element.scrollLeft = 240;
    element.dispatchEvent(new Event('scroll'));

    // Coalesced: nothing reported until the frame runs.
    expect(onScroll).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(onScroll).toHaveBeenCalledExactlyOnceWith(240);
  });

  it('reports again on the next frame after the first one has run', () => {
    const onScroll = vi.fn();
    const element = container();
    const ref = { current: element };

    renderHook(() => useScrollTracker(ref, onScroll, vi.fn()));

    element.scrollLeft = 10;
    element.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(16);
    });

    element.scrollLeft = 20;
    element.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(onScroll.mock.calls.map((c) => c[0])).toEqual([10, 20]);
  });

  it('subscribes to scroll passively so it never blocks scrolling', () => {
    const element = container();
    const add = vi.spyOn(element, 'addEventListener');

    renderHook(() => useScrollTracker({ current: element }, vi.fn(), vi.fn()));

    const scrollSubscription = add.mock.calls.find((c) => c[0] === 'scroll')!;
    expect(scrollSubscription[2]).toEqual({ passive: true });
  });

  it('reports the observed width whenever the container is resized', () => {
    const onResize = vi.fn();
    const element = container(800);

    renderHook(() => useScrollTracker({ current: element }, vi.fn(), onResize));
    onResize.mockClear();

    act(() => {
      observer.emit(element, { width: 1024, height: 200 });
    });

    expect(onResize).toHaveBeenCalledExactlyOnceWith(1024);
  });

  it('detaches the listener, the observer and any pending frame on unmount', () => {
    const onScroll = vi.fn();
    const onResize = vi.fn();
    const element = container();

    const { unmount } = renderHook(() => useScrollTracker({ current: element }, onScroll, onResize));

    // Leave a frame pending, then unmount before it runs.
    element.scrollLeft = 50;
    element.dispatchEvent(new Event('scroll'));
    unmount();

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onScroll).not.toHaveBeenCalled();
    expect(observer.disconnected).toBe(1);

    // Further scrolls and resizes are ignored.
    onResize.mockClear();
    element.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(16);
    });
    observer.emit(element, { width: 999, height: 10 });
    expect(onScroll).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });
});
