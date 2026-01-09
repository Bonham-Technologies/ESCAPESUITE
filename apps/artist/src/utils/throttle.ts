/**
 * Throttle and debounce utilities for performance optimization.
 * Used to reduce the frequency of expensive operations during drag/resize.
 */

/**
 * Creates a throttled function that only invokes the provided function
 * at most once per animation frame using requestAnimationFrame.
 *
 * @param fn - The function to throttle
 * @returns A throttled version of the function
 */
export function throttleRAF<T extends (...args: unknown[]) => void>(
  fn: T
): T & { cancel: () => void } {
  let frameId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    lastArgs = args;

    if (frameId === null) {
      frameId = requestAnimationFrame(() => {
        if (lastArgs) {
          fn(...lastArgs);
        }
        frameId = null;
      });
    }
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  return throttled;
}

/**
 * Creates a throttled function that invokes at most once per specified interval.
 * Uses a trailing edge - the function is called after the interval with the latest args.
 *
 * @param fn - The function to throttle
 * @param interval - Minimum time between invocations in milliseconds
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number
): T & { cancel: () => void; flush: () => void } {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    lastArgs = args;

    const remaining = interval - (now - lastCall);

    if (remaining <= 0) {
      // Enough time has passed, call immediately
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      // Schedule a trailing call
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      }, remaining);
    }
  }) as T & { cancel: () => void; flush: () => void };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  throttled.flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastCall = Date.now();
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return throttled;
}

/**
 * Creates a debounced function that delays invoking until after the specified
 * wait time has elapsed since the last call.
 *
 * @param fn - The function to debounce
 * @param wait - The delay in milliseconds
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
    }, wait);
  }) as T & { cancel: () => void; flush: () => void };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      timeoutId = null;
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return debounced;
}
