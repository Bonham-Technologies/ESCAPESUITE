// Shared setup for the ESCAPECRAFT App tests: a clean store, a rendered App,
// and the rAF loop the PiP compositor is stepped through by hand.
//
// The jsdom gaps App walks into (media playback, anchor downloads,
// window.open) live in `doubles/browser.ts` with the rest of the browser
// doubles, and are re-exported here because every App suite reaches for them
// through this module.
import { act, render, type RenderResult } from '@testing-library/react'
import App from '../App'
import { useRecorderStore } from '../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../store/types'
import { allCapabilities, allDetailedCapabilities } from './appDoubles'
import { createStreamDouble, createTrackDouble, type TrackDouble } from './doubles/mediastream'
import { installBrowserStubs } from './doubles/browser'

// Written as an import plus a plain re-export rather than `export … from`,
// because react-refresh cannot see through the latter and flags every other
// export in the file.
export { installBrowserStubs }
export type { BrowserStubs, DownloadAttempt } from './doubles/browser'

// Held before any test installs fake timers, so flush() always yields on a
// real macrotask even when setInterval is faked for the countdown tests.
const nativeSetTimeout = globalThis.setTimeout

/**
 * Let pending promise chains (IndexedDB included) settle inside act().
 *
 * flush() opens its own act() scope, one per round, so **never call it from
 * inside another act()**. React 19 only warns "the current testing environment
 * is not configured to support act(...)" once `IS_REACT_ACT_ENVIRONMENT` is
 * defined-and-false, and it is `undefined` — silent — until the first act()
 * runs. An outer act() sets it to `true`, and anything that then awaits
 * through testing-library's asyncWrapper (every `userEvent` call) flips it to
 * `false` for the length of that await. Any store update the app lands in that
 * window is reported, which is what `await act(async () => { await
 * user().click(...); await flush() })` used to produce under parallel load.
 *
 * The shape to use instead: wrap only the state-changing call — `act(() => {
 * window.dispatchEvent(...) })`, or nothing at all for a `userEvent` call,
 * which brings its own act() — and then `await flush()` on its own.
 */
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
    // The real store starts "not ready" and renderApp() settles the detection
    // that raises it, so a test that wants the pre-detection app leaves
    // detectCapabilities() pending rather than reaching in here.
    capabilitiesReady: false,
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
