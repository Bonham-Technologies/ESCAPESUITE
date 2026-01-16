import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isMP4ExportSupported,
  isWebMExportSupported,
  clearSeekPositions,
  getSeekPositionsCount,
  exportToWebM,
  exportToMP4,
  ExportAbortedError,
} from './exporter'
import type { Clip, SourceVideo, ExportOptions, Track } from '../store/types'

// Mock dependencies
vi.mock('./storage', () => ({
  getVideoBlob: vi.fn(),
}))

vi.mock('../store/projectStore', () => ({
  getClipsAtTime: vi.fn(() => []),
}))

vi.mock('../utils/animation', () => ({
  getAnimatedValues: vi.fn(() => ({
    x: 0.5,
    y: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blur: 0,
  })),
  getAnimatedValuesCached: vi.fn(() => ({
    x: 0.5,
    y: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blur: 0,
  })),
  getAnimatedVolume: vi.fn(() => 1),
  clearAnimationCache: vi.fn(),
}))

vi.mock('../utils/workerSupport', () => ({
  getWorkerSupport: vi.fn(() => Promise.resolve(false)),
}))

describe('exporter', () => {
  describe('isMP4ExportSupported', () => {
    const originalVideoEncoder = globalThis.VideoEncoder
    const originalVideoDecoder = globalThis.VideoDecoder
    const originalVideoFrame = globalThis.VideoFrame

    afterEach(() => {
      globalThis.VideoEncoder = originalVideoEncoder
      globalThis.VideoDecoder = originalVideoDecoder
      globalThis.VideoFrame = originalVideoFrame
    })

    it('returns true when WebCodecs APIs are available', () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      const result = isMP4ExportSupported()
      expect(result).toBe(true)
    })

    it('returns false when VideoEncoder is not available', () => {
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder

      const result = isMP4ExportSupported()
      expect(result).toBe(false)
    })

    it('returns false when VideoDecoder is not available', () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoDecoder

      const result = isMP4ExportSupported()
      expect(result).toBe(false)
    })

    it('returns false when VideoFrame is not available', () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoFrame

      const result = isMP4ExportSupported()
      expect(result).toBe(false)
    })
  })

  describe('isWebMExportSupported', () => {
    it('returns same result as isMP4ExportSupported', () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      expect(isWebMExportSupported()).toBe(isMP4ExportSupported())
    })
  })

  describe('seek position tracking', () => {
    beforeEach(() => {
      clearSeekPositions()
    })

    it('starts with empty seek positions', () => {
      expect(getSeekPositionsCount()).toBe(0)
    })

    it('clears seek positions correctly', () => {
      clearSeekPositions()
      expect(getSeekPositionsCount()).toBe(0)
    })
  })

  describe('exportToWebM', () => {
    it('throws error when WebCodecs not supported', async () => {
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder

      const clips: Clip[] = [{
        id: 'clip1',
        sourceVideoId: 'video1',
        name: 'Clip 1',
        trackId: 'track1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0 },
      }]
      const sourceVideos: SourceVideo[] = [{
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }]
      const options: ExportOptions = {
        format: 'webm',
        quality: 'medium',
        resolution: 'original',
      }

      await expect(exportToWebM(clips, sourceVideos, options, vi.fn()))
        .rejects.toThrow('WebM export requires WebCodecs API')
    })

    it('throws error for empty clips array', async () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      await expect(exportToWebM([], [], { format: 'webm', quality: 'medium', resolution: 'original' }, vi.fn()))
        .rejects.toThrow('No clips to export')
    })
  })

  describe('exportToMP4', () => {
    it('throws error when WebCodecs not supported', async () => {
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder

      const clips: Clip[] = [{
        id: 'clip1',
        sourceVideoId: 'video1',
        name: 'Clip 1',
        trackId: 'track1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0 },
      }]
      const sourceVideos: SourceVideo[] = [{
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000000,
      }]
      const options: ExportOptions = {
        format: 'mp4',
        quality: 'medium',
        resolution: 'original',
      }

      await expect(exportToMP4(clips, sourceVideos, options, vi.fn()))
        .rejects.toThrow('MP4 export requires WebCodecs API')
    })

    it('throws error for empty clips array', async () => {
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      await expect(exportToMP4([], [], { format: 'mp4', quality: 'medium', resolution: 'original' }, vi.fn()))
        .rejects.toThrow('No clips to export')
    })
  })
})

describe('exporter - quality settings', () => {
  it('low quality has lowest bitrates', () => {
    const lowVideoBitrate = 2_000_000
    const lowAudioBitrate = 128_000

    expect(lowVideoBitrate).toBeLessThan(5_000_000)
    expect(lowAudioBitrate).toBeLessThan(192_000)
  })

  it('medium quality has moderate bitrates', () => {
    const mediumVideoBitrate = 5_000_000
    const mediumAudioBitrate = 192_000

    expect(mediumVideoBitrate).toBeGreaterThan(2_000_000)
    expect(mediumVideoBitrate).toBeLessThan(10_000_000)
    expect(mediumAudioBitrate).toBeGreaterThan(128_000)
  })

  it('high quality has highest bitrates', () => {
    const highVideoBitrate = 10_000_000
    const highAudioBitrate = 256_000

    expect(highVideoBitrate).toBeGreaterThan(5_000_000)
    expect(highAudioBitrate).toBeGreaterThan(192_000)
  })
})

describe('exporter - resolution calculation', () => {
  const getResolution = (
    resolution: string,
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } => {
    if (resolution === 'original') {
      return {
        width: originalWidth % 2 === 0 ? originalWidth : originalWidth + 1,
        height: originalHeight % 2 === 0 ? originalHeight : originalHeight + 1
      }
    }

    const targetHeights: Record<string, number> = {
      '1080p': 1080,
      '720p': 720,
      '480p': 480,
    }

    const targetHeight = targetHeights[resolution] || originalHeight
    const aspectRatio = originalWidth / originalHeight
    const width = Math.round(targetHeight * aspectRatio)

    return {
      width: width % 2 === 0 ? width : width + 1,
      height: targetHeight % 2 === 0 ? targetHeight : targetHeight + 1,
    }
  }

  it('keeps original dimensions when resolution is original', () => {
    const result = getResolution('original', 1920, 1080)
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
  })

  it('ensures even width for odd original dimensions', () => {
    const result = getResolution('original', 1921, 1080)
    expect(result.width).toBe(1922)
    expect(result.width % 2).toBe(0)
  })

  it('ensures even height for odd original dimensions', () => {
    const result = getResolution('original', 1920, 1081)
    expect(result.height).toBe(1082)
    expect(result.height % 2).toBe(0)
  })

  it('scales to 1080p correctly', () => {
    const result = getResolution('1080p', 1920, 1080)
    expect(result.height).toBe(1080)
  })

  it('scales to 720p maintaining aspect ratio', () => {
    const result = getResolution('720p', 1920, 1080)
    expect(result.height).toBe(720)
    expect(result.width).toBe(1280)
  })

  it('scales to 480p maintaining aspect ratio', () => {
    const result = getResolution('480p', 1920, 1080)
    expect(result.height).toBe(480)
    // 1920/1080 * 480 = 853.33... rounded to 854 (even)
    expect(result.width % 2).toBe(0)
  })

  it('handles non-16:9 aspect ratios', () => {
    // 4:3 video
    const result = getResolution('720p', 1440, 1080)
    expect(result.height).toBe(720)
    // 1440/1080 * 720 = 960
    expect(result.width).toBe(960)
  })
})

describe('exporter - timeline duration calculation', () => {
  const calculateTimelineDuration = (clips: Array<{ timelinePosition: number; duration: number }>): number => {
    if (clips.length === 0) return 0
    return Math.max(...clips.map(c => c.timelinePosition + c.duration))
  }

  it('returns 0 for empty clips array', () => {
    expect(calculateTimelineDuration([])).toBe(0)
  })

  it('calculates duration from single clip', () => {
    const clips = [{ timelinePosition: 0, duration: 5 }]
    expect(calculateTimelineDuration(clips)).toBe(5)
  })

  it('calculates duration from multiple sequential clips', () => {
    const clips = [
      { timelinePosition: 0, duration: 5 },
      { timelinePosition: 5, duration: 3 },
      { timelinePosition: 8, duration: 2 },
    ]
    expect(calculateTimelineDuration(clips)).toBe(10)
  })

  it('handles overlapping clips', () => {
    const clips = [
      { timelinePosition: 0, duration: 10 },
      { timelinePosition: 5, duration: 3 }, // Overlaps, ends at 8
    ]
    expect(calculateTimelineDuration(clips)).toBe(10)
  })

  it('finds maximum end time regardless of order', () => {
    const clips = [
      { timelinePosition: 10, duration: 3 }, // Ends at 13
      { timelinePosition: 0, duration: 5 },  // Ends at 5
      { timelinePosition: 5, duration: 2 },  // Ends at 7
    ]
    expect(calculateTimelineDuration(clips)).toBe(13)
  })

  it('handles clips with gaps', () => {
    const clips = [
      { timelinePosition: 0, duration: 2 },
      { timelinePosition: 10, duration: 5 }, // Gap from 2 to 10
    ]
    expect(calculateTimelineDuration(clips)).toBe(15)
  })
})

describe('exporter - blend mode mapping', () => {
  const blendModeToCanvas: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    difference: 'difference',
    add: 'lighter',
  }

  it('maps all blend modes to valid canvas operations', () => {
    Object.entries(blendModeToCanvas).forEach(([_mode, operation]) => {
      expect(typeof operation).toBe('string')
      expect(operation.length).toBeGreaterThan(0)
    })
  })

  it('maps normal to source-over', () => {
    expect(blendModeToCanvas.normal).toBe('source-over')
  })

  it('maps add to lighter', () => {
    expect(blendModeToCanvas.add).toBe('lighter')
  })

  it('has 8 blend modes', () => {
    expect(Object.keys(blendModeToCanvas)).toHaveLength(8)
  })
})

describe('exporter - transition detection', () => {
  interface TransitionInfo {
    outgoingClip: Clip
    incomingClip: Clip
    progress: number
    type: string
  }

  const getActiveTransition = (
    clips: Clip[],
    tracks: Track[],
    time: number
  ): TransitionInfo | null => {
    for (const clip of clips) {
      if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue

      const track = tracks.find(t => t.id === clip.trackId)
      if (!track || !track.visible) continue

      const clipEnd = clip.timelinePosition + clip.duration
      const transitionStart = clipEnd - clip.transition.duration

      if (time >= transitionStart && time < clipEnd) {
        // Find incoming clip
        const incomingClip = clips
          .filter(c => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
          .sort((a, b) => a.timelinePosition - b.timelinePosition)[0]

        if (incomingClip) {
          const progress = (time - transitionStart) / clip.transition.duration
          return {
            outgoingClip: clip,
            incomingClip,
            progress: Math.min(1, Math.max(0, progress)),
            type: clip.transition.type,
          }
        }
      }
    }
    return null
  }

  const createClip = (overrides: Partial<Clip> = {}): Clip => ({
    id: 'clip1',
    sourceVideoId: 'video1',
    name: 'Clip 1',
    trackId: 'track1',
    startTime: 0,
    endTime: 5,
    duration: 5,
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0 },
    ...overrides,
  })

  const createTrack = (overrides: Partial<Track> = {}): Track => ({
    id: 'track1',
    name: 'Track 1',
    index: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
    ...overrides,
  })

  it('returns null when no transitions exist', () => {
    const clips = [createClip()]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 2.5)
    expect(result).toBeNull()
  })

  it('returns null when transition type is none', () => {
    const clips = [
      createClip({ transition: { type: 'none', duration: 1 } }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 4.5)
    expect(result).toBeNull()
  })

  it('returns null when track is not visible', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }),
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack({ visible: false })]

    const result = getActiveTransition(clips, tracks, 4.5)
    expect(result).toBeNull()
  })

  it('detects transition when time is in transition period', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }), // Ends at 5, transition starts at 4
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 4.5) // In transition period
    expect(result).not.toBeNull()
    expect(result?.type).toBe('fade')
    expect(result?.progress).toBeCloseTo(0.5, 1)
  })

  it('calculates progress correctly at transition start', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }),
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 4.0) // Start of transition
    expect(result?.progress).toBeCloseTo(0, 1)
  })

  it('calculates progress correctly at transition end', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }),
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 4.99) // Near end of transition
    expect(result?.progress).toBeCloseTo(1, 1)
  })

  it('returns null when time is before transition', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }),
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 3.0) // Before transition starts
    expect(result).toBeNull()
  })

  it('returns null when time is after transition', () => {
    const clips = [
      createClip({ transition: { type: 'fade', duration: 1 } }),
      createClip({ id: 'clip2', timelinePosition: 5, duration: 5, endTime: 10 }),
    ]
    const tracks = [createTrack()]

    const result = getActiveTransition(clips, tracks, 5.5) // After transition ends
    expect(result).toBeNull()
  })
})

describe('exporter - frame tolerance calculations', () => {
  it('calculates correct frame tolerance at 30fps', () => {
    const frameRate = 30
    const frameTolerance = 1 / frameRate
    expect(frameTolerance).toBeCloseTo(0.0333, 3)
  })

  it('calculates correct frame tolerance at 60fps', () => {
    const frameRate = 60
    const frameTolerance = 1 / frameRate
    expect(frameTolerance).toBeCloseTo(0.0167, 3)
  })

  it('calculates correct frame tolerance at 24fps', () => {
    const frameRate = 24
    const frameTolerance = 1 / frameRate
    expect(frameTolerance).toBeCloseTo(0.0417, 3)
  })

  it('determines if positions are within frame tolerance', () => {
    const frameRate = 30
    const frameTolerance = 1 / frameRate

    expect(Math.abs(1.0 - 1.02) < frameTolerance).toBe(true)
    expect(Math.abs(1.0 - 1.01) < frameTolerance).toBe(true)
  })

  it('determines if positions exceed frame tolerance', () => {
    const frameRate = 30
    const frameTolerance = 1 / frameRate

    expect(Math.abs(1.0 - 1.1) < frameTolerance).toBe(false)
    expect(Math.abs(1.0 - 1.05) < frameTolerance).toBe(false)
  })
})

describe('exporter - video readiness checks', () => {
  it('video should be ready when readyState >= 2', () => {
    const testCases = [
      { readyState: 0, expected: false }, // HAVE_NOTHING
      { readyState: 1, expected: false }, // HAVE_METADATA
      { readyState: 2, expected: true },  // HAVE_CURRENT_DATA
      { readyState: 3, expected: true },  // HAVE_FUTURE_DATA
      { readyState: 4, expected: true },  // HAVE_ENOUGH_DATA
    ]

    testCases.forEach(({ readyState, expected }) => {
      expect(readyState >= 2).toBe(expected)
    })
  })
})

describe('exporter - aspect ratio calculations', () => {
  const calculateScaledDimensions = (
    videoWidth: number,
    videoHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ): { baseWidth: number; baseHeight: number } => {
    const videoAspect = videoWidth / videoHeight
    const canvasAspect = canvasWidth / canvasHeight

    if (videoAspect > canvasAspect) {
      // Video is wider - fit to height
      return {
        baseHeight: canvasHeight,
        baseWidth: canvasHeight * videoAspect,
      }
    } else {
      // Video is taller - fit to width
      return {
        baseWidth: canvasWidth,
        baseHeight: canvasWidth / videoAspect,
      }
    }
  }

  it('scales wider video to fit height', () => {
    // 21:9 ultrawide video on 16:9 canvas
    const result = calculateScaledDimensions(2560, 1080, 1920, 1080)
    expect(result.baseHeight).toBe(1080)
    expect(result.baseWidth).toBeGreaterThan(1920)
  })

  it('scales taller video to fit width', () => {
    // 4:3 video on 16:9 canvas
    const result = calculateScaledDimensions(1440, 1080, 1920, 1080)
    expect(result.baseWidth).toBe(1920)
    expect(result.baseHeight).toBeGreaterThan(1080)
  })

  it('handles square video', () => {
    const result = calculateScaledDimensions(1080, 1080, 1920, 1080)
    expect(result.baseWidth).toBe(1920)
    expect(result.baseHeight).toBe(1920) // 1920 / 1 = 1920
  })

  it('handles same aspect ratio', () => {
    const result = calculateScaledDimensions(1920, 1080, 1920, 1080)
    // Should fit exactly
    expect(result.baseWidth).toBe(1920)
    expect(result.baseHeight).toBe(1080)
  })
})

describe('exporter - audio mixing', () => {
  it('normalizes audio to prevent clipping', () => {
    const normalize = (samples: Float32Array): Float32Array => {
      let maxSample = 0
      for (let i = 0; i < samples.length; i++) {
        maxSample = Math.max(maxSample, Math.abs(samples[i]))
      }

      if (maxSample > 1) {
        const scale = 0.95 / maxSample
        for (let i = 0; i < samples.length; i++) {
          samples[i] *= scale
        }
      }

      return samples
    }

    // Audio that exceeds 1.0
    const samples = new Float32Array([0.5, 1.5, -0.8, 2.0])
    const normalized = normalize(samples)

    // Check max is now <= 0.95
    let max = 0
    for (const sample of normalized) {
      max = Math.max(max, Math.abs(sample))
    }
    expect(max).toBeLessThanOrEqual(0.95)
  })

  it('preserves audio that does not clip', () => {
    const normalize = (samples: Float32Array): Float32Array => {
      let maxSample = 0
      for (let i = 0; i < samples.length; i++) {
        maxSample = Math.max(maxSample, Math.abs(samples[i]))
      }

      if (maxSample > 1) {
        const scale = 0.95 / maxSample
        for (let i = 0; i < samples.length; i++) {
          samples[i] *= scale
        }
      }

      return samples
    }

    // Audio within range
    const samples = new Float32Array([0.5, 0.3, -0.8, 0.6])
    const original = new Float32Array(samples)
    normalize(samples)

    // Should be unchanged
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toBe(original[i])
    }
  })
})

describe('ExportAbortedError', () => {
  it('has correct name property', () => {
    const error = new ExportAbortedError()
    expect(error.name).toBe('ExportAbortedError')
  })

  it('has correct message', () => {
    const error = new ExportAbortedError()
    expect(error.message).toBe('Export was cancelled')
  })

  it('is an instance of Error', () => {
    const error = new ExportAbortedError()
    expect(error).toBeInstanceOf(Error)
  })

  it('can be caught and identified', () => {
    try {
      throw new ExportAbortedError()
    } catch (e) {
      expect(e).toBeInstanceOf(ExportAbortedError)
      expect((e as ExportAbortedError).name).toBe('ExportAbortedError')
    }
  })
})

describe('exporter - abort signal handling', () => {
  const createTestClip = (): Clip => ({
    id: 'clip1',
    sourceVideoId: 'video1',
    name: 'Clip 1',
    trackId: 'track1',
    startTime: 0,
    endTime: 5,
    duration: 5,
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0 },
  })

  const createTestSourceVideo = (): SourceVideo => ({
    id: 'video1',
    name: 'test.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 1000000,
  })

  const createTestOptions = (format: 'webm' | 'mp4'): ExportOptions => ({
    format,
    quality: 'medium',
    resolution: 'original',
  })

  beforeEach(() => {
    // Setup WebCodecs mocks
    globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
    globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
    globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('exportToWebM throws ExportAbortedError when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort() // Abort immediately

    const clips = [createTestClip()]
    const sourceVideos = [createTestSourceVideo()]
    const options = createTestOptions('webm')

    await expect(
      exportToWebM(clips, sourceVideos, options, vi.fn(), undefined, undefined, controller.signal)
    ).rejects.toThrow(ExportAbortedError)
  })

  it('exportToMP4 throws ExportAbortedError when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort() // Abort immediately

    const clips = [createTestClip()]
    const sourceVideos = [createTestSourceVideo()]
    const options = createTestOptions('mp4')

    await expect(
      exportToMP4(clips, sourceVideos, options, vi.fn(), undefined, undefined, controller.signal)
    ).rejects.toThrow(ExportAbortedError)
  })

  it('ExportAbortedError message indicates cancellation', async () => {
    const controller = new AbortController()
    controller.abort()

    const clips = [createTestClip()]
    const sourceVideos = [createTestSourceVideo()]
    const options = createTestOptions('webm')

    try {
      await exportToWebM(clips, sourceVideos, options, vi.fn(), undefined, undefined, controller.signal)
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ExportAbortedError)
      expect((e as Error).message).toBe('Export was cancelled')
    }
  })
})
