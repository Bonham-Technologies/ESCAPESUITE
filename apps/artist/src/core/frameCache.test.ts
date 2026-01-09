import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrameCache, getFrameCache, resetFrameCache } from './frameCache';

// Mock ImageBitmap
class MockImageBitmap {
  width: number;
  height: number;
  closed: boolean = false;

  constructor(width: number = 1920, height: number = 1080) {
    this.width = width;
    this.height = height;
  }

  close() {
    this.closed = true;
  }
}

// Mock createImageBitmap
vi.stubGlobal('createImageBitmap', vi.fn(async () => new MockImageBitmap()));

describe('FrameCache', () => {
  let cache: FrameCache;

  beforeEach(() => {
    cache = new FrameCache({ maxFrames: 10, frameRate: 30 });
  });

  afterEach(() => {
    cache.clear();
    resetFrameCache();
  });

  describe('basic operations', () => {
    it('stores and retrieves frames', () => {
      const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
      cache.set(1.0, bitmap);

      const retrieved = cache.get(1.0);
      expect(retrieved).toBe(bitmap);
    });

    it('returns null for uncached frames', () => {
      expect(cache.get(5.0)).toBeNull();
    });

    it('quantizes time to frame boundaries', () => {
      const bitmap = new MockImageBitmap() as unknown as ImageBitmap;

      // At 30fps, frame 30 = 1.0s, frame 31 = 1.033s
      cache.set(1.0, bitmap);

      // Same frame (within 1/30th second)
      expect(cache.get(1.0)).toBe(bitmap);
      expect(cache.get(1.01)).toBe(bitmap); // Still frame 30

      // Different frame
      expect(cache.get(1.05)).toBeNull(); // Frame 31
    });

    it('has() checks existence without updating access time', () => {
      const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
      cache.set(1.0, bitmap);

      expect(cache.has(1.0)).toBe(true);
      expect(cache.has(5.0)).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest frames when max is reached', () => {
      const bitmaps: MockImageBitmap[] = [];

      // Fill cache to max (10 frames)
      for (let i = 0; i < 10; i++) {
        const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
        bitmaps.push(bitmap as unknown as MockImageBitmap);
        cache.set(i, bitmap);
      }

      // Add one more - should evict frame 0
      const newBitmap = new MockImageBitmap() as unknown as ImageBitmap;
      cache.set(10, newBitmap);

      expect(cache.has(0)).toBe(false); // Evicted
      expect(cache.has(10)).toBe(true); // New one exists
      expect(bitmaps[0].closed).toBe(true); // Bitmap was closed
    });

    it('updates access time on get()', async () => {
      // Use fake timers to control time progression
      vi.useFakeTimers();

      // Add frames 0-9 with increasing timestamps
      for (let i = 0; i < 10; i++) {
        const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
        cache.set(i, bitmap);
        vi.advanceTimersByTime(100); // Each frame added 100ms apart
      }

      // Access frame 0 to make it most recently used
      vi.advanceTimersByTime(100);
      cache.get(0);

      // Add a new frame - should evict frame 1 (oldest accessed after frame 0 was refreshed)
      vi.advanceTimersByTime(100);
      cache.set(10, new MockImageBitmap() as unknown as ImageBitmap);

      expect(cache.has(0)).toBe(true); // Still exists (recently accessed)
      expect(cache.has(1)).toBe(false); // Evicted

      vi.useRealTimers();
    });
  });

  describe('clear and invalidate', () => {
    it('clear() removes all frames', () => {
      const bitmaps: MockImageBitmap[] = [];

      for (let i = 0; i < 5; i++) {
        const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
        bitmaps.push(bitmap as unknown as MockImageBitmap);
        cache.set(i, bitmap);
      }

      cache.clear();

      expect(cache.getStats().frameCount).toBe(0);
      bitmaps.forEach(b => expect(b.closed).toBe(true));
    });

    it('invalidateRange() removes frames in range', () => {
      for (let i = 0; i < 5; i++) {
        cache.set(i, new MockImageBitmap() as unknown as ImageBitmap);
      }

      cache.invalidateRange(1, 3); // Frames at t=1, 2, 3

      expect(cache.has(0)).toBe(true);
      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(false);
      expect(cache.has(3)).toBe(false);
      expect(cache.has(4)).toBe(true);
    });
  });

  describe('statistics', () => {
    it('tracks hits and misses', () => {
      cache.set(1.0, new MockImageBitmap() as unknown as ImageBitmap);

      cache.get(1.0); // Hit
      cache.get(1.0); // Hit
      cache.get(5.0); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('tracks frame count', () => {
      cache.set(1.0, new MockImageBitmap() as unknown as ImageBitmap);
      cache.set(2.0, new MockImageBitmap() as unknown as ImageBitmap);

      expect(cache.getStats().frameCount).toBe(2);
    });

    it('tracks memory usage', () => {
      // 1920x1080x4 bytes = 8,294,400 bytes per frame
      cache.set(1.0, new MockImageBitmap() as unknown as ImageBitmap);

      const stats = cache.getStats();
      expect(stats.memoryBytes).toBe(1920 * 1080 * 4);
    });
  });

  describe('getCachedRanges', () => {
    it('returns empty array for empty cache', () => {
      expect(cache.getCachedRanges()).toEqual([]);
    });

    it('returns contiguous ranges', () => {
      // Cache frames at t=0, 1/30, 2/30 (frames 0, 1, 2)
      for (let i = 0; i < 3; i++) {
        cache.set(i / 30, new MockImageBitmap() as unknown as ImageBitmap);
      }

      const ranges = cache.getCachedRanges();
      expect(ranges.length).toBe(1);
      expect(ranges[0].start).toBe(0);
      expect(ranges[0].end).toBeCloseTo(3 / 30);
    });

    it('returns separate ranges for gaps', () => {
      // Cache frames 0, 1 and 5, 6
      cache.set(0, new MockImageBitmap() as unknown as ImageBitmap);
      cache.set(1 / 30, new MockImageBitmap() as unknown as ImageBitmap);
      cache.set(5 / 30, new MockImageBitmap() as unknown as ImageBitmap);
      cache.set(6 / 30, new MockImageBitmap() as unknown as ImageBitmap);

      const ranges = cache.getCachedRanges();
      expect(ranges.length).toBe(2);
    });
  });

  describe('global cache', () => {
    it('returns singleton instance', () => {
      const cache1 = getFrameCache();
      const cache2 = getFrameCache();

      expect(cache1).toBe(cache2);
    });

    it('resetFrameCache clears and nullifies', () => {
      const cache1 = getFrameCache();
      cache1.set(1.0, new MockImageBitmap() as unknown as ImageBitmap);

      resetFrameCache();

      const cache2 = getFrameCache();
      expect(cache2).not.toBe(cache1);
      expect(cache2.has(1.0)).toBe(false);
    });
  });
});
