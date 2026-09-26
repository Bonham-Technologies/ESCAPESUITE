// A hand-driven requestAnimationFrame.
//
// jsdom schedules rAF callbacks on a real ~16ms timer, which makes any loop
// that reschedules itself — the compositor's render loop, the converter's
// playback capture — both slow and non-deterministic under test: a frame can
// arrive after the test that started it has finished, against a torn-down
// environment.
//
// This double holds the pending callbacks and runs them only when a test says
// so, and its cancelAnimationFrame genuinely drops one, so a stopped loop is
// really stopped. Pair it with a `performance.now()` spy when the code under
// test throttles by wall clock.
//
// `src/test/appHarness.tsx` keeps its own module-level copy for the App tests:
// those drive PiP through the whole component tree and want one rAF for the
// file rather than one per test, so the two do not share an implementation.
//
// Lives under src/test/ so neither the vitest `include` glob (which would treat
// it as a suite containing no tests) nor the coverage `include` glob (which
// would score test scaffolding as production code) picks it up.

export interface RafDouble {
  /** Run every currently-pending callback once; returns how many ran. */
  tick(): number
  /** Callbacks scheduled and not yet run. */
  pending(): number
  /**
   * How many times requestAnimationFrame has been called since install —
   * pending, run and cancelled alike. `pending()` cannot tell "the loop was
   * never started" from "it was started and cancelled", and for a recorder
   * that has been disposed those are different bugs.
   */
  scheduled(): number
  uninstall(): void
}

/**
 * Install the double. Call in beforeEach and uninstall in afterEach — it
 * patches globals shared by the whole file.
 */
export function installRafDouble(): RafDouble {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextHandle = 1
  let scheduled = 0

  const originalRaf = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const handle = nextHandle++
    scheduled++
    callbacks.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame

  globalThis.cancelAnimationFrame = ((handle: number) => {
    callbacks.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame

  return {
    tick() {
      // Snapshot first: a callback that reschedules itself must not run twice
      // in one tick.
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const cb of pending) cb(0)
      return pending.length
    },
    pending: () => callbacks.size,
    scheduled: () => scheduled,
    uninstall() {
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
      callbacks.clear()
    },
  }
}
