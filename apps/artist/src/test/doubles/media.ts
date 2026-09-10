// Doubles for the <video>, <img> and <audio> elements the code under test
// creates with document.createElement().
//
// jsdom creates the elements but never loads anything: duration/videoWidth/
// naturalWidth stay 0 or NaN, no loadedmetadata/load/seeked/error event ever
// fires, and play()/pause()/load() log "not implemented". Metadata extraction
// and thumbnail generation therefore hang forever against bare jsdom.
//
// This double intercepts document.createElement for those three tags, gives the
// element the metadata the test scripts, and fires the real events (through
// dispatchEvent, so both `el.onload = …` and addEventListener callers are
// served) when the code assigns `src` — or, for a seek, when it assigns
// `currentTime`. Events fire in a microtask, matching a browser's asynchrony
// without needing timers.
import { vi } from 'vitest'

export interface VideoScript {
  videoWidth: number
  videoHeight: number
  duration: number
  readyState: number
  /** Fire 'error' instead of 'loadedmetadata'/'loadeddata' when src is set. */
  fail: boolean
  /** Don't fire 'seeked' when currentTime is assigned (models a stalled seek). */
  stallSeek: boolean
}

export interface ImageScript {
  naturalWidth: number
  naturalHeight: number
  fail: boolean
}

export interface AudioScript {
  duration: number
  fail: boolean
}

export interface MediaDoubleScript {
  video: Partial<VideoScript>
  image: Partial<ImageScript>
  audio: Partial<AudioScript>
}

export interface MediaDoubles {
  /** Every <video> the code under test created, oldest first. */
  readonly videos: HTMLVideoElement[]
  readonly images: HTMLImageElement[]
  readonly audios: HTMLAudioElement[]
  /** Every value assigned to a `src` of any of them, in order. */
  readonly srcAssignments: string[]
  /** currentTime values assigned to videos, in order — i.e. the seeks requested. */
  readonly seeks: number[]
  /** Change what subsequently created elements report. */
  script(next: Partial<MediaDoubleScript>): void
  uninstall(): void
}

const VIDEO_DEFAULTS: VideoScript = {
  videoWidth: 1920,
  videoHeight: 1080,
  duration: 10,
  readyState: 4,
  fail: false,
  stallSeek: false,
}

const IMAGE_DEFAULTS: ImageScript = { naturalWidth: 800, naturalHeight: 600, fail: false }
const AUDIO_DEFAULTS: AudioScript = { duration: 180, fail: false }

function own(el: object, prop: string, value: unknown): void {
  Object.defineProperty(el, prop, { value, configurable: true, writable: true })
}

/**
 * Install the element doubles. Call in beforeEach and uninstall in afterEach.
 */
export function installMediaElementDoubles(initial: Partial<MediaDoubleScript> = {}): MediaDoubles {
  let video: VideoScript = { ...VIDEO_DEFAULTS, ...initial.video }
  let image: ImageScript = { ...IMAGE_DEFAULTS, ...initial.image }
  let audio: AudioScript = { ...AUDIO_DEFAULTS, ...initial.audio }

  const videos: HTMLVideoElement[] = []
  const images: HTMLImageElement[] = []
  const audios: HTMLAudioElement[] = []
  const srcAssignments: string[] = []
  const seeks: number[] = []

  const realCreateElement = document.createElement.bind(document)

  function defineSrc(el: HTMLElement, onAssigned: () => void): void {
    let value = ''
    Object.defineProperty(el, 'src', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next
        srcAssignments.push(next)
        queueMicrotask(onAssigned)
      },
    })
  }

  function makeVideo(): HTMLVideoElement {
    const el = realCreateElement('video') as HTMLVideoElement
    const s = { ...video }
    own(el, 'videoWidth', s.videoWidth)
    own(el, 'videoHeight', s.videoHeight)
    own(el, 'duration', s.duration)
    own(el, 'readyState', s.readyState)
    own(el, 'play', vi.fn().mockResolvedValue(undefined))
    own(el, 'pause', vi.fn())
    own(el, 'load', vi.fn())

    let currentTime = 0
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (next: number) => {
        currentTime = next
        seeks.push(next)
        if (!s.stallSeek) queueMicrotask(() => el.dispatchEvent(new Event('seeked')))
      },
    })

    defineSrc(el, () => {
      if (s.fail) {
        el.dispatchEvent(new Event('error'))
        return
      }
      el.dispatchEvent(new Event('loadedmetadata'))
      el.dispatchEvent(new Event('loadeddata'))
      el.dispatchEvent(new Event('canplay'))
    })

    videos.push(el)
    return el
  }

  function makeImage(): HTMLImageElement {
    const el = realCreateElement('img') as HTMLImageElement
    const s = { ...image }
    own(el, 'naturalWidth', s.naturalWidth)
    own(el, 'naturalHeight', s.naturalHeight)
    defineSrc(el, () => {
      el.dispatchEvent(new Event(s.fail ? 'error' : 'load'))
    })
    images.push(el)
    return el
  }

  function makeAudio(): HTMLAudioElement {
    const el = realCreateElement('audio') as HTMLAudioElement
    const s = { ...audio }
    own(el, 'duration', s.duration)
    own(el, 'play', vi.fn().mockResolvedValue(undefined))
    own(el, 'pause', vi.fn())
    own(el, 'load', vi.fn())
    defineSrc(el, () => {
      el.dispatchEvent(new Event(s.fail ? 'error' : 'loadedmetadata'))
    })
    audios.push(el)
    return el
  }

  const spy = vi
    .spyOn(document, 'createElement')
    .mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'video') return makeVideo()
      if (tagName === 'img') return makeImage()
      if (tagName === 'audio') return makeAudio()
      return realCreateElement(tagName, options)
    }) as typeof document.createElement)

  return {
    videos,
    images,
    audios,
    srcAssignments,
    seeks,
    script(next) {
      if (next.video) video = { ...video, ...next.video }
      if (next.image) image = { ...image, ...next.image }
      if (next.audio) audio = { ...audio, ...next.audio }
    },
    uninstall() {
      spy.mockRestore()
    },
  }
}
