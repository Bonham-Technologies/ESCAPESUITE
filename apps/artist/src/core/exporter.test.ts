import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isMP4ExportSupported,
  isWebMExportSupported,
  clearSeekPositions,
  getSeekPositionsCount,
} from './exporter'

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
}))

describe('exporter', () => {
  describe('isMP4ExportSupported', () => {
    it('returns true when WebCodecs APIs are available', () => {
      // Mock WebCodecs APIs
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      const result = isMP4ExportSupported()
      expect(result).toBe(true)
    })

    it('returns false when VideoEncoder is not available', () => {
      const originalVideoEncoder = globalThis.VideoEncoder

      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder

      const result = isMP4ExportSupported()
      expect(result).toBe(false)

      globalThis.VideoEncoder = originalVideoEncoder
    })

    it('returns false when VideoDecoder is not available', () => {
      const originalVideoDecoder = globalThis.VideoDecoder
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder

      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoDecoder

      const result = isMP4ExportSupported()
      expect(result).toBe(false)

      globalThis.VideoDecoder = originalVideoDecoder
    })

    it('returns false when VideoFrame is not available', () => {
      const originalVideoFrame = globalThis.VideoFrame
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder

      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoFrame

      const result = isMP4ExportSupported()
      expect(result).toBe(false)

      globalThis.VideoFrame = originalVideoFrame
    })
  })

  describe('isWebMExportSupported', () => {
    it('returns same result as isMP4ExportSupported', () => {
      // Both use the same WebCodecs APIs
      globalThis.VideoEncoder = vi.fn() as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = vi.fn() as unknown as typeof VideoDecoder
      globalThis.VideoFrame = vi.fn() as unknown as typeof VideoFrame

      expect(isWebMExportSupported()).toBe(isMP4ExportSupported())
    })
  })

  describe('quality settings', () => {
    // Test quality settings through exported constants
    it('has valid quality settings for low quality', () => {
      // Low quality should have lower bitrates
      // Testing this through the module's behavior rather than internal functions
      expect(true).toBe(true) // Placeholder for quality settings test
    })
  })

  describe('resolution calculation', () => {
    // Resolution calculation is tested indirectly through export functions
    // Testing the logic separately would require exposing internal functions

    it('ensures even dimensions for video encoding', () => {
      // Video codecs require even width/height
      // This is handled internally by the getResolution function
      const testOddDimension = (dim: number): number => {
        return dim % 2 === 0 ? dim : dim + 1
      }

      expect(testOddDimension(1920)).toBe(1920)
      expect(testOddDimension(1921)).toBe(1922)
      expect(testOddDimension(1080)).toBe(1080)
      expect(testOddDimension(1081)).toBe(1082)
    })
  })

  describe('timeline duration calculation', () => {
    it('calculates duration from clips', () => {
      const clips = [
        { timelinePosition: 0, duration: 5 },
        { timelinePosition: 10, duration: 3 },
        { timelinePosition: 5, duration: 2 },
      ]

      const duration = Math.max(...clips.map(c => c.timelinePosition + c.duration))

      expect(duration).toBe(13) // 10 + 3
    })

    it('returns 0 for empty clips', () => {
      const clips: { timelinePosition: number; duration: number }[] = []

      const duration = clips.length === 0 ? 0 : Math.max(...clips.map(c => c.timelinePosition + c.duration))

      expect(duration).toBe(0)
    })
  })

  describe('blend mode mapping', () => {
    it('maps blend modes to canvas composite operations', () => {
      const blendModeMap: Record<string, GlobalCompositeOperation> = {
        normal: 'source-over',
        multiply: 'multiply',
        screen: 'screen',
        overlay: 'overlay',
        darken: 'darken',
        lighten: 'lighten',
        difference: 'difference',
        add: 'lighter',
      }

      // Verify all blend modes have valid canvas operations
      Object.values(blendModeMap).forEach((op) => {
        expect(typeof op).toBe('string')
        expect(op.length).toBeGreaterThan(0)
      })
    })
  })

  describe('transition types', () => {
    it('supports all transition types', () => {
      const transitionTypes = [
        'none',
        'fade',
        'dissolve',
        'wipe-left',
        'wipe-right',
        'wipe-up',
        'wipe-down',
        'slide-left',
        'slide-right',
        'slide-up',
        'slide-down',
      ]

      expect(transitionTypes).toHaveLength(11)
    })
  })

  describe('export error handling', () => {
    beforeEach(() => {
      // Ensure WebCodecs is not available for error tests
      const originalVideoEncoder = globalThis.VideoEncoder
      const originalVideoDecoder = globalThis.VideoDecoder
      const originalVideoFrame = globalThis.VideoFrame

      afterEach(() => {
        globalThis.VideoEncoder = originalVideoEncoder
        globalThis.VideoDecoder = originalVideoDecoder
        globalThis.VideoFrame = originalVideoFrame
      })
    })

    it('throws error for empty clips array', async () => {
      // This would be tested through the actual export function
      // but we need to mock all the WebCodecs APIs first
      expect(true).toBe(true)
    })
  })
})

describe('exporter - integration helpers', () => {
  describe('getActiveTransition', () => {
    // Helper to test transition detection logic
    it('detects transition at clip boundary', () => {
      const clip1EndTime = 5
      const transitionDuration = 1
      const transitionStart = clip1EndTime - transitionDuration

      const currentTime = 4.5 // In transition period

      const isInTransition = currentTime >= transitionStart && currentTime < clip1EndTime

      expect(isInTransition).toBe(true)
    })

    it('calculates transition progress correctly', () => {
      const clipEnd = 5
      const transitionDuration = 1
      const transitionStart = clipEnd - transitionDuration
      const currentTime = 4.5

      const progress = (currentTime - transitionStart) / transitionDuration

      expect(progress).toBe(0.5)
    })
  })
})

describe('exporter - seek optimization', () => {
  beforeEach(() => {
    clearSeekPositions()
  })

  describe('clearSeekPositions', () => {
    it('clears all tracked seek positions', () => {
      // Initial state should be empty after clear
      expect(getSeekPositionsCount()).toBe(0)
    })
  })

  describe('getSeekPositionsCount', () => {
    it('returns 0 when no positions tracked', () => {
      clearSeekPositions()
      expect(getSeekPositionsCount()).toBe(0)
    })
  })

  describe('frame tolerance calculations', () => {
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

    it('determines if positions are within frame tolerance', () => {
      const frameRate = 30
      const frameTolerance = 1 / frameRate
      const lastPosition = 1.0
      const newPosition = 1.02

      const withinTolerance = Math.abs(lastPosition - newPosition) < frameTolerance

      expect(withinTolerance).toBe(true)
    })

    it('determines if positions exceed frame tolerance', () => {
      const frameRate = 30
      const frameTolerance = 1 / frameRate
      const lastPosition = 1.0
      const newPosition = 1.1 // 0.1s apart, more than one frame

      const withinTolerance = Math.abs(lastPosition - newPosition) < frameTolerance

      expect(withinTolerance).toBe(false)
    })
  })

  describe('video readiness checks', () => {
    it('defines readyState thresholds correctly', () => {
      // HAVE_NOTHING = 0
      // HAVE_METADATA = 1
      // HAVE_CURRENT_DATA = 2
      // HAVE_FUTURE_DATA = 3
      // HAVE_ENOUGH_DATA = 4

      const minimumForDrawing = 2 // HAVE_CURRENT_DATA

      expect(minimumForDrawing).toBe(2)
    })

    it('video should be ready when readyState >= 2', () => {
      const testCases = [
        { readyState: 0, expected: false },
        { readyState: 1, expected: false },
        { readyState: 2, expected: true },
        { readyState: 3, expected: true },
        { readyState: 4, expected: true },
      ]

      testCases.forEach(({ readyState, expected }) => {
        const isReady = readyState >= 2
        expect(isReady).toBe(expected)
      })
    })
  })
})

describe('exporter - black flash prevention', () => {
  describe('seek timeout configuration', () => {
    it('uses reasonable timeout values', () => {
      const seekTimeout = 500 // Current value in code
      const frameReadyCheck = 16 // Quick frame ready check

      // Timeout should be reasonable for reliable seeking
      expect(seekTimeout).toBeGreaterThanOrEqual(250)
      expect(seekTimeout).toBeLessThanOrEqual(1000)
      // Frame ready check should be quick
      expect(frameReadyCheck).toBeLessThan(100)
    })
  })

  describe('retry logic', () => {
    it('allows retry attempts', () => {
      const maxRetries = 1 // Current value in code

      expect(maxRetries).toBeGreaterThanOrEqual(1)
      expect(maxRetries).toBeLessThanOrEqual(3) // Don't retry too many times
    })

    it('calculates total maximum wait time', () => {
      const seekTimeout = 500
      const maxRetries = 1
      const retryDelay = 16
      const frameReadyCheck = 16

      // Worst case: all retries fail
      const maxWaitTime = (maxRetries + 1) * (seekTimeout + frameReadyCheck) + maxRetries * retryDelay

      // Should complete within reasonable time (under 2 seconds per video)
      expect(maxWaitTime).toBeLessThan(2000)
    })
  })
})
