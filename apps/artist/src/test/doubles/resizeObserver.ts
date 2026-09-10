// Recording double for ResizeObserver.
//
// jsdom does not implement ResizeObserver at all, so any code that observes an
// element's size cannot even be constructed against it. This double records
// what was observed and disconnected, and lets a test deliver a resize entry to
// the code under test the way the browser would.
import { vi } from 'vitest'

export interface ResizeObserverDouble {
  /** Every element passed to observe(), across all observers, in order. */
  readonly observed: Element[]
  /** How many observers were disconnect()ed. */
  readonly disconnected: number
  /** Deliver a resize to every live observer. */
  emit(target: Element, contentRect: { width: number; height: number }): void
  uninstall(): void
}

const MISSING = Symbol('missing')

export function installResizeObserverDouble(): ResizeObserverDouble {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'ResizeObserver' in g ? g.ResizeObserver : MISSING

  const state = {
    observed: [] as Element[],
    disconnected: 0,
    live: [] as Array<(entries: ResizeObserverEntry[]) => void>,
  }

  class ResizeObserverImpl {
    private callback: (entries: ResizeObserverEntry[]) => void

    constructor(callback: (entries: ResizeObserverEntry[]) => void) {
      this.callback = callback
      state.live.push(callback)
    }

    observe = vi.fn((target: Element) => {
      state.observed.push(target)
    })

    unobserve = vi.fn()

    disconnect = vi.fn(() => {
      state.disconnected += 1
      state.live = state.live.filter((cb) => cb !== this.callback)
    })
  }

  g.ResizeObserver = ResizeObserverImpl

  return {
    get observed() {
      return state.observed
    },
    get disconnected() {
      return state.disconnected
    },
    emit(target, contentRect) {
      const entry = { target, contentRect } as unknown as ResizeObserverEntry
      for (const callback of [...state.live]) callback([entry])
    },
    uninstall() {
      if (previous === MISSING) delete g.ResizeObserver
      else g.ResizeObserver = previous
    },
  }
}
