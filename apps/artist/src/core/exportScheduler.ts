/**
 * Export Scheduler - Chunks export work to maintain UI responsiveness
 *
 * Full Web Workers have limitations:
 * - Can't access video elements for decoding
 * - Some muxing libraries aren't worker-compatible
 * - Complexity of transferring frame data
 *
 * This scheduler provides similar benefits by:
 * - Chunking frame processing with yield points
 * - Using requestIdleCallback when available
 * - Providing cancellation support
 * - Batching progress updates
 */

export interface ExportTask<T> {
  /** Execute one unit of work, return true if more work remains */
  process: () => Promise<boolean>;
  /** Called on completion with the result */
  onComplete: (result: T) => void;
  /** Called on error */
  onError: (error: Error) => void;
  /** Called periodically with progress (0-100) */
  onProgress?: (progress: number) => void;
  /** Total units of work (for progress calculation) */
  totalUnits: number;
}

export interface ExportSchedulerOptions {
  /** Max time per chunk in ms (default: 16ms for 60fps) */
  chunkTimeMs?: number;
  /** Yield every N frames (default: 5) */
  yieldEveryN?: number;
  /** Use requestIdleCallback when available */
  useIdleCallback?: boolean;
}

export interface ScheduledExport {
  /** Promise that resolves when export completes */
  promise: Promise<void>;
  /** Cancel the export */
  cancel: () => void;
  /** Check if cancelled */
  isCancelled: () => boolean;
}

/**
 * Schedules export work in chunks to maintain UI responsiveness
 */
export function scheduleExport<T>(
  task: ExportTask<T>,
  options: ExportSchedulerOptions = {}
): ScheduledExport {
  const {
    chunkTimeMs = 16,
    yieldEveryN = 5,
    useIdleCallback = true,
  } = options;

  let cancelled = false;
  let completedUnits = 0;
  let lastProgressUpdate = 0;

  const cancel = () => {
    cancelled = true;
  };

  const isCancelled = () => cancelled;

  // Yield to main thread
  const yieldToMain = (): Promise<void> => {
    return new Promise(resolve => {
      if (useIdleCallback && 'requestIdleCallback' in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => void })
          .requestIdleCallback(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  };

  // Update progress (throttled)
  const updateProgress = () => {
    const now = Date.now();
    if (now - lastProgressUpdate > 100) { // Update at most every 100ms
      lastProgressUpdate = now;
      const progress = Math.min(100, (completedUnits / task.totalUnits) * 100);
      task.onProgress?.(progress);
    }
  };

  const promise = (async () => {
    try {
      let chunkStart = Date.now();
      let unitsInChunk = 0;

      while (!cancelled) {
        const hasMore = await task.process();
        completedUnits++;
        unitsInChunk++;
        updateProgress();

        if (!hasMore) {
          // Ensure final progress update
          task.onProgress?.(100);
          task.onComplete(undefined as T);
          return;
        }

        // Check if we should yield
        const elapsed = Date.now() - chunkStart;
        if (elapsed >= chunkTimeMs || unitsInChunk >= yieldEveryN) {
          await yieldToMain();
          chunkStart = Date.now();
          unitsInChunk = 0;
        }
      }

      // Cancelled
      throw new Error('Export cancelled');
    } catch (error) {
      task.onError(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { promise, cancel, isCancelled };
}

/**
 * Wrapper for processing frames in batches with progress tracking
 */
export async function processFramesInChunks<T>(
  frames: T[],
  processor: (frame: T, index: number) => Promise<void>,
  onProgress?: (progress: number) => void,
  options: { yieldEveryN?: number } = {}
): Promise<void> {
  const { yieldEveryN = 5 } = options;

  for (let i = 0; i < frames.length; i++) {
    await processor(frames[i], i);

    // Update progress
    if (onProgress) {
      onProgress(((i + 1) / frames.length) * 100);
    }

    // Yield every N frames
    if ((i + 1) % yieldEveryN === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

/**
 * Creates a frame iterator that yields to main thread periodically
 */
export async function* createYieldingFrameIterator(
  startFrame: number,
  endFrame: number,
  yieldEveryN: number = 5
): AsyncGenerator<number, void, unknown> {
  for (let frame = startFrame; frame <= endFrame; frame++) {
    yield frame;

    if ((frame - startFrame + 1) % yieldEveryN === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

/**
 * Utility to measure frame processing time and auto-adjust yield frequency
 */
export class AdaptiveYieldScheduler {
  private processingTimes: number[] = [];
  private targetFrameTime: number;
  private yieldEveryN: number;

  constructor(targetFps: number = 60, initialYieldEveryN: number = 5) {
    this.targetFrameTime = 1000 / targetFps;
    this.yieldEveryN = initialYieldEveryN;
  }

  recordProcessingTime(timeMs: number): void {
    this.processingTimes.push(timeMs);

    // Keep last 20 samples
    if (this.processingTimes.length > 20) {
      this.processingTimes.shift();
    }

    // Adjust yield frequency based on average processing time
    if (this.processingTimes.length >= 5) {
      const avgTime = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;

      // How many frames can we process in target frame time?
      const idealN = Math.max(1, Math.floor(this.targetFrameTime / avgTime));

      // Smooth adjustment
      this.yieldEveryN = Math.round((this.yieldEveryN + idealN) / 2);
    }
  }

  getYieldEveryN(): number {
    return this.yieldEveryN;
  }

  async maybeYield(frameCount: number): Promise<void> {
    if (frameCount % this.yieldEveryN === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
