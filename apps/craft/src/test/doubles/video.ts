// Test double for <video> elements created by code under test.
//
// jsdom implements HTMLVideoElement but leaves media loading/playback
// unimplemented (play()/pause()/load() log "not implemented" warnings, and
// videoWidth/videoHeight/duration/readyState never change on their own).
// This double intercepts document.createElement('video') so tests can reach
// the exact element the code under test created, then override its metadata
// and fire the events (loadeddata/error/seeked) the code listens for.
import { vi } from 'vitest'

export interface VideoElementDouble {
  readonly element: HTMLVideoElement
  setMetadata(overrides: Partial<{
    videoWidth: number
    videoHeight: number
    duration: number
    readyState: number
    currentTime: number
  }>): void
  fireLoadedData(): void
  fireLoadedMetadata(): void
  fireSeeked(): void
  fireError(): void
}

function defineOn(video: HTMLVideoElement, prop: string, value: unknown): void {
  Object.defineProperty(video, prop, { value, configurable: true, writable: true })
}

function wrap(video: HTMLVideoElement): VideoElementDouble {
  // Silence jsdom's "not implemented" console noise for media methods the
  // code under test may call; behave as inert no-ops instead.
  video.play = vi.fn().mockResolvedValue(undefined) as unknown as typeof video.play
  video.pause = vi.fn() as unknown as typeof video.pause
  video.load = vi.fn() as unknown as typeof video.load

  return {
    element: video,
    setMetadata(overrides) {
      if (overrides.videoWidth !== undefined) defineOn(video, 'videoWidth', overrides.videoWidth)
      if (overrides.videoHeight !== undefined) defineOn(video, 'videoHeight', overrides.videoHeight)
      if (overrides.duration !== undefined) defineOn(video, 'duration', overrides.duration)
      if (overrides.readyState !== undefined) defineOn(video, 'readyState', overrides.readyState)
      if (overrides.currentTime !== undefined) defineOn(video, 'currentTime', overrides.currentTime)
    },
    fireLoadedData() {
      video.dispatchEvent(new Event('loadeddata'))
    },
    fireLoadedMetadata() {
      video.dispatchEvent(new Event('loadedmetadata'))
    },
    fireSeeked() {
      video.dispatchEvent(new Event('seeked'))
    },
    fireError() {
      video.dispatchEvent(new Event('error'))
    },
  }
}

let capturedVideos: VideoElementDouble[] = []
let originalCreateElement: Document['createElement'] | null = null

/**
 * Intercept document.createElement('video') so every <video> the code under
 * test creates is wrapped and tracked. Scope this to the tests that need it
 * (install in beforeEach, uninstall in afterEach) — it is not installed
 * globally in setup.ts.
 */
export function installVideoElementDouble(): void {
  if (originalCreateElement) return
  originalCreateElement = document.createElement.bind(document)
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const el = originalCreateElement!(tagName, options)
    if (tagName.toLowerCase() === 'video') {
      capturedVideos.push(wrap(el as HTMLVideoElement))
    }
    return el
  }) as Document['createElement']
}

export function uninstallVideoElementDouble(): void {
  if (originalCreateElement) {
    document.createElement = originalCreateElement
    originalCreateElement = null
  }
  capturedVideos = []
}

/** The most recently created <video> element double. */
export function getLastVideoDouble(): VideoElementDouble | undefined {
  return capturedVideos[capturedVideos.length - 1]
}

export function resetVideoElementDouble(): void {
  capturedVideos = []
}
