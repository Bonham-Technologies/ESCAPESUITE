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

// ---------------------------------------------------------------------------
// Scripted worker for `?worker` module mocks
//
// Vite's `import Worker from './x?worker'` gives back a constructor, not the
// global Worker, so `installWorkerDouble` cannot reach it — the module has to
// be replaced instead:
//
//   vi.mock('../workers/exportWorker?worker', async () => {
//     const { createScriptedWorkerModule } = await import('../test/doubles/worker')
//     return createScriptedWorkerModule()
//   })
//
// The double records every message posted into it and answers according to
// `scriptedWorkerState.respond`, so a test can drive the whole request/response
// conversation — including a worker that reports an error, one that never
// answers, and one whose constructor throws.
// ---------------------------------------------------------------------------

export interface PostedMessage {
  message: unknown
  options: unknown
}

export interface ScriptedWorkerInstance {
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message: string }) => void) | null
  /** Deliver a message from the "worker" to whoever is listening. */
  reply(data: unknown): void
  /** Deliver an error event from the "worker". */
  fail(message: string): void
}

export interface ScriptedWorkerState {
  /** Every worker the code under test constructed, in order. */
  readonly instances: ScriptedWorkerInstance[]
  /** Every message posted into any of them, in order. */
  readonly posted: PostedMessage[]
  /** How many workers were terminate()d — a leak here leaks a real thread. */
  terminated: number
  /** Throw from the constructor, the way a blocking CSP does. */
  constructorError: Error | null
  /**
   * Answer a posted message. The default answers the export worker's protocol:
   * INIT → INIT_COMPLETE, EXTRACT_AUDIO → one progress tick then AUDIO_READY.
   * Replies are delivered in a microtask, as a real worker's are.
   */
  respond: (message: unknown, worker: ScriptedWorkerInstance) => void
  /** What the default responder hands back for EXTRACT_AUDIO. */
  audio: { buffer: Float32Array; hasAudio: boolean }
}

function defaultRespond(message: unknown, worker: ScriptedWorkerInstance): void {
  const type = (message as { type?: string } | null)?.type
  if (type === 'INIT') {
    worker.reply({ type: 'INIT_COMPLETE' })
  } else if (type === 'EXTRACT_AUDIO') {
    worker.reply({ type: 'AUDIO_PROGRESS', progress: 50 })
    worker.reply({
      type: 'AUDIO_READY',
      audioBuffer: scriptedWorkerState.audio.buffer,
      hasAudio: scriptedWorkerState.audio.hasAudio,
    })
  }
}

export const scriptedWorkerState: ScriptedWorkerState = {
  instances: [],
  posted: [],
  terminated: 0,
  constructorError: null,
  respond: defaultRespond,
  audio: { buffer: new Float32Array(8), hasAudio: true },
}

export function resetScriptedWorker(): void {
  scriptedWorkerState.instances.length = 0
  scriptedWorkerState.posted.length = 0
  scriptedWorkerState.terminated = 0
  scriptedWorkerState.constructorError = null
  scriptedWorkerState.respond = defaultRespond
  scriptedWorkerState.audio = { buffer: new Float32Array(8), hasAudio: true }
}

/** The module shape to hand back from a vi.mock('…?worker', …) factory. */
export function createScriptedWorkerModule() {
  class ScriptedWorker implements ScriptedWorkerInstance {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null

    constructor() {
      if (scriptedWorkerState.constructorError) throw scriptedWorkerState.constructorError
      scriptedWorkerState.instances.push(this)
    }

    postMessage = vi.fn((message: unknown, options?: unknown) => {
      scriptedWorkerState.posted.push({ message, options })
      queueMicrotask(() => scriptedWorkerState.respond(message, this))
    })

    terminate = vi.fn(() => {
      scriptedWorkerState.terminated += 1
    })

    reply(data: unknown): void {
      this.onmessage?.({ data })
    }

    fail(message: string): void {
      this.onerror?.({ message })
    }
  }

  return { default: ScriptedWorker }
}
