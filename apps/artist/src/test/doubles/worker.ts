// Double for the Web Worker constructor used by the worker-support probe.
//
// jsdom has no Worker at all, so `canUseExportWorkerAsync()` short-circuits on
// the typeof check and the interesting paths — CSP blocking the construction,
// the worker answering, the worker reporting no OfflineAudioContext, the probe
// timing out — are unreachable. This double records the script URLs it was
// constructed with, replies with a scripted answer, and can be told to throw
// from the constructor the way a blocking CSP does.
import { vi } from 'vitest'

/** How the double behaves once the probe posts to it. */
export type WorkerBehaviour =
  | { kind: 'reply'; data: unknown }
  | { kind: 'error' }
  | { kind: 'silent' }
  | { kind: 'throwOnConstruct'; message?: string }

export interface WorkerDouble {
  /** Every script URL a Worker was constructed with, in order. */
  readonly urls: string[]
  /** How many workers were terminate()d. */
  readonly terminated: number
  /** Messages the probe posted into the worker, in order. */
  readonly posted: unknown[]
  behaviour: WorkerBehaviour
  uninstall(): void
}

const MISSING = Symbol('missing')

export function installWorkerDouble(behaviour: WorkerBehaviour): WorkerDouble {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'Worker' in g ? g.Worker : MISSING

  const state = {
    urls: [] as string[],
    terminated: 0,
    posted: [] as unknown[],
    behaviour,
  }

  class WorkerImpl {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    private answered = false

    constructor(url: string) {
      state.urls.push(String(url))
      if (state.behaviour.kind === 'throwOnConstruct') {
        throw new Error(state.behaviour.message ?? 'Refused to create a worker')
      }
      // A probe script may post as soon as it loads or only answer a message,
      // so schedule both triggers and let whichever comes first win — a worker
      // only answers a given probe once either way.
      queueMicrotask(() => this.respond())
    }

    postMessage = vi.fn((message: unknown) => {
      state.posted.push(message)
      queueMicrotask(() => this.respond())
    })

    terminate = vi.fn(() => {
      state.terminated += 1
    })

    private respond(): void {
      if (this.answered) return
      this.answered = true
      const b = state.behaviour
      if (b.kind === 'reply') this.onmessage?.({ data: b.data })
      else if (b.kind === 'error') this.onerror?.(new Event('error'))
    }
  }

  g.Worker = WorkerImpl

  return {
    get urls() {
      return state.urls
    },
    get terminated() {
      return state.terminated
    },
    get posted() {
      return state.posted
    },
    get behaviour() {
      return state.behaviour
    },
    set behaviour(next: WorkerBehaviour) {
      state.behaviour = next
    },
    uninstall() {
      if (previous === MISSING) delete g.Worker
      else g.Worker = previous
    },
  }
}
