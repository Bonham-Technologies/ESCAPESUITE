import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttle, debounce, throttleRAF } from './throttle';

describe('throttle utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('throttle', () => {
    it('calls function immediately on first call', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('arg1');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('throttles subsequent calls within interval', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      throttled('call2');
      throttled('call3');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call1');
    });

    it('calls with latest args after interval (trailing)', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      throttled('call2');
      throttled('call3');

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('call3');
    });

    it('allows calls after interval has passed', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      vi.advanceTimersByTime(100);
      throttled('call2');

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('call2');
    });

    it('cancel prevents pending calls', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      throttled('call2');
      throttled.cancel();

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call1');
    });

    it('flush immediately executes pending call', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      throttled('call2');
      throttled.flush();

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('call2');
    });
  });

  describe('debounce', () => {
    it('delays function call until after wait period', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('arg1');

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('resets timer on subsequent calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('call1');
      vi.advanceTimersByTime(50);
      debounced('call2');
      vi.advanceTimersByTime(50);
      debounced('call3');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call3');
    });

    it('cancel prevents pending call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('call1');
      debounced.cancel();

      vi.advanceTimersByTime(100);

      expect(fn).not.toHaveBeenCalled();
    });

    it('flush immediately executes pending call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('call1');
      debounced.flush();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call1');
    });
  });

  describe('throttleRAF', () => {
    let rafCallbacks: FrameRequestCallback[] = [];
    let rafId = 0;

    beforeEach(() => {
      rafCallbacks = [];
      rafId = 0;

      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return ++rafId;
      });

      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        // Find and remove callback by index (id - 1)
        const index = id - 1;
        if (index >= 0 && index < rafCallbacks.length) {
          rafCallbacks[index] = () => {}; // Replace with no-op
        }
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const flushRAF = () => {
      const callbacks = [...rafCallbacks];
      rafCallbacks = [];
      callbacks.forEach(cb => cb(performance.now()));
    };

    it('schedules function call via requestAnimationFrame', () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled('arg1');

      expect(fn).not.toHaveBeenCalled();
      expect(rafCallbacks.length).toBe(1);

      flushRAF();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('coalesces multiple calls into one RAF callback', () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled('call1');
      throttled('call2');
      throttled('call3');

      expect(rafCallbacks.length).toBe(1);

      flushRAF();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call3');
    });

    it('allows new calls after RAF fires', () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled('call1');
      flushRAF();
      throttled('call2');
      flushRAF();

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenNthCalledWith(1, 'call1');
      expect(fn).toHaveBeenNthCalledWith(2, 'call2');
    });

    it('cancel prevents pending RAF callback', () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled('call1');
      throttled.cancel();

      flushRAF();

      expect(fn).not.toHaveBeenCalled();
    });
  });
});
