import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ExportAbortedError,
  blendModeToCanvas,
  calculateTimelineDuration,
  checkAborted,
  clearSeekPositions,
  getActiveTransition,
  getBaseDimensions,
  getQualitySettings,
  getResolution,
  getSeekPositionsCount,
  getSourceDimensions,
  isMP4ExportSupported,
  isWebMExportSupported,
  loadImageElement,
  loadVideoElement,
  yieldToMain,
} from './exportTypes'
import type { Clip, Track, SourceVideo, TransitionType } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { installWebCodecsDoubles, removeWebCodecsGlobals, VideoFrameDouble } from '../test/doubles/webcodecs'

const track = (id: string, index: number, visible = true): Track =>
  ({ id, name: id, index, visible, locked: false, muted: false, volume: 1, height: 60 })
const clip = (id: string, sourceVideoId: string, trackId: string, extra: Partial<Clip> = {}): Clip =>
  ({ id, sourceVideoId, trackId, ...extra } as unknown as Clip)
const src = (id: string, width: number, height: number): SourceVideo =>
  ({ id, width, height } as unknown as SourceVideo)

/** A timeline clip positioned in time, with an optional outgoing transition. */
function timedClip(
  id: string,
  trackId: string,
  timelinePosition: number,
  duration: number,
  transition: { type: TransitionType; duration: number } = { type: 'none', duration: 0 },
  extra: Partial<Clip> = {}
): Clip {
  return clip(id, 'source', trackId, { timelinePosition, duration, transition, ...extra })
}

describe('getBaseDimensions', () => {
  it('uses the bottom-most media clip by track index, not clip order', () => {
    const tracks = [track('top', 2), track('bottom', 0)]
    const clips = [clip('c-top', 'hd', 'top'), clip('c-bottom', 'sd', 'bottom')]
    const sources = [src('hd', 1920, 1080), src('sd', 640, 360)]
    expect(getBaseDimensions(clips, tracks, sources)).toEqual({ width: 640, height: 360 })
  })

  it('skips overlay clips and sources without dimensions', () => {
    const tracks = [track('t0', 0), track('t1', 1)]
    const clips = [
      clip('text', '', 't0', { overlayType: 'text' }),
      clip('nodims', 'nodims', 't0'),
      clip('video', 'v', 't1'),
    ]
    const sources = [src('nodims', 0, 0), src('v', 1280, 720)]
    expect(getBaseDimensions(clips, tracks, sources)).toEqual({ width: 1280, height: 720 })
  })

  it('falls back to 1080p for overlay-only timelines', () => {
    expect(getBaseDimensions([clip('text', '', 't0', { overlayType: 'text' })], [track('t0', 0)], [])).toEqual({ width: 1920, height: 1080 })
  })

  it('treats a clip on an unknown track as index 0', () => {
    const tracks = [track('known', 5)]
    const clips = [clip('c-known', 'hd', 'known'), clip('c-orphan', 'sd', 'missing-track')]
    const sources = [src('hd', 1920, 1080), src('sd', 640, 360)]
    // The orphan sorts to index 0, below the known track, so its source wins.
    expect(getBaseDimensions(clips, tracks, sources)).toEqual({ width: 640, height: 360 })
  })
})

describe('getSourceDimensions', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    media.uninstall()
  })

  it('reads a video element as videoWidth x videoHeight', () => {
    media.script({ video: { videoWidth: 1280, videoHeight: 720 } })
    const video = document.createElement('video')
    expect(getSourceDimensions(video)).toEqual({ width: 1280, height: 720 })
  })

  it('falls back to 1080p when a video reports no intrinsic size', () => {
    media.script({ video: { videoWidth: 0, videoHeight: 0 } })
    const video = document.createElement('video')
    expect(getSourceDimensions(video)).toEqual({ width: 1920, height: 1080 })
  })

  it('reads an image element as naturalWidth x naturalHeight', () => {
    media.script({ image: { naturalWidth: 300, naturalHeight: 200 } })
    const img = document.createElement('img')
    expect(getSourceDimensions(img)).toEqual({ width: 300, height: 200 })
  })

  it('falls back to 1080p when an image reports no intrinsic size', () => {
    media.script({ image: { naturalWidth: 0, naturalHeight: 0 } })
    const img = document.createElement('img')
    expect(getSourceDimensions(img)).toEqual({ width: 1920, height: 1080 })
  })

  it('reads a VideoFrame as displayWidth x displayHeight', () => {
    const frame = new VideoFrameDouble({ displayWidth: 640, displayHeight: 480 })
    expect(getSourceDimensions(frame as unknown as VideoFrame)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to 1080p for a source that is none of the three', () => {
    expect(getSourceDimensions({} as unknown as VideoFrame)).toEqual({ width: 1920, height: 1080 })
  })
})

describe('getActiveTransition', () => {
  const tracks = [track('t0', 0), track('t1', 1)]

  it('returns null when no clip has a transition', () => {
    const clips = [timedClip('a', 't0', 0, 5), timedClip('b', 't0', 5, 5)]
    expect(getActiveTransition(clips, tracks, 4.5)).toBeNull()
  })

  it('returns null when the transition duration is zero', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 0 }),
      timedClip('b', 't0', 5, 5),
    ]
    expect(getActiveTransition(clips, tracks, 4.9)).toBeNull()
  })

  it('finds the same-track successor and reports linear progress through the transition', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('b', 't0', 5, 5),
    ]
    const result = getActiveTransition(clips, tracks, 4.5)
    expect(result).not.toBeNull()
    expect(result!.outgoingClip.id).toBe('a')
    expect(result!.incomingClip.id).toBe('b')
    expect(result!.type).toBe('fade')
    expect(result!.progress).toBeCloseTo(0.5, 5)
  })

  it('reports progress 0 at the first instant of the transition', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'wipe-left', duration: 2 }),
      timedClip('b', 't0', 5, 5),
    ]
    expect(getActiveTransition(clips, tracks, 3)!.progress).toBe(0)
  })

  it('is inactive before the transition window and at the clip end', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('b', 't0', 5, 5),
    ]
    expect(getActiveTransition(clips, tracks, 3.9)).toBeNull()
    expect(getActiveTransition(clips, tracks, 5)).toBeNull()
  })

  it('picks the earliest of several same-track successors', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('late', 't0', 12, 5),
      timedClip('next', 't0', 5, 5),
    ]
    expect(getActiveTransition(clips, tracks, 4.5)!.incomingClip.id).toBe('next')
  })

  it('falls back to the topmost visible clip spanning the cut when the track has no successor', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('under', 't0', 0, 20),
      timedClip('over', 't1', 0, 20),
    ]
    // 'under' and 'over' both span the cut; the higher track index wins.
    expect(getActiveTransition(clips, tracks, 4.5)!.incomingClip.id).toBe('over')
  })

  it('ignores overlay clips when looking for the incoming clip', () => {
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('text', 't1', 0, 20, { type: 'none', duration: 0 }, { overlayType: 'text' }),
    ]
    expect(getActiveTransition(clips, tracks, 4.5)).toBeNull()
  })

  it('ignores clips on hidden tracks as candidates', () => {
    const hiddenTracks = [track('t0', 0), track('t1', 1, false)]
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('hidden', 't1', 0, 20),
    ]
    expect(getActiveTransition(clips, hiddenTracks, 4.5)).toBeNull()
  })

  it('skips a transition on a clip whose own track is hidden or missing', () => {
    const hiddenTracks = [track('t0', 0, false)]
    const clips = [
      timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 }),
      timedClip('b', 't0', 5, 5),
    ]
    expect(getActiveTransition(clips, hiddenTracks, 4.5)).toBeNull()
    expect(getActiveTransition(clips, [], 4.5)).toBeNull()
  })
})

describe('checkAborted', () => {
  it('does nothing without a signal, or with one that is not aborted', () => {
    expect(() => checkAborted()).not.toThrow()
    expect(() => checkAborted(new AbortController().signal)).not.toThrow()
  })

  it('throws ExportAbortedError once the signal is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => checkAborted(controller.signal)).toThrow(ExportAbortedError)
    expect(() => checkAborted(controller.signal)).toThrow('Export was cancelled')
    expect(new ExportAbortedError().name).toBe('ExportAbortedError')
  })
})

describe('blendModeToCanvas', () => {
  it('maps every blend mode to a canvas composite operation', () => {
    expect(blendModeToCanvas).toEqual({
      normal: 'source-over',
      multiply: 'multiply',
      screen: 'screen',
      overlay: 'overlay',
      darken: 'darken',
      lighten: 'lighten',
      difference: 'difference',
      add: 'lighter',
    })
  })
})

describe('export support probes', () => {
  it('report supported when the three WebCodecs globals exist', () => {
    const codecs = installWebCodecsDoubles()
    try {
      expect(isMP4ExportSupported()).toBe(true)
      expect(isWebMExportSupported()).toBe(true)
    } finally {
      codecs.uninstall()
    }
  })

  it('report unsupported when WebCodecs is absent', () => {
    const restore = removeWebCodecsGlobals()
    try {
      expect(isMP4ExportSupported()).toBe(false)
      expect(isWebMExportSupported()).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('getQualitySettings', () => {
  it('returns the bitrate pair for every quality level', () => {
    expect(getQualitySettings('low')).toEqual({ videoBitrate: 2_000_000, audioBitrate: 128_000 })
    expect(getQualitySettings('medium')).toEqual({ videoBitrate: 5_000_000, audioBitrate: 192_000 })
    expect(getQualitySettings('high')).toEqual({ videoBitrate: 10_000_000, audioBitrate: 256_000 })
  })
})

describe('getResolution', () => {
  it('uses the project resolution when asked for "project"', () => {
    expect(getResolution('project', 640, 360, { width: 1280, height: 720 }))
      .toEqual({ width: 1280, height: 720 })
  })

  it('rounds an odd project resolution up to even dimensions', () => {
    expect(getResolution('project', 640, 360, { width: 1281, height: 721 }))
      .toEqual({ width: 1282, height: 722 })
  })

  it('falls back to the source size when "project" has no project resolution', () => {
    expect(getResolution('project', 640, 360)).toEqual({ width: 640, height: 360 })
  })

  it('returns the source size for "original", rounded up to even', () => {
    expect(getResolution('original', 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(getResolution('original', 641, 361)).toEqual({ width: 642, height: 362 })
  })

  it('scales presets to the source aspect ratio', () => {
    expect(getResolution('1080p', 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(getResolution('720p', 1920, 1080)).toEqual({ width: 1280, height: 720 })
    expect(getResolution('480p', 1920, 1080)).toEqual({ width: 854, height: 480 })
  })

  it('keeps preset widths even after aspect scaling', () => {
    // 720 * (1000/1000) = 720 is even; 720 * (999/1000) = 719.28 -> 719 -> 720
    expect(getResolution('720p', 999, 1000)).toEqual({ width: 720, height: 720 })
  })

  it('falls back to the source height for an unknown resolution name', () => {
    expect(getResolution('4k' as never, 1000, 500)).toEqual({ width: 1000, height: 500 })
  })
})

describe('loadVideoElement / loadImageElement', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    media.uninstall()
  })

  it('resolves with a configured, muted video element once data loads', async () => {
    const video = await loadVideoElement(new Blob(['v'], { type: 'video/mp4' }))
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)
    expect(video.preload).toBe('auto')
    expect(video.crossOrigin).toBe('anonymous')
    expect(media.srcAssignments).toEqual(['blob:mock-url'])
  })

  it('rejects and revokes the object URL when the video fails to load', async () => {
    media.script({ video: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await expect(loadVideoElement(new Blob(['v'], { type: 'video/mp4' }))).rejects.toThrow('Failed to load video')
    expect(revoke).toHaveBeenCalledWith('blob:mock-url')
    revoke.mockRestore()
  })

  it('resolves with an image element once it loads', async () => {
    media.script({ image: { naturalWidth: 120, naturalHeight: 80 } })
    const img = await loadImageElement(new Blob(['i'], { type: 'image/png' }))
    expect(img.naturalWidth).toBe(120)
    expect(img.naturalHeight).toBe(80)
  })

  it('rejects and revokes the object URL when the image fails to load', async () => {
    media.script({ image: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await expect(loadImageElement(new Blob(['i'], { type: 'image/png' }))).rejects.toThrow('Failed to load image')
    expect(revoke).toHaveBeenCalledWith('blob:mock-url')
    revoke.mockRestore()
  })
})

describe('seek position tracking', () => {
  it('is empty after a clear', () => {
    // Nothing in the shipped pipeline writes to this map any more, so the only
    // observable contract left is that clearing it leaves it empty.
    clearSeekPositions()
    expect(getSeekPositionsCount()).toBe(0)
  })
})

describe('yieldToMain', () => {
  it('resolves via a MessageChannel round trip', async () => {
    let resolved = false
    const promise = yieldToMain().then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    await promise
    expect(resolved).toBe(true)
  })
})

describe('calculateTimelineDuration', () => {
  it('is zero for an empty timeline', () => {
    expect(calculateTimelineDuration([])).toBe(0)
  })

  it('is the furthest clip end, across tracks and out of order', () => {
    const clips = [
      timedClip('a', 't0', 0, 5),
      timedClip('b', 't1', 12, 3),
      timedClip('c', 't0', 6, 2),
    ]
    expect(calculateTimelineDuration(clips)).toBe(15)
  })
})
