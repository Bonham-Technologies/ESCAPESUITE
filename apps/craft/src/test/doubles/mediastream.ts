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

interface QueuedItem {
  type: 'frame' | 'done' | 'error'
  value?: unknown
  error?: Error
}

/** One processor's own queue, reader and waiters. */
interface ProcessorLane {
  track: MediaStreamTrack
  queue: QueuedItem[]
  waiters: Array<(item: QueuedItem) => void>
  reader: { read(): Promise<{ value?: unknown; done: boolean }>; cancel(): Promise<void> }
  cancels: number
}

export interface TrackProcessorControl {
  /** Tracks the processor was constructed for, oldest first. */
  readonly tracks: MediaStreamTrack[]
  /** Hand the next pending (or future) read() on the FIRST processor this frame. */
  pushFrame(frame: unknown): void
  /** The same, addressed to the processor built for the track with this id. */
  pushFrameTo(trackId: string, frame: unknown): void
  /** End every processor's stream: the next read() resolves { done: true }. */
  finish(): void
  /** End one processor's stream, as a single capture track dying does. */
  finishTrack(trackId: string): void
  /** Make the next read() on the first processor reject, as a torn-down track does. */
  failNextRead(error: Error): void
  /** How many times consumers called reader.cancel(), across every processor. */
  cancelCalls(): number
  /** Reads currently blocked, across every processor. */
  readonly pendingReads: number
}

let control: TrackProcessorControl | null = null
let originalTrackProcessor: unknown
let installed = false

export function installTrackProcessorDouble(): TrackProcessorControl {
  // A lane per constructed processor rather than one shared queue: a
  // separate-tracks take builds two processors and reads them in two loops, so
  // a shared queue would hand the screen's frame to whichever loop happened to
  // be waiting. With one processor this behaves exactly as it did before.
  const lanes: ProcessorLane[] = []

  const deliver = (lane: ProcessorLane, item: QueuedItem) => {
    const waiter = lane.waiters.shift()
    if (waiter) waiter(item)
    else lane.queue.push(item)
  }

  const laneFor = (trackId: string): ProcessorLane => {
    const lane = lanes.find(l => l.track.id === trackId)
    if (!lane) throw new Error(`No MediaStreamTrackProcessor was built for track '${trackId}'`)
    return lane
  }

  const firstLane = (): ProcessorLane => {
    const lane = lanes[0]
    if (!lane) throw new Error('No MediaStreamTrackProcessor has been constructed')
    return lane
  }

  class MediaStreamTrackProcessorDouble {
    readonly readable: { getReader: () => ProcessorLane['reader'] }

    constructor(options: { track: MediaStreamTrack }) {
      const lane: ProcessorLane = {
        track: options.track,
        queue: [],
        waiters: [],
        cancels: 0,
        reader: {
          async read(): Promise<{ value?: unknown; done: boolean }> {
            const item =
              lane.queue.shift() ??
              (await new Promise<QueuedItem>(resolve => lane.waiters.push(resolve)))
            if (item.type === 'error') throw item.error
            if (item.type === 'done') return { value: undefined, done: true }
            return { value: item.value, done: false }
          },
          async cancel(): Promise<void> {
            lane.cancels++
            // A cancelled reader releases anything blocked on it.
            while (lane.waiters.length > 0) lane.waiters.shift()!({ type: 'done' })
          },
        },
      }
      lanes.push(lane)
      this.readable = { getReader: () => lane.reader }
    }
  }

  const g = globalThis as unknown as Record<string, unknown>
  if (!installed) {
    originalTrackProcessor = g.MediaStreamTrackProcessor
    installed = true
  }
  g.MediaStreamTrackProcessor = MediaStreamTrackProcessorDouble

  control = {
    get tracks() {
      return lanes.map(lane => lane.track)
    },
    pushFrame(frame) {
      deliver(firstLane(), { type: 'frame', value: frame })
    },
    pushFrameTo(trackId, frame) {
      deliver(laneFor(trackId), { type: 'frame', value: frame })
    },
    finish() {
      for (const lane of lanes) deliver(lane, { type: 'done' })
    },
    finishTrack(trackId) {
      deliver(laneFor(trackId), { type: 'done' })
    },
    failNextRead(error) {
      deliver(firstLane(), { type: 'error', error })
    },
    cancelCalls: () => lanes.reduce((total, lane) => total + lane.cancels, 0),
    get pendingReads() {
      return lanes.reduce((total, lane) => total + lane.waiters.length, 0)
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
