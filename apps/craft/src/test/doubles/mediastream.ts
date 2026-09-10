// Doubles for MediaStreamTrack / MediaStream and for MediaStreamTrackProcessor.
//
// jsdom has no media capture at all. The track double is backed by a real
// EventTarget so code that registers an 'ended' listener can genuinely be
// driven by dispatching that event, rather than having the listener replaced
// by a vi.fn() that swallows it. The track processor double hands out a reader
// whose delivery the test controls frame by frame.
import { vi } from 'vitest'

export interface TrackDouble extends MediaStreamTrack {
  /** Fire the 'ended' event on this track, as the browser does when a user
   *  clicks "Stop sharing". */
  end(): void
  /** Listeners still attached — lets tests prove they were removed on cleanup. */
  listenerCount(type: string): number
}

export interface TrackDoubleOptions {
  id?: string
  label?: string
  settings?: MediaTrackSettings
}

export function createTrackDouble(
  kind: 'video' | 'audio',
  options: TrackDoubleOptions = {}
): TrackDouble {
  const target = new EventTarget()
  const listeners = new Map<string, number>()

  const track = {
    id: options.id ?? `${kind}-track`,
    kind,
    label: options.label ?? `${kind} track`,
    enabled: true,
    muted: false,
    readyState: 'live' as const,
    contentHint: '',
    getSettings: vi.fn(() => options.settings ?? ({ width: 1920, height: 1080 } as MediaTrackSettings)),
    getCapabilities: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    applyConstraints: vi.fn(async () => {}),
    clone: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, (listeners.get(type) ?? 0) + 1)
      target.addEventListener(type, listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, Math.max(0, (listeners.get(type) ?? 0) - 1))
      target.removeEventListener(type, listener)
    }),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    onended: null,
    onmute: null,
    onunmute: null,
    end() {
      target.dispatchEvent(new Event('ended'))
    },
    listenerCount(type: string) {
      return listeners.get(type) ?? 0
    },
  }

  return track as unknown as TrackDouble
}

export function createStreamDouble(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: 'stream-double',
    active: true,
    getTracks: vi.fn(() => tracks),
    getVideoTracks: vi.fn(() => tracks.filter(t => t.kind === 'video')),
    getAudioTracks: vi.fn(() => tracks.filter(t => t.kind === 'audio')),
    getTrackById: vi.fn((id: string) => tracks.find(t => t.id === id) ?? null),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream
}

// --- MediaStreamTrackProcessor ---------------------------------------------

export interface TrackProcessorControl {
  /** Tracks the processor was constructed for, oldest first. */
  readonly tracks: MediaStreamTrack[]
  /** Hand the next pending (or future) read() this frame. */
  pushFrame(frame: unknown): void
  /** End the stream: the next read() resolves { done: true }. */
  finish(): void
  /** Make the next read() reject, as a torn-down track does. */
  failNextRead(error: Error): void
  /** How many times the consumer called reader.cancel(). */
  cancelCalls(): number
  /** Resolve any read the consumer is currently blocked on (used by cancel). */
  readonly pendingReads: number
}

interface QueuedItem {
  type: 'frame' | 'done' | 'error'
  value?: unknown
  error?: Error
}

let control: TrackProcessorControl | null = null
let originalTrackProcessor: unknown
let installed = false

export function installTrackProcessorDouble(): TrackProcessorControl {
  const queue: QueuedItem[] = []
  const waiters: Array<(item: QueuedItem) => void> = []
  const tracks: MediaStreamTrack[] = []
  let cancels = 0

  const deliver = (item: QueuedItem) => {
    const waiter = waiters.shift()
    if (waiter) waiter(item)
    else queue.push(item)
  }

  const reader = {
    async read(): Promise<{ value?: unknown; done: boolean }> {
      const item = queue.shift() ?? (await new Promise<QueuedItem>(resolve => waiters.push(resolve)))
      if (item.type === 'error') throw item.error
      if (item.type === 'done') return { value: undefined, done: true }
      return { value: item.value, done: false }
    },
    async cancel(): Promise<void> {
      cancels++
      // A cancelled reader releases anything blocked on it.
      while (waiters.length > 0) waiters.shift()!({ type: 'done' })
    },
  }

  class MediaStreamTrackProcessorDouble {
    readonly readable = { getReader: () => reader }
    constructor(options: { track: MediaStreamTrack }) {
      tracks.push(options.track)
    }
  }

  const g = globalThis as unknown as Record<string, unknown>
  if (!installed) {
    originalTrackProcessor = g.MediaStreamTrackProcessor
    installed = true
  }
  g.MediaStreamTrackProcessor = MediaStreamTrackProcessorDouble

  control = {
    tracks,
    pushFrame(frame) {
      deliver({ type: 'frame', value: frame })
    },
    finish() {
      deliver({ type: 'done' })
    },
    failNextRead(error) {
      deliver({ type: 'error', error })
    },
    cancelCalls: () => cancels,
    get pendingReads() {
      return waiters.length
    },
  }
  return control
}

export function uninstallTrackProcessorDouble(): void {
  if (!installed) return
  const g = globalThis as unknown as Record<string, unknown>
  if (originalTrackProcessor === undefined) delete g.MediaStreamTrackProcessor
  else g.MediaStreamTrackProcessor = originalTrackProcessor
  installed = false
  control = null
}

export function trackProcessorControl(): TrackProcessorControl {
  if (!control) throw new Error('MediaStreamTrackProcessor double is not installed')
  return control
}
