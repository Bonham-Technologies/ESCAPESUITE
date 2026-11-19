/**
 * Keep the screen awake while a long job runs (ESCSUITE-474).
 *
 * `holdScreenAwake()` asks the Screen Wake Lock API for a `screen` lock and
 * hands back a handle whose `release()` gives it up. It is best effort and
 * never throws: a browser without the API, or one that refuses the request,
 * leaves the job exactly as it was and `onChange` is never called with `true`.
 *
 * The browser drops the lock by itself whenever the page is hidden, so the
 * hold asks again when the page becomes visible while the job still runs.
 * `release()` is idempotent, removes every listener the hold added, and also
 * releases a lock whose request was still pending when it was called.
 */

export interface ScreenAwakeHold {
  /** Give the lock up and stop re-acquiring it. Safe to call any number of times. */
  release(): void;
}

export interface HoldScreenAwakeOptions {
  /** Releases the hold when it aborts (a cancelled job), so no caller has to remember. */
  signal?: AbortSignal;
  /** Called with `true` once a lock is actually held and `false` when it is not (any more). */
  onChange?: (held: boolean) => void;
}

export function holdScreenAwake(options: HoldScreenAwakeOptions = {}): ScreenAwakeHold {
  const { signal, onChange } = options;
  let released = false;
  let pending = false;
  let sentinel: WakeLockSentinel | null = null;
  let reported = false;

  const report = (held: boolean) => {
    if (reported === held) return;
    reported = held;
    try {
      onChange?.(held);
    } catch {
      // A listener's failure is not the job's.
    }
  };

  const dropSentinel = (target: WakeLockSentinel) => {
    target.removeEventListener('release', onSentinelReleased);
    try {
      void Promise.resolve(target.release()).catch(() => {});
    } catch {
      // Already released.
    }
  };

  // Fires when the browser takes the lock (the page was hidden) and on our own release().
  function onSentinelReleased() {
    sentinel?.removeEventListener('release', onSentinelReleased);
    sentinel = null;
    report(false);
  }

  const acquire = () => {
    if (released || pending || sentinel) return;
    // A hidden page is refused; the visibilitychange listener asks again on return.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const api = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined;
    if (!api || typeof api.request !== 'function') return;
    let request: Promise<WakeLockSentinel>;
    try {
      request = Promise.resolve(api.request('screen'));
    } catch {
      return;
    }
    pending = true;
    request.then(
      (granted) => {
        pending = false;
        if (released) {
          // The job ended while the request was in flight: do not leak the lock.
          dropSentinel(granted);
          return;
        }
        sentinel = granted;
        granted.addEventListener('release', onSentinelReleased);
        report(true);
      },
      () => {
        pending = false;
      },
    );
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') acquire();
  };

  const release = () => {
    if (released) return;
    released = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    signal?.removeEventListener('abort', release);
    const held = sentinel;
    sentinel = null;
    if (held) dropSentinel(held);
    report(false);
  };

  if (signal?.aborted) {
    released = true;
    return { release };
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  signal?.addEventListener('abort', release);
  acquire();
  return { release };
}
