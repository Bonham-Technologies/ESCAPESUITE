// Test double for <video> elements created by code under test.
//
// jsdom implements HTMLVideoElement but leaves media loading/playback
// unimplemented (play()/pause()/load() log "not implemented" warnings, and
// videoWidth/videoHeight/duration/readyState never change on their own).
// This double intercepts document.createElement('video') so tests can reach
// the exact element the code under test created, then override its metadata
// and fire the events (loadeddata/error/seeked) the code listens for.
import { vi } from 'vitest'

/** Metadata fields a test can force onto the element. */
export interface VideoMetadataOverrides {
  videoWidth: number
  videoHeight: number
  duration: number
  readyState: number
  currentTime: number
  paused: boolean
  ended: boolean
}

export interface VideoFrameCallbackMetadataLike {
  presentationTime: number
  expectedDisplayTime: number
  width: number
  height: number
  mediaTime: number
  presentedFrames: number
}

export interface VideoElementDouble {
  readonly element: HTMLVideoElement
  /** vi.fn() standing in for HTMLMediaElement.play(). */
  readonly play: ReturnType<typeof vi.fn>
  /** vi.fn() standing in for HTMLMediaElement.pause(). */
  readonly pause: ReturnType<typeof vi.fn>
  setMetadata(overrides: Partial<VideoMetadataOverrides>): void
  fireLoadedData(): void
  fireLoadedMetadata(): void
  fireSeeked(): void
  fireError(): void
  fireEnded(): void
  /**
   * Give the element a requestVideoFrameCallback()/cancelVideoFrameCallback()
   * pair, which jsdom lacks. Code that feature-detects rVFC then takes that
   * branch, and the test drives it with presentFrame().
   */
  enableRequestVideoFrameCallback(): void
  /**
   * Invoke the pending rVFC callback with the given mediaTime, as the browser
   * would when a new frame is presented. Also advances currentTime to match.
   * Returns false when no callback is pending.
   */
  presentFrame(mediaTime: number): boolean
  /** Handles passed to cancelVideoFrameCallback(), in order. */
  readonly cancelledFrameCallbacks: number[]
  /** True while an rVFC callback is registered and not yet fired/cancelled. */
  hasPendingFrameCallback(): boolean
}

function defineOn(video: HTMLVideoElement, prop: string, value: unknown): void {
  Object.defineProperty(video, prop, { value, configurable: true, writable: true })
}

function wrap(video: HTMLVideoElement): VideoElementDouble {
  // Silence jsdom's "not implemented" console noise for media methods the
  // code under test may call; behave as inert no-ops instead.
  const play = vi.fn().mockResolvedValue(undefined)
  const pause = vi.fn()
  video.play = play as unknown as typeof video.play
  video.pause = pause as unknown as typeof video.pause
  video.load = vi.fn() as unknown as typeof video.load

  // jsdom's currentTime/paused/ended are accessors backed by an unimplemented
  // media element; make them plain writable own properties so assignments from
  // the code under test stick and tests can script playback progress.
  defineOn(video, 'currentTime', 0)
  defineOn(video, 'paused', false)
  defineOn(video, 'ended', false)

  let pendingCallback: ((now: number, metadata: VideoFrameCallbackMetadataLike) => void) | null = null
  let nextHandle = 1
  let pendingHandle = 0
  let presentedFrames = 0
  const cancelledFrameCallbacks: number[] = []

  return {
    element: video,
    play,
    pause,
    cancelledFrameCallbacks,
    setMetadata(overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) defineOn(video, key, value)
      }
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
    fireEnded() {
      defineOn(video, 'ended', true)
      video.dispatchEvent(new Event('ended'))
    },
    enableRequestVideoFrameCallback() {
      defineOn(video, 'requestVideoFrameCallback', (
        cb: (now: number, metadata: VideoFrameCallbackMetadataLike) => void
      ) => {
        pendingCallback = cb
        pendingHandle = nextHandle++
        return pendingHandle
      })
      defineOn(video, 'cancelVideoFrameCallback', (handle: number) => {
        cancelledFrameCallbacks.push(handle)
        if (handle === pendingHandle) pendingCallback = null
      })
    },
    presentFrame(mediaTime) {
      const cb = pendingCallback
      if (!cb) return false
      pendingCallback = null
      defineOn(video, 'currentTime', mediaTime)
      presentedFrames += 1
      cb(mediaTime * 1000, {
        presentationTime: mediaTime * 1000,
        expectedDisplayTime: mediaTime * 1000,
        width: video.videoWidth,
        height: video.videoHeight,
        mediaTime,
        presentedFrames,
      })
      return true
    },
    hasPendingFrameCallback() {
      return pendingCallback !== null
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

/** Every <video> element double created since install, oldest first. */
export function getVideoDoubles(): VideoElementDouble[] {
  return capturedVideos
}

export function resetVideoElementDouble(): void {
  capturedVideos = []
}

// --- MediaError -------------------------------------------------------------
//
// jsdom ships no MediaError interface at all, so code that compares
// `video.error.code` against `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED` throws a
// ReferenceError there even though it is fine in every browser. Install the
// constant table for the duration of a test that drives media errors.

const MEDIA_ERROR_CODES = {
  MEDIA_ERR_ABORTED: 1,
  MEDIA_ERR_NETWORK: 2,
  MEDIA_ERR_DECODE: 3,
  MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
} as const

let mediaErrorInstalled = false

export function installMediaErrorGlobal(): void {
  if (mediaErrorInstalled) return
  mediaErrorInstalled = true
  ;(globalThis as unknown as Record<string, unknown>).MediaError = MEDIA_ERROR_CODES
}

export function uninstallMediaErrorGlobal(): void {
  if (!mediaErrorInstalled) return
  mediaErrorInstalled = false
  delete (globalThis as unknown as Record<string, unknown>).MediaError
}

/** Build a MediaError-shaped object to hand to a <video> element's `error`. */
export function mediaError(
  code: keyof typeof MEDIA_ERROR_CODES,
  message = code
): { code: number; message: string } {
  return { code: MEDIA_ERROR_CODES[code], message }
}
