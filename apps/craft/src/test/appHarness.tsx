// Shared setup for the ESCAPECRAFT App tests: a clean store, a rendered App,
// and the handful of jsdom gaps App walks into (media playback, anchor
// downloads, window.open).
import { act, render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import App from '../App'
import { useRecorderStore } from '../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../store/types'
import { allCapabilities, allDetailedCapabilities } from './appDoubles'
import { createStreamDouble, createTrackDouble, type TrackDouble } from './doubles/mediastream'

// Held before any test installs fake timers, so flush() always yields on a
// real macrotask even when setInterval is faked for the countdown tests.
const nativeSetTimeout = globalThis.setTimeout

/** Let pending promise chains (IndexedDB included) settle inside act(). */
export async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise(resolve => nativeSetTimeout(resolve, 0))
    })
  }
}

/**
 * Reset the Zustand store to a freshly-loaded app with every capability
 * present — capability detection is a collaborator, so tests that care about a
 * missing capability say so explicitly.
 */
export function resetRecorderStore(config: Partial<RecordingConfig> = {}): void {
  useRecorderStore.setState({
    state: 'idle',
    config: { ...defaultConfig, ...config },
    capabilities: allCapabilities(),
    detailedCapabilities: allDetailedCapabilities(),
    recordings: [],
    currentDuration: 0,
    countdownValue: 0,
    audioLevels: { microphone: 0, system: 0 },
    screenStream: null,
    webcamStream: null,
  })
}

export async function renderApp(): Promise<RenderResult> {
  const result = render(<App />)
  await flush()
  return result
}

// --- stream doubles ---------------------------------------------------------

export interface StreamWithTracks {
  stream: MediaStream
  video?: TrackDouble
  audio?: TrackDouble
}

export function screenStreamDouble(
  options: { withAudio?: boolean; width?: number; height?: number } = {}
): StreamWithTracks {
  const video = createTrackDouble('video', {
    id: 'screen-video',
    label: 'screen',
    settings: { width: options.width ?? 1920, height: options.height ?? 1080 },
  })
  const audio = options.withAudio
    ? createTrackDouble('audio', { id: 'screen-audio', label: 'system audio' })
    : undefined
  return {
    stream: createStreamDouble(audio ? [video, audio] : [video]),
    video,
    audio,
  }
}

export function webcamStreamDouble(): StreamWithTracks {
  const video = createTrackDouble('video', {
    id: 'webcam-video',
    label: 'webcam',
    settings: { width: 640, height: 480 },
  })
  return { stream: createStreamDouble([video]), video }
}

export function micStreamDouble(): StreamWithTracks {
  const audio = createTrackDouble('audio', { id: 'mic-audio', label: 'microphone' })
  return { stream: createStreamDouble([audio]), audio }
}

// --- jsdom gaps App walks into ---------------------------------------------

export interface DownloadAttempt {
  href: string
  download: string
}

export interface BrowserStubs {
  /** Every <a download> the app clicked. */
  readonly downloads: DownloadAttempt[]
  /** window.open spy — the header's "Open Editor" button. */
  readonly open: ReturnType<typeof vi.spyOn>
  restore(): void
}

/**
 * jsdom implements neither HTMLMediaElement playback, nor navigation from an
 * anchor click, nor window.open — each one logs a "Not implemented" error
 * instead. Stand them all up, recording what the app asked for.
 */
export function installBrowserStubs(): BrowserStubs {
  const downloads: DownloadAttempt[] = []

  const mediaDescriptors: Record<string, PropertyDescriptor | undefined> = {}
  for (const name of ['play', 'pause', 'load'] as const) {
    mediaDescriptors[name] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name)
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() })

  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })

  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

  return {
    downloads,
    open: openSpy,
    restore() {
      for (const [name, descriptor] of Object.entries(mediaDescriptors)) {
        if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, name, descriptor)
        else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[name]
      }
      clickSpy.mockRestore()
      openSpy.mockRestore()
    },
  }
}

// --- requestAnimationFrame ---------------------------------------------------
//
// The PiP compositor drives a self-rescheduling rAF loop. jsdom's real rAF
// would keep it running past the end of the test, so tests that go through PiP
// swap in a loop the test steps by hand.

const rafCallbacks = new Map<number, FrameRequestCallback>()
let nextRafHandle = 1
let originalRaf: typeof globalThis.requestAnimationFrame | null = null
let originalCancelRaf: typeof globalThis.cancelAnimationFrame | null = null

export function installRafDouble(): void {
  if (originalRaf) return
  originalRaf = globalThis.requestAnimationFrame
  originalCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const handle = nextRafHandle++
    rafCallbacks.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    rafCallbacks.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame
}

export function uninstallRafDouble(): void {
  if (!originalRaf || !originalCancelRaf) return
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  originalRaf = null
  originalCancelRaf = null
  rafCallbacks.clear()
}

/** Number of rAF callbacks still scheduled. */
export function pendingAnimationFrames(): number {
  return rafCallbacks.size
}

/** Run every currently-pending rAF callback exactly once. */
export function tickAnimationFrames(): void {
  const pending = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const cb of pending) cb(0)
}
