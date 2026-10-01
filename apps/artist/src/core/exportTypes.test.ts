import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EXPORT_NO_WEBCODECS_REASON,
  ExportAbortedError,
  ExportError,
  WEBM_NO_CODEC_REASON,
  blendModeToCanvas,
  calculateTimelineDuration,
  checkAborted,
  findSupportedVideoConfig,
  getActiveTransition,
  getBaseDimensions,
  getIncomingClipTime,
  getQualitySettings,
  getResolution,
  getSourceDimensions,
  isMP4ExportSupported,
  isWebMExportSupported,
  loadImageElement,
  loadVideoElement,
  waitForEncoderBackpressure,
  webMVideoCodecConfigs,
  yieldToMain,
} from './exportTypes'
import type { Clip, Track, SourceVideo, TransitionType } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { lastObjectUrl } from '../test/objectUrls'
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

describe('getIncomingClipTime', () => {
  // ESCSUITE-133: a same-track incoming clip's timelinePosition sits at or
  // after the outgoing clip's end, so an unclamped
  // `currentTime - incomingClip.timelinePosition` is negative for the whole
  // transition. Same shape as `getActiveTransition`'s own fixtures above.
  const outgoingClip = timedClip('a', 't0', 0, 5, { type: 'fade', duration: 1 })
  const incomingClip = timedClip('b', 't0', 5, 5)
  const transition = { outgoingClip, incomingClip, progress: 0.5, type: 'fade' as TransitionType }

  it('clamps to 0 rather than going negative before the incoming clip nominally starts', () => {
    expect(getIncomingClipTime(transition, 4.5)).toBe(0)
    expect(getIncomingClipTime(transition, 4)).toBe(0)
    expect(getIncomingClipTime(transition, 4.999)).toBe(0)
  })

  it('passes a genuinely positive clip time through unchanged', () => {
    // The cross-track case: the incoming clip already started before the
    // transition window (`getActiveTransition`'s own fixture above).
    const overlapping = {
      ...transition,
      incomingClip: timedClip('over', 't1', 1, 20),
    }
    expect(getIncomingClipTime(overlapping, 4.5)).toBe(3.5)
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
  it('report supported when the three WebCodecs globals exist', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      expect(isMP4ExportSupported()).toBe(true)
      await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(true)
    } finally {
      codecs.uninstall()
    }
  })

  it('report unsupported when WebCodecs is absent', async () => {
    const restore = removeWebCodecsGlobals()
    try {
      expect(isMP4ExportSupported()).toBe(false)
      await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(false)
    } finally {
      restore()
    }
  })
})

describe('findSupportedVideoConfig', () => {
  it('returns the first config whose isConfigSupported() answers true', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      codecs.encoder.answer = (c) => c.codec === 'b'
      const found = await findSupportedVideoConfig([
        { codec: 'a' } as VideoEncoderConfig,
        { codec: 'b' } as VideoEncoderConfig,
        { codec: 'c' } as VideoEncoderConfig,
      ])
      expect(found?.config).toMatchObject({ codec: 'b' })
      expect(found?.candidate).toMatchObject({ codec: 'b' })
      expect(codecs.encoder.configs.map((c) => (c as { codec: string }).codec)).toEqual(['a', 'b'])
    } finally {
      codecs.uninstall()
    }
  })

  it('skips a config whose probe throws and keeps trying', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      codecs.encoder.answer = (c) =>
        c.codec === 'a' ? Promise.reject(new Error('probe blew up')) : true
      const found = await findSupportedVideoConfig([
        { codec: 'a' } as VideoEncoderConfig,
        { codec: 'b' } as VideoEncoderConfig,
      ])
      expect(found?.config).toMatchObject({ codec: 'b' })
    } finally {
      codecs.uninstall()
    }
  })

  it('returns null when nothing in the list is supported', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      codecs.encoder.answer = () => false
      const found = await findSupportedVideoConfig([{ codec: 'a' } as VideoEncoderConfig])
      expect(found).toBeNull()
    } finally {
      codecs.uninstall()
    }
  })

  // Review round 1, MINOR 3: a caller that needs to know *which candidate it
  // asked about* (exportWebM.ts labelling its muxer track) must read
  // `candidate`, not `config` — the browser owes nothing about what
  // `config.codec` looks like once it has normalised it.
  it('keeps the original candidate even when the browser returns a differently-normalised config', async () => {
    const previous = (globalThis as { VideoEncoder?: unknown }).VideoEncoder
    ;(globalThis as { VideoEncoder?: unknown }).VideoEncoder = {
      isConfigSupported: async (config: VideoEncoderConfig) => ({
        supported: true,
        config: { ...config, codec: 'vp08.00.10.08' },
      }),
    }
    try {
      const found = await findSupportedVideoConfig([{ codec: 'vp8' } as VideoEncoderConfig])
      expect(found?.candidate.codec).toBe('vp8')
      expect(found?.config.codec).toBe('vp08.00.10.08')
    } finally {
      ;(globalThis as { VideoEncoder?: unknown }).VideoEncoder = previous
    }
  })
})

describe('webMVideoCodecConfigs', () => {
  it('offers VP9 before VP8, at the requested size and bitrate', () => {
    expect(webMVideoCodecConfigs(1280, 720, 5_000_000, 30)).toEqual([
      { codec: 'vp09.00.10.08', width: 1280, height: 720, bitrate: 5_000_000, framerate: 30, latencyMode: 'quality' },
      { codec: 'vp8', width: 1280, height: 720, bitrate: 5_000_000, framerate: 30, latencyMode: 'quality' },
    ])
  })
})

describe('isWebMExportSupported', () => {
  it('falls back to VP8 when VP9 cannot be configured', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      codecs.encoder.answer = (c) => c.codec === 'vp8'
      await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(true)
    } finally {
      codecs.uninstall()
    }
  })

  it('reports unsupported when neither VP9 nor VP8 can be configured', async () => {
    const codecs = installWebCodecsDoubles()
    try {
      codecs.encoder.answer = () => false
      await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(false)
    } finally {
      codecs.uninstall()
    }
  })
})

describe('export reason sentences', () => {
  it('names the two browsers that can export, for the no-WebCodecs-at-all case', () => {
    expect(EXPORT_NO_WEBCODECS_REASON).toBe(
      'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.'
    )
  })

  it('names the two browsers that can export, for the no-WebM-codec case', () => {
    expect(WEBM_NO_CODEC_REASON).toBe('This browser cannot encode WebM video — Chrome or Edge can.')
  })
})

describe('waitForEncoderBackpressure', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Coverage round: every other case here injects its own `sleep`, so the
  // default parameter — `(ms) => new Promise((resolve) => setTimeout(resolve, ms))`
  // — never actually runs. This one calls the function with no `sleep` at
  // all, under fake timers, and advances the clock by the 5ms the real
  // default sleeps for.
  it('uses the real setTimeout-based sleep when none is injected', async () => {
    vi.useFakeTimers()
    const encoder = { encodeQueueSize: 25 }

    const promise = waitForEncoderBackpressure({
      encoder,
      threshold: 20,
      getError: () => null,
      log: vi.fn(),
      exportLog: [],
      frameIndex: 0,
      totalFrames: 10,
    })

    // The queue drains while the real sleep is pending; advancing past its
    // 5ms resolves it, and the loop's next check finds the queue clear.
    encoder.encodeQueueSize = 10
    await vi.advanceTimersByTimeAsync(5)

    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves immediately when the queue is already at or under the threshold', async () => {
    const log = vi.fn()
    await waitForEncoderBackpressure({
      encoder: { encodeQueueSize: 5 },
      threshold: 20,
      getError: () => null,
      log,
      exportLog: [],
      frameIndex: 0,
      totalFrames: 10,
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('waits (sleeping between checks) until the queue drains', async () => {
    const encoder = { encodeQueueSize: 25 }
    const sleep = vi.fn(async () => {
      encoder.encodeQueueSize = 10
    })
    await waitForEncoderBackpressure({
      encoder,
      threshold: 20,
      getError: () => null,
      log: vi.fn(),
      exportLog: [],
      frameIndex: 0,
      totalFrames: 10,
      sleep,
    })
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('throws the encoder error reported while waiting, logging it', async () => {
    const error = new Error('encoder exploded')
    const log = vi.fn()
    const exportLog: Array<{ phase: string; detail: string; timestamp: number }> = []

    await expect(
      waitForEncoderBackpressure({
        encoder: { encodeQueueSize: 25 },
        threshold: 20,
        getError: () => error,
        log,
        exportLog,
        frameIndex: 3,
        totalFrames: 10,
        sleep: vi.fn(async () => {}),
      })
    ).rejects.toBe(error)

    expect(log).toHaveBeenCalledWith('error', 'Encoder error during backpressure: encoder exploded')
  })

  it('gives up with an ExportError once the timeout elapses with no progress', async () => {
    const log = vi.fn()
    let now = 0
    await expect(
      waitForEncoderBackpressure({
        encoder: { encodeQueueSize: 25 },
        threshold: 20,
        getError: () => null,
        log,
        exportLog: [],
        frameIndex: 4,
        totalFrames: 10,
        timeoutMs: 100,
        now: () => now,
        sleep: vi.fn(async () => {
          now += 60
        }),
      })
    ).rejects.toMatchObject({
      name: 'ExportError',
      message: 'Video encoder backpressure timeout - encoder may be stuck',
      frameIndex: 4,
      totalFrames: 10,
    })

    expect(log).toHaveBeenCalledWith('fatal', 'Backpressure timeout at frame 4, queue size: 25')
  })

  it('carries the caller\'s own log into the thrown ExportError', async () => {
    const exportLog = [{ phase: 'init', detail: 'start', timestamp: 0 }]
    const error = (await waitForEncoderBackpressure({
      encoder: { encodeQueueSize: 25 },
      threshold: 20,
      getError: () => null,
      log: vi.fn(),
      exportLog,
      frameIndex: 0,
      totalFrames: 1,
      timeoutMs: -1,
      now: () => 0,
      sleep: vi.fn(async () => {}),
    }).catch((e: unknown) => e)) as ExportError

    expect(error).toBeInstanceOf(ExportError)
    expect(error.exportLog).toBe(exportLog)
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

  it('rounds an odd source size up to even when "project" has no project resolution', () => {
    // The only path left that sizes from the source itself (ESCSUITE-111 dropped
    // 'original'); the encoder still needs even dimensions, so both odd sides bump.
    expect(getResolution('project', 1281, 721)).toEqual({ width: 1282, height: 722 })
    expect(getResolution('project', 1280, 721)).toEqual({ width: 1280, height: 722 })
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

  // Review round 1 (ESCSUITE-111): 'targetHeights[resolution] || originalHeight'
  // silently produced a plausible-looking size for a string no typed caller can
  // pass any more (ExportOptions['resolution'] is now the exact four literals).
  // The only way to reach this arm is bypassing the type system, so it throws
  // rather than guessing.
  it('throws for an unknown resolution name instead of silently falling back', () => {
    expect(() => getResolution('4k' as never, 1000, 500)).toThrow(/unknown resolution "4k"/)
  })

  // ESCSUITE-94: a preset is a *height*, and the box it fills is the project's
  // shape. It used to take its aspect from `getBaseDimensions` — the bottom
  // clip's source — so a 16:9 project whose bottom clip happened to be 4:3
  // exported 960x720 for "720p" and the frame was letterboxed on top of being
  // the wrong size.
  it('takes a preset aspect ratio from the project, not from the source', () => {
    const project = { width: 1280, height: 720 }
    expect(getResolution('1080p', 640, 480, project)).toEqual({ width: 1920, height: 1080 })
    expect(getResolution('720p', 640, 480, project)).toEqual({ width: 1280, height: 720 })
    // 480 * 16/9 = 853.33 -> 853 -> 854, the one even width in the ladder.
    expect(getResolution('480p', 640, 480, project)).toEqual({ width: 854, height: 480 })
  })

  it('takes a preset aspect ratio from a portrait project too', () => {
    expect(getResolution('1080p', 1920, 1080, { width: 1080, height: 1920 }))
      .toEqual({ width: 608, height: 1080 })
  })

  it('still uses the source aspect ratio for a preset when no project size is given', () => {
    expect(getResolution('720p', 640, 480)).toEqual({ width: 960, height: 720 })
  })

  it('ignores a degenerate project size when scaling a preset', () => {
    expect(getResolution('720p', 1920, 1080, { width: 0, height: 0 }))
      .toEqual({ width: 1280, height: 720 })
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
    expect(media.srcAssignments).toEqual([lastObjectUrl()])
  })

  it('rejects and revokes the object URL when the video fails to load', async () => {
    media.script({ video: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await expect(loadVideoElement(new Blob(['v'], { type: 'video/mp4' }))).rejects.toThrow('Failed to load video')
    expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
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
    expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
    revoke.mockRestore()
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
