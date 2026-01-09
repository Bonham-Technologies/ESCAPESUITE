/**
 * Frame Caching System - LRU cache for rendered frames
 *
 * Provides instant scrubbing through cached regions by storing rendered
 * frames as ImageBitmap objects. Uses an LRU (Least Recently Used)
 * eviction policy to manage memory.
 *
 * Benefits:
 * - Instant playback of recently viewed sections
 * - Smooth scrubbing without re-rendering
 * - Configurable memory usage
 *
 * Trade-offs:
 * - Memory usage (configurable via maxSize)
 * - Initial render still required for uncached frames
 */

export interface CachedFrame {
  /** The frame time in seconds */
  time: number;
  /** The rendered frame as an ImageBitmap */
  bitmap: ImageBitmap;
  /** Size in bytes (estimated) */
  sizeBytes: number;
  /** Last access timestamp */
  lastAccess: number;
}

export interface FrameCacheOptions {
  /** Maximum number of frames to cache */
  maxFrames?: number;
  /** Maximum memory in bytes (approximate) */
  maxMemoryBytes?: number;
  /** Frame rate for cache key quantization */
  frameRate?: number;
}

export interface FrameCacheStats {
  /** Number of frames currently cached */
  frameCount: number;
  /** Estimated memory usage in bytes */
  memoryBytes: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Total hits */
  hits: number;
  /** Total misses */
  misses: number;
}

/**
 * LRU Frame Cache for video preview
 */
export class FrameCache {
  private cache: Map<string, CachedFrame> = new Map();
  private maxFrames: number;
  private maxMemoryBytes: number;
  private frameRate: number;
  private currentMemory: number = 0;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: FrameCacheOptions = {}) {
    this.maxFrames = options.maxFrames ?? 300; // ~10 seconds at 30fps
    this.maxMemoryBytes = options.maxMemoryBytes ?? 500 * 1024 * 1024; // 500MB
    this.frameRate = options.frameRate ?? 30;
  }

  /**
   * Quantize time to frame boundary for consistent cache keys
   */
  private timeToKey(time: number): string {
    const frame = Math.floor(time * this.frameRate);
    return `f${frame}`;
  }

  /**
   * Estimate memory size of an ImageBitmap
   */
  private estimateBitmapSize(bitmap: ImageBitmap): number {
    // 4 bytes per pixel (RGBA)
    return bitmap.width * bitmap.height * 4;
  }

  /**
   * Evict least recently used frames until we're under limits
   */
  private evict(spaceNeeded: number = 0): void {
    // Sort by last access time (oldest first)
    const entries = [...this.cache.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    while (
      (this.cache.size >= this.maxFrames ||
        this.currentMemory + spaceNeeded > this.maxMemoryBytes) &&
      entries.length > 0
    ) {
      const [key, frame] = entries.shift()!;
      this.cache.delete(key);
      this.currentMemory -= frame.sizeBytes;
      frame.bitmap.close(); // Free the ImageBitmap memory
    }
  }

  /**
   * Get a cached frame
   */
  get(time: number): ImageBitmap | null {
    const key = this.timeToKey(time);
    const cached = this.cache.get(key);

    if (cached) {
      cached.lastAccess = Date.now();
      this.hits++;
      return cached.bitmap;
    }

    this.misses++;
    return null;
  }

  /**
   * Check if a frame is cached without updating access time
   */
  has(time: number): boolean {
    return this.cache.has(this.timeToKey(time));
  }

  /**
   * Store a frame in the cache
   */
  set(time: number, bitmap: ImageBitmap): void {
    const key = this.timeToKey(time);

    // If already cached, update it
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentMemory -= existing.sizeBytes;
      existing.bitmap.close();
    }

    const sizeBytes = this.estimateBitmapSize(bitmap);

    // Evict if needed
    this.evict(sizeBytes);

    // Store the frame
    this.cache.set(key, {
      time,
      bitmap,
      sizeBytes,
      lastAccess: Date.now(),
    });

    this.currentMemory += sizeBytes;
  }

  /**
   * Create an ImageBitmap from a canvas and cache it
   */
  async cacheFromCanvas(time: number, canvas: HTMLCanvasElement): Promise<void> {
    try {
      const bitmap = await createImageBitmap(canvas);
      this.set(time, bitmap);
    } catch (error) {
      console.warn('Failed to cache frame:', error);
    }
  }

  /**
   * Invalidate all cached frames (e.g., when timeline changes)
   */
  clear(): void {
    for (const frame of this.cache.values()) {
      frame.bitmap.close();
    }
    this.cache.clear();
    this.currentMemory = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Invalidate frames within a time range
   */
  invalidateRange(startTime: number, endTime: number): void {
    const startFrame = Math.floor(startTime * this.frameRate);
    const endFrame = Math.ceil(endTime * this.frameRate);

    for (let frame = startFrame; frame <= endFrame; frame++) {
      const key = `f${frame}`;
      const cached = this.cache.get(key);
      if (cached) {
        this.currentMemory -= cached.sizeBytes;
        cached.bitmap.close();
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): FrameCacheStats {
    const total = this.hits + this.misses;
    return {
      frameCount: this.cache.size,
      memoryBytes: this.currentMemory,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Get list of cached time ranges (for visualization)
   */
  getCachedRanges(): Array<{ start: number; end: number }> {
    const frames = [...this.cache.values()]
      .map(f => Math.floor(f.time * this.frameRate))
      .sort((a, b) => a - b);

    if (frames.length === 0) return [];

    const ranges: Array<{ start: number; end: number }> = [];
    let rangeStart = frames[0];
    let rangeEnd = frames[0];

    for (let i = 1; i < frames.length; i++) {
      if (frames[i] === rangeEnd + 1) {
        rangeEnd = frames[i];
      } else {
        ranges.push({
          start: rangeStart / this.frameRate,
          end: (rangeEnd + 1) / this.frameRate,
        });
        rangeStart = frames[i];
        rangeEnd = frames[i];
      }
    }

    ranges.push({
      start: rangeStart / this.frameRate,
      end: (rangeEnd + 1) / this.frameRate,
    });

    return ranges;
  }

  /**
   * Preload frames in a range (async)
   */
  async preload(
    startTime: number,
    endTime: number,
    renderFrame: (time: number) => Promise<HTMLCanvasElement | null>,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const startFrame = Math.floor(startTime * this.frameRate);
    const endFrame = Math.ceil(endTime * this.frameRate);
    const totalFrames = endFrame - startFrame + 1;

    for (let frame = startFrame; frame <= endFrame; frame++) {
      const time = frame / this.frameRate;

      // Skip if already cached
      if (this.has(time)) {
        onProgress?.((frame - startFrame + 1) / totalFrames);
        continue;
      }

      // Render and cache
      const canvas = await renderFrame(time);
      if (canvas) {
        await this.cacheFromCanvas(time, canvas);
      }

      onProgress?.((frame - startFrame + 1) / totalFrames);

      // Yield to main thread periodically
      if ((frame - startFrame) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
}

/**
 * Global frame cache instance (singleton)
 */
let globalCache: FrameCache | null = null;

export function getFrameCache(): FrameCache {
  if (!globalCache) {
    globalCache = new FrameCache();
  }
  return globalCache;
}

export function resetFrameCache(): void {
  if (globalCache) {
    globalCache.clear();
    globalCache = null;
  }
}
