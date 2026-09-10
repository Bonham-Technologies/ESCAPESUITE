import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scheduleExport,
  processFramesInChunks,
  createYieldingFrameIterator,
  AdaptiveYieldScheduler,
} from './exportScheduler';

describe('exportScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleExport', () => {
    it('processes all units until completion', async () => {
      let unitsProcessed = 0;
      const totalUnits = 10;

      const task = {
        process: vi.fn(async () => {
          unitsProcessed++;
          return unitsProcessed < totalUnits;
        }),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onProgress: vi.fn(),
        totalUnits,
      };

      const { promise } = scheduleExport(task, { useIdleCallback: false });

      // Process all tasks
      await vi.runAllTimersAsync();
      await promise;

      expect(task.process).toHaveBeenCalledTimes(10);
      expect(task.onComplete).toHaveBeenCalledTimes(1);
      expect(task.onError).not.toHaveBeenCalled();
    });

    it('can be cancelled', async () => {
      let unitsProcessed = 0;

      const task = {
        process: vi.fn(async () => {
          unitsProcessed++;
          return true; // Always more work
        }),
        onComplete: vi.fn(),
        onError: vi.fn(),
        totalUnits: 100,
      };

      const { cancel, isCancelled } = scheduleExport(task, {
        useIdleCallback: false,
        yieldEveryN: 2,
      });

      expect(isCancelled()).toBe(false);

      // Process a few units
      await vi.advanceTimersByTimeAsync(10);

      // Cancel
      cancel();
      expect(isCancelled()).toBe(true);

      // Should stop processing
      const processedBefore = unitsProcessed;
      await vi.advanceTimersByTimeAsync(100);

      // May have processed one more due to async nature
      expect(unitsProcessed).toBeLessThanOrEqual(processedBefore + 1);
    });

    it('reports progress', async () => {
      let unitsProcessed = 0;
      const totalUnits = 5;

      const progressValues: number[] = [];

      const task = {
        process: vi.fn(async () => {
          unitsProcessed++;
          return unitsProcessed < totalUnits;
        }),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onProgress: vi.fn((p: number) => progressValues.push(p)),
        totalUnits,
      };

      const { promise } = scheduleExport(task, {
        useIdleCallback: false,
        yieldEveryN: 1, // Yield after each to allow progress updates
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(task.onProgress).toHaveBeenCalled();
      // Final progress should be 100
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });

    it('handles errors', async () => {
      const error = new Error('Test error');

      const task = {
        process: vi.fn(async () => {
          throw error;
        }),
        onComplete: vi.fn(),
        onError: vi.fn(),
        totalUnits: 10,
      };

      const { promise } = scheduleExport(task, { useIdleCallback: false });

      await vi.runAllTimersAsync();
      await promise;

      expect(task.onError).toHaveBeenCalledWith(error);
      expect(task.onComplete).not.toHaveBeenCalled();
    });
  });

  describe('scheduleExport yield strategy', () => {
    it('yields through requestIdleCallback when the browser offers one', async () => {
      // A browser runs the idle callback later, on its own schedule.
      const requestIdleCallback = vi.fn((cb: () => void) => {
        queueMicrotask(() => cb());
      });
      vi.stubGlobal('requestIdleCallback', requestIdleCallback);
      try {
        let remaining = 3;
        const onComplete = vi.fn();

        const scheduled = scheduleExport(
          {
            process: async () => --remaining > 0,
            onComplete,
            onError: vi.fn(),
            totalUnits: 3,
          },
          { yieldEveryN: 1 }
        );

        await scheduled.promise;

        expect(onComplete).toHaveBeenCalled();
        // Yielded through the idle callback rather than a timer.
        expect(requestIdleCallback).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('processFramesInChunks', () => {
    it('yields to the main thread every N frames', async () => {
      const frames = [1, 2, 3, 4];
      const processed: number[] = [];

      const done = processFramesInChunks(
        frames,
        async (frame) => {
          processed.push(frame);
        },
        undefined,
        { yieldEveryN: 2 }
      );

      // Let every pending microtask run: the loop still parks on a timer, so
      // it cannot have finished.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const beforeTimers = [...processed];

      await vi.runAllTimersAsync();
      await done;

      expect(beforeTimers.length).toBeLessThan(frames.length);
      expect(processed).toEqual([1, 2, 3, 4]);
    });

    it('processes all frames', async () => {
      const frames = [1, 2, 3, 4, 5];
      const processed: number[] = [];

      await processFramesInChunks(
        frames,
        async (frame) => {
          processed.push(frame);
        },
        undefined,
        { yieldEveryN: 10 } // Don't yield in test
      );

      expect(processed).toEqual([1, 2, 3, 4, 5]);
    });

    it('reports progress', async () => {
      const frames = [1, 2, 3, 4, 5];
      const progressValues: number[] = [];

      await processFramesInChunks(
        frames,
        async () => {},
        (p) => progressValues.push(p),
        { yieldEveryN: 10 }
      );

      expect(progressValues).toEqual([20, 40, 60, 80, 100]);
    });
  });

  describe('createYieldingFrameIterator', () => {
    it('yields all frames in range', async () => {
      const frames: number[] = [];

      for await (const frame of createYieldingFrameIterator(0, 4, 10)) {
        frames.push(frame);
      }

      expect(frames).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('createYieldingFrameIterator yielding', () => {
    it('parks on a timer every N frames', async () => {
      const frames: number[] = [];

      const consume = (async () => {
        for await (const frame of createYieldingFrameIterator(0, 3, 2)) {
          frames.push(frame);
        }
      })();

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const beforeTimers = [...frames];

      await vi.runAllTimersAsync();
      await consume;

      expect(beforeTimers.length).toBeLessThan(4);
      expect(frames).toEqual([0, 1, 2, 3]);
    });
  });

  describe('AdaptiveYieldScheduler', () => {
    it('keeps only the last 20 samples when adapting', async () => {
      const scheduler = new AdaptiveYieldScheduler(60, 5);

      // 25 slow samples, then 20 fast ones: the slow ones must have aged out.
      for (let i = 0; i < 25; i++) scheduler.recordProcessingTime(100);
      const afterSlow = scheduler.getYieldEveryN();
      for (let i = 0; i < 20; i++) scheduler.recordProcessingTime(1);

      // Smoothing halves the gap each time, so it settles at 2 rather than 1.
      expect(afterSlow).toBe(2);
      expect(scheduler.getYieldEveryN()).toBeGreaterThan(2);
    });

    it('yields only on multiples of the current interval', async () => {
      const scheduler = new AdaptiveYieldScheduler(60, 3);

      // 3 % 3 === 0, so this one parks on a timer.
      let yielded = false;
      const parked = scheduler.maybeYield(3).then(() => {
        yielded = true;
      });
      expect(yielded).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      await parked;
      expect(yielded).toBe(true);

      // 4 % 3 !== 0, so this resolves without waiting for a timer.
      await expect(scheduler.maybeYield(4)).resolves.toBeUndefined();
    });

    it('adjusts yield frequency based on processing time', () => {
      const scheduler = new AdaptiveYieldScheduler(60, 5);

      // Simulate fast processing (1ms per frame)
      for (let i = 0; i < 10; i++) {
        scheduler.recordProcessingTime(1);
      }

      // With 16ms budget and 1ms processing, should be able to do many frames
      expect(scheduler.getYieldEveryN()).toBeGreaterThan(5);
    });

    it('reduces yield frequency for slow processing', () => {
      const scheduler = new AdaptiveYieldScheduler(60, 10);

      // Simulate slow processing (10ms per frame)
      for (let i = 0; i < 10; i++) {
        scheduler.recordProcessingTime(10);
      }

      // With 16ms budget and 10ms processing, should reduce frequency
      expect(scheduler.getYieldEveryN()).toBeLessThanOrEqual(5);
    });

    it('never goes below 1', () => {
      const scheduler = new AdaptiveYieldScheduler(60, 5);

      // Simulate very slow processing
      for (let i = 0; i < 10; i++) {
        scheduler.recordProcessingTime(100);
      }

      expect(scheduler.getYieldEveryN()).toBeGreaterThanOrEqual(1);
    });
  });
});
