import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualizedTimeline, groupClipsByTrack } from './useVirtualizedTimeline';
import type { Clip } from '../store/types';

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
