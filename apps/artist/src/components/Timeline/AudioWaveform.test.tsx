import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import {
  AudioWaveform,
  MAX_CACHE_SAMPLES,
  MAX_CACHE_ENTRIES,
  MAX_BACKING_DIMENSION,
  WINDOW_BUCKET_PX,
} from './AudioWaveform'
import * as waveformUtils from '../../utils/waveform'
import { getPeaksForRange, resamplePeaks } from '../../utils/waveform'
import type { WaveformPeak } from '../../store/types'

// Mock canvas context
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  scale: vi.fn(),
  fillStyle: '',
}

// Mock HTMLCanvasElement.getContext
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext

describe('AudioWaveform', () => {
  const defaultPeaks: WaveformPeak[] = [
    { min: -0.5, max: 0.5 },
    { min: -0.8, max: 0.8 },
    { min: -0.3, max: 0.3 },
    { min: -0.6, max: 0.6 },
    { min: -0.4, max: 0.4 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  describe('rendering', () => {
    it('renders canvas element', () => {
      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
    })

    it('renders nothing when peaks are empty', () => {
      const { container } = render(
        <AudioWaveform
          peaks={[]}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeInTheDocument()
    })

    it('renders nothing when width is 0', () => {
      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={0}
          height={40}
        />
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeInTheDocument()
    })

    it('renders nothing when height is 0', () => {
      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={0}
        />
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeInTheDocument()
    })
  })

  describe('isSelected prop - waveform visibility', () => {
    it('uses default purple color for audio clips when not selected', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          isAudioClip={true}
          isSelected={false}
        />
      )

      // Check that fillStyle was set (purple for audio)
      expect(mockCtx.fillStyle).toBe('rgba(138, 43, 226, 0.6)')
    })

    it('uses default blue color for video clips when not selected', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          isAudioClip={false}
          isSelected={false}
        />
      )

      // Check that fillStyle was set (blue for video)
      expect(mockCtx.fillStyle).toBe('rgba(74, 158, 255, 0.5)')
    })

    it('uses white color when selected for contrast', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          isAudioClip={true}
          isSelected={true}
        />
      )

      // Check that fillStyle is white when selected
      expect(mockCtx.fillStyle).toBe('rgba(255, 255, 255, 0.85)')
    })

    it('uses white color for video clips when selected', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          isAudioClip={false}
          isSelected={true}
        />
      )

      // Check that fillStyle is white when selected
      expect(mockCtx.fillStyle).toBe('rgba(255, 255, 255, 0.85)')
    })

    it('allows custom color to override default', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          color="rgba(255, 0, 0, 1)"
          isSelected={false}
        />
      )

      // Custom color should be used
      expect(mockCtx.fillStyle).toBe('rgba(255, 0, 0, 1)')
    })

    it('custom color takes precedence over selection state', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
          color="rgba(0, 255, 0, 1)"
          isSelected={true}
        />
      )

      // Custom color should be used even when selected
      expect(mockCtx.fillStyle).toBe('rgba(0, 255, 0, 1)')
    })
  })

  describe('canvas operations', () => {
    it('clears canvas before drawing', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      expect(mockCtx.clearRect).toHaveBeenCalled()
    })

    it('draws waveform bars', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      // Should have called fillRect multiple times for waveform bars
      expect(mockCtx.fillRect).toHaveBeenCalled()
    })

    it('scales canvas for device pixel ratio', () => {
      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      expect(mockCtx.scale).toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('has aria-hidden attribute', () => {
      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={200}
          height={40}
        />
      )

      const canvas = container.querySelector('canvas')
      expect(canvas).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('extreme zoom handling', () => {
    it('handles very large widths without crashing', () => {
      // This width would exceed browser canvas limits without clamping
      const extremeWidth = 50000

      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={extremeWidth}
          height={40}
        />
      )

      // Canvas should still render
      const canvas = container.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
      // Canvas operations should still be called
      expect(mockCtx.clearRect).toHaveBeenCalled()
      expect(mockCtx.fillRect).toHaveBeenCalled()
    })

    it('never stretches the CSS size past what the backing store actually holds (ESCSUITE-13)', () => {
      // Before ESCSUITE-13, this clamped the *backing store* to 4000px but
      // left `canvas.style.width` at the full, unclamped 50000 — a 12.5x CSS
      // stretch of a 4000px bitmap that bought zooming in nothing. The two
      // now come from the same clamped number, on both dimensions, so they
      // can never disagree again.
      const extremeWidth = 50000

      const { container } = render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={extremeWidth}
          height={40}
        />
      )

      const canvas = container.querySelector('canvas')!
      const dpr = window.devicePixelRatio || 1
      const cssWidth = parseFloat(canvas.style.width)
      expect(canvas.width).toBeCloseTo(cssWidth * dpr, 0)
      // And the CSS width itself is bounded — never the full, unclamped ask.
      expect(cssWidth).toBeLessThan(extremeWidth)
    })

    it('clamps canvas internal width to prevent browser limit issues', () => {
      const extremeWidth = 50000

      render(
        <AudioWaveform
          peaks={defaultPeaks}
          sourceDuration={5}
          startTime={0}
          endTime={5}
          width={extremeWidth}
          height={40}
        />
      )

      // The canvas should still draw successfully
      // (if canvas width exceeded browser limits, drawing would fail)
      expect(mockCtx.fillRect).toHaveBeenCalled()
      expect(mockCtx.scale).toHaveBeenCalled()
    })
  })

  describe('ESCSUITE-13 — resolution follows the visible window, not the clip box', () => {
    const originalDpr = window.devicePixelRatio

    afterEach(() => {
      // Several cases below stub `devicePixelRatio` directly; restore it
      // unconditionally so a failure mid-test can't leak a stubbed value
      // into a later one.
      Object.defineProperty(window, 'devicePixelRatio', {
        value: originalDpr,
        configurable: true,
      })
    })

    /**
     * A source whose envelope gives every raw sample a strictly increasing
     * amplitude, so every resampled bucket is numerically distinct from its
     * neighbours and counting distinct bar heights is exact — the same
     * technique the ticket's own probe used (see `section-13.md`).
     */
    function monotonicPeaks(count: number): WaveformPeak[] {
      return Array.from({ length: count }, (_, i) => {
        const v = (i + 1) / count
        return { min: -v, max: v }
      })
    }

    /** `fillRect`'s `minY` for every bar one render of `AudioWaveform` drew. */
    function drawnMinYs(
      peaks: WaveformPeak[],
      sourceDuration: number,
      width: number,
      visibleRangePx?: { offset: number; width: number }
    ): number[] {
      mockCtx.fillRect.mockClear()
      const { unmount } = render(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={sourceDuration}
          startTime={0}
          endTime={sourceDuration}
          width={width}
          visibleRangePx={visibleRangePx}
          height={40}
        />
      )
      // `fillRect(x, minY, barWidth, barHeight)` — `minY` alone identifies the
      // peak a bar was drawn for (the draw loop's `amplitude`/`centerY` are
      // fixed for one render).
      const minYs = mockCtx.fillRect.mock.calls.map((call) => call[1] as number)
      unmount()
      return minYs
    }

    /** How many distinct bars one render of `AudioWaveform` draws. */
    function distinctBarsDrawn(
      peaks: WaveformPeak[],
      sourceDuration: number,
      width: number,
      visibleRangePx?: { offset: number; width: number }
    ): number {
      return new Set(drawnMinYs(peaks, sourceDuration, width, visibleRangePx)).size
    }

    it('ten times the zoom draws exactly ten times the waveform detail per second of audio', () => {
      const duration = 60
      // 1000 samples/sec — deliberately denser than ESCAPECRAFT's real 100/sec
      // extraction default, so neither window below is source-bottlenecked:
      // this test is about what AudioWaveform does with the peaks it is
      // given, not about how many peaks the extractor could ever hand it.
      const peaks = monotonicPeaks(duration * 1000)

      // Zoom 1: the clip's whole 3000px box (60s at 50px/s) fits on screen —
      // no visibleRangePx. 3000 exceeds the 2000-sample floor, so every pixel
      // gets its own sample: 1 bar per pixel, i.e. 1/50s (1/pixelsPerSecond)
      // of audio per bar — exact, not approximate.
      const zoom1Bars = distinctBarsDrawn(peaks, duration, 3000)
      const zoom1SecondsPerBar = duration / zoom1Bars
      expect(zoom1Bars).toBe(3000)
      expect(zoom1SecondsPerBar).toBeCloseTo(1 / 50, 10)

      // Zoom 10: the clip's box is 30,000px (500px/s — ten times zoom 1's
      // pixelsPerSecond), windowed to a 4096px slice (both multiples of
      // WINDOW_BUCKET_PX, so bucketing cannot move these numbers) starting at
      // pixel 12800. That is 8.192s of the clip, resampled 1:1 again since
      // 4096 exceeds the floor and the window holds 8192 source peaks.
      const windowOffset = 200 * WINDOW_BUCKET_PX
      const windowWidth = 64 * WINDOW_BUCKET_PX
      const zoom10Bars = distinctBarsDrawn(peaks, duration, 30000, {
        offset: windowOffset,
        width: windowWidth,
      })
      const windowSeconds = windowWidth / 500
      const zoom10SecondsPerBar = windowSeconds / zoom10Bars

      // Before ESCSUITE-13 both zoom levels read 0.030s/bar regardless of
      // zoom — the whole clip was always resampled to the same <=2000-sample
      // array, so the window only ever got *wider*, never finer. The ratio
      // below is exact (no tie, no approximation either side of it): ten
      // times the zoom is ten times the density, to the pixel.
      expect(zoom10Bars).toBe(windowWidth)
      expect(zoom10SecondsPerBar).toBeCloseTo(1 / 500, 10)
      expect(zoom1SecondsPerBar / zoom10SecondsPerBar).toBeCloseTo(10, 10)
    })

    it('scrolling a zoomed-in clip re-samples to the newly visible slice', () => {
      const duration = 60
      const peaks = monotonicPeaks(duration * 1000)
      const windowWidth = 64 * WINDOW_BUCKET_PX

      const firstMinYs = drawnMinYs(peaks, duration, 30000, { offset: 0, width: windowWidth })
      expect(firstMinYs.length).toBeGreaterThan(0)

      const secondMinYs = drawnMinYs(peaks, duration, 30000, {
        offset: 200 * WINDOW_BUCKET_PX,
        width: windowWidth,
      })

      // Same window width, same sample count either side...
      expect(secondMinYs.length).toBe(firstMinYs.length)
      // ...but monotonically increasing amplitude means `minY` (= centerY -
      // peak.max * amplitude) strictly *decreases* later in the clip. Every
      // bar of the later window must sit higher than every bar of the
      // earlier one — not just "a different set of values" (which an
      // inverted or off-by-`startTime` mapping could also produce), the
      // *correct* slice of source time (ESCSUITE-13 round 2, MAJOR-3).
      expect(Math.max(...secondMinYs)).toBeLessThan(Math.min(...firstMinYs))
    })

    it('maps a window to the exact slice of source time the pixel math predicts', () => {
      const duration = 60
      const peaks = monotonicPeaks(duration * 1000)
      const fullWidth = 30000
      const offset = 200 * WINDOW_BUCKET_PX // 12800
      const windowWidth = 64 * WINDOW_BUCKET_PX // 4096
      const pixelsPerSecond = fullWidth / duration // 500

      // Computed independently, through the same public utilities the
      // component itself calls — not a re-implementation of its arithmetic,
      // so this only agrees if the component reads the *right* slice.
      const expectedStart = offset / pixelsPerSecond
      const expectedEnd = (offset + windowWidth) / pixelsPerSecond
      const expectedWindowPeaks = getPeaksForRange(peaks, duration, expectedStart, expectedEnd)
      const expectedResampled = resamplePeaks(expectedWindowPeaks, windowWidth)

      const minYs = drawnMinYs(peaks, duration, fullWidth, { offset, width: windowWidth })
      const height = 40
      const centerY = height / 2
      const amplitude = (height / 2) * 0.85
      // Forward through the same `centerY - max * amplitude` expression the
      // component's draw loop uses on both sides, rather than inverting it,
      // so this isn't just floating-point round-trip noise with extra steps.
      const expectedMinYs = expectedResampled.map((p) => centerY - p.max * amplitude)

      expect(minYs).toEqual(expectedMinYs)
    })

    it('positions the canvas at the window\'s own offset, and at 0 for the whole clip', () => {
      const duration = 60
      const peaks = monotonicPeaks(duration * 1000)

      const { container: windowed } = render(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={duration}
          startTime={0}
          endTime={duration}
          width={30000}
          visibleRangePx={{ offset: 200 * WINDOW_BUCKET_PX, width: 64 * WINDOW_BUCKET_PX }}
          height={40}
        />
      )
      // Deleting the `canvas.style.left` write (ESCSUITE-13 round 2,
      // MAJOR-3) leaves this at the CSS default (`0`, from `.waveform`), so
      // this goes red for exactly that regression.
      expect(windowed.querySelector('canvas')!.style.left).toBe(`${200 * WINDOW_BUCKET_PX}px`)

      const { container: fallback } = render(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={duration}
          startTime={0}
          endTime={duration}
          width={3000}
          height={40}
        />
      )
      expect(fallback.querySelector('canvas')!.style.left).toBe('0px')
    })

    it('a window spanning the whole clip never stretches, the same as the fallback', () => {
      const duration = 5
      const peaks = monotonicPeaks(500)
      const { container } = render(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={duration}
          startTime={0}
          endTime={duration}
          width={200}
          visibleRangePx={{ offset: 0, width: 200 }}
          height={40}
        />
      )
      const canvas = container.querySelector('canvas')!
      const dpr = window.devicePixelRatio || 1
      expect(canvas.width).toBeCloseTo(parseFloat(canvas.style.width) * dpr, 0)
    })

    it('draws the same detail whether the whole-clip window is implicit or explicit (MINOR-3 seam, ESCSUITE-13 round 3)', () => {
      // The round-1 bug was a hard jump at the fallback/windowed switch
      // (2000 samples either side of it, regardless of pixel width); round
      // 2's continuous formula (MINOR-3) was meant to remove the switch
      // entirely, but nothing had pinned the one case that most directly
      // proves there's no seam left: a caller who happens to know its
      // viewport (and so always passes `visibleRangePx`, even when that
      // viewport covers the whole clip) must see *exactly* what a caller
      // with no viewport to report sees.
      const duration = 60
      const peaks = monotonicPeaks(duration * 1000)
      const fullWidth = 3000 // exceeds the 2000-sample floor, so this also exercises the post-MINOR-3 formula rather than a degenerate small case

      const implicitBars = distinctBarsDrawn(peaks, duration, fullWidth)
      const explicitBars = distinctBarsDrawn(peaks, duration, fullWidth, { offset: 0, width: fullWidth })

      expect(Math.abs(implicitBars - explicitBars)).toBeLessThanOrEqual(1)
    })

    describe('scroll bucketing (MAJOR-1(a))', () => {
      it('does not re-sample for a scroll that stays inside one 64px bucket', () => {
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')

        const { rerender } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={{ offset: 12800, width: 4096 }}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(1)

        // 12830 floors to the same 12800 bucket start as 12800 did, and
        // 12830 + 4050 = 16880 ceils to the same 16896 bucket end that
        // 12800 + 4096 = 16896 did — so this bucketed window is identical
        // to the one above despite neither raw number matching it.
        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={{ offset: 12830, width: 4050 }}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(1)

        resampleSpy.mockRestore()
      })

      it('never inflates a genuinely zero-width window into a visible tail (ESCSUITE-13 round 3, defect 1)', () => {
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        try {
          // A clip entirely past the right edge: `TimelineTrack`'s
          // `visibleRangeFor` reports exactly this shape — `{ offset:
          // clipWidth, width: 0 }` — for a clip just past the strict
          // viewport but still inside the virtualiser's wider overscan, so
          // it is mounted and rendering at all. `offset: 12345` is
          // deliberately not a multiple of 64: bucketing it outward
          // (floor 12288, ceil 12352) would manufacture a 64px window out
          // of nothing if the zero-width check ran *after* bucketing
          // instead of before it.
          render(
            <AudioWaveform
              peaks={peaks}
              sourceDuration={duration}
              startTime={0}
              endTime={duration}
              width={30000}
              visibleRangePx={{ offset: 12345, width: 0 }}
              height={40}
            />
          )
          expect(resampleSpy).not.toHaveBeenCalled()
        } finally {
          resampleSpy.mockRestore()
        }
      })
    })

    describe('the resample cache (ESCSUITE-13 round 2, MAJOR-2)', () => {
      it('hits the cache for a window seen before, even after a different one in between', () => {
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        const windowA = { offset: 0, width: 64 * WINDOW_BUCKET_PX }
        const windowB = { offset: 200 * WINDOW_BUCKET_PX, width: 64 * WINDOW_BUCKET_PX }

        const { rerender } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={windowA}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(1)

        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={windowB}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(2)

        // Back to window A: a cache hit, not a third resample.
        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={windowA}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(2)

        resampleSpy.mockRestore()
      })

      it('misses the cache when startTime/endTime/sourceDuration change but the pixel window does not (MINOR-1)', () => {
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        const window = { offset: 0, width: 64 * WINDOW_BUCKET_PX }

        const { rerender } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={window}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(1)

        // Same clip box, same window in pixels, but a trim moved `startTime`
        // — the slice of `peaks` this must read is now different, so a cache
        // keyed only on the pixel window would wrongly hit.
        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={1}
            endTime={duration}
            width={30000}
            visibleRangePx={window}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(2)

        resampleSpy.mockRestore()
      })

      it('evicts the least-recently-touched entry once the sample budget is exceeded, and spares a revisited one', () => {
        // ~145 renders, each resampling up to 16,000 synthetic peaks: comfortably
        // under a second alone, but slower under full-suite parallel load —
        // given real headroom rather than tuned to the last millisecond.
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000) // 60,000 — plenty for a 16,000-sample entry
        // The whole-clip fallback at a modest width: varying only
        // `devicePixelRatio` per render is enough to force a distinct cache
        // key each time (the key includes it) and, once `dpr * width`
        // clears MAX_BACKING_DIMENSION, a MAX_BACKING_DIMENSION-sized entry
        // every time — the largest a single entry can be, so the fewest
        // possible renders exceed MAX_CACHE_SAMPLES. No giant peaks array or
        // enormous clip box needed.
        const width = 1000
        const entrySize = MAX_BACKING_DIMENSION
        const dprFor = (i: number) => entrySize / width + i
        // +20, not +1, for a comfortable margin past the first eviction.
        // (This does *not* exercise `freeBuffers` filling past its own cap —
        // each insert here pops at most one buffer before pushing at most
        // one back, so the pool only ever oscillates between 0 and 1; see
        // the dedicated "free-buffer pool" test below for that.)
        const windowCount = Math.ceil(MAX_CACHE_SAMPLES / entrySize) + 20

        function setDpr(value: number): void {
          Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
        }

        setDpr(dprFor(0))
        const { rerender } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={width}
            height={40}
          />
        )

        for (let i = 1; i < windowCount; i++) {
          setDpr(dprFor(i))
          rerender(
            <AudioWaveform
              peaks={peaks}
              sourceDuration={duration}
              startTime={0}
              endTime={duration}
              width={width}
              height={40}
            />
          )
        }

        // The most recently added entry is still cached: revisiting it costs
        // no new resample.
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        setDpr(dprFor(windowCount - 1))
        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={width}
            height={40}
          />
        )
        expect(resampleSpy).not.toHaveBeenCalled()

        // The very first entry has been evicted: revisiting it is a miss.
        setDpr(dprFor(0))
        rerender(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={width}
            height={40}
          />
        )
        expect(resampleSpy).toHaveBeenCalledTimes(1)

        resampleSpy.mockRestore()
      }, 20000)

      it('evicts on entry count alone when the sample budget is nowhere near exceeded (MAX_CACHE_ENTRIES)', () => {
        // MAX_CACHE_SAMPLES and MAX_CACHE_ENTRIES are independent
        // conditions (`&&`) in the same eviction check; the sibling tests
        // above all exercise the sample-budget side being the one that's
        // false. This exercises the *other* side of that `&&`: entries tiny
        // enough (5 samples, via a 5ms window of a 1000/sec source) that
        // 1025 of them total only ~5,125 samples — nowhere near the 500,000
        // budget — so only MAX_CACHE_ENTRIES (1024) ever forces an eviction.
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const windowAt = (i: number) => {
          Object.defineProperty(window, 'devicePixelRatio', { value: 1 + i, configurable: true })
          return (
            <AudioWaveform
              peaks={peaks}
              sourceDuration={duration}
              startTime={0}
              endTime={0.005}
              width={100}
              height={40}
            />
          )
        }

        const { rerender } = render(windowAt(0)) // entry 0 — will be evicted
        for (let i = 1; i < MAX_CACHE_ENTRIES; i++) {
          rerender(windowAt(i))
        }

        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        try {
          // The 1025th distinct window: entries.size would reach 1025,
          // past MAX_CACHE_ENTRIES, forcing the eviction of entry 0 even
          // though the sample budget is barely touched.
          rerender(windowAt(MAX_CACHE_ENTRIES))
          expect(resampleSpy).toHaveBeenCalledTimes(1)

          rerender(windowAt(0)) // entry 0 — evicted, a miss
          expect(resampleSpy).toHaveBeenCalledTimes(2)
        } finally {
          resampleSpy.mockRestore()
        }
      }, 20000)

      it('is LRU, not FIFO: touching the oldest entry spares it from eviction in favour of the second-oldest', () => {
        // Driven by MAX_CACHE_SAMPLES, the same mechanism (and the same
        // entry size) the sibling "evicts the least-recently-touched" test
        // above uses, so this isolates exactly one variable: a touch
        // partway through. 31 entries of 16,000 samples each (496,000,
        // under the 500,000 budget) is one short of forcing an eviction; a
        // 32nd pushes the total to 512,000 and forces exactly one.
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const width = 1000
        const entrySize = MAX_BACKING_DIMENSION
        const dprFor = (i: number) => entrySize / width + i
        const PRE_EVICTION_COUNT = Math.floor(MAX_CACHE_SAMPLES / entrySize) // 31

        function setDpr(value: number): void {
          Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
        }

        function windowAt(i: number) {
          setDpr(dprFor(i))
          return (
            <AudioWaveform
              peaks={peaks}
              sourceDuration={duration}
              startTime={0}
              endTime={duration}
              width={width}
              height={40}
            />
          )
        }

        // Fill to one short of forcing an eviction, in order: entry 0 is
        // the oldest, entry 30 the newest, nothing evicted yet.
        const { rerender } = render(windowAt(0))
        for (let i = 1; i < PRE_EVICTION_COUNT; i++) {
          rerender(windowAt(i))
        }

        // Touch the oldest (entry 0) now that every other entry is already
        // present: a plain re-render with the same props is a cache *hit*,
        // moving it to the most-recently-used end, past all 30 of them.
        rerender(windowAt(0))

        // One more distinct window pushes the total over budget by 16,000 —
        // enough to force evicting exactly one entry. A true LRU evicts
        // entry 1 here (now the oldest *untouched* one, since entry 0 moved
        // to the end); a FIFO cache would instead evict entry 0, since it
        // was inserted first.
        rerender(windowAt(PRE_EVICTION_COUNT))

        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        try {
          rerender(windowAt(1)) // entry 1 — evicted
          expect(resampleSpy).toHaveBeenCalledTimes(1)

          rerender(windowAt(0)) // entry 0 — touched, survives
          expect(resampleSpy).toHaveBeenCalledTimes(1)
        } finally {
          resampleSpy.mockRestore()
        }
      })

      it('fills the free-buffer pool up to its own cap and drops the rest (ESCSUITE-13 round 3)', () => {
        // The round-2 re-review found the free-buffer pool untestable past
        // its own cap: with entries near MAX_BACKING_DIMENSION in size, one
        // eviction (freeing ~16,000 samples) always covers the next insert's
        // overshoot (also capped at ~16,000), so the pool only ever holds 0
        // or 1 buffer at a time. Forcing a *burst* of evictions — enough to
        // actually fill the pool past MAX_FREE_BUFFERS — needs many *small*
        // entries, each far below MAX_BACKING_DIMENSION: this builds 663
        // entries of exactly 751 samples each (a 1s window of a 751-peaks/sec
        // source — 498,213 total, under the 500,000 budget), distinguished
        // only by `devicePixelRatio` (which the cache key includes).
        //
        // A single big, MAX_BACKING_DIMENSION-sized (16,000) entry — the
        // same clip's *whole* 200s range — then pushes the total to 514,213,
        // 14,213 over budget. 751 does not divide evenly into either the
        // budget or MAX_BACKING_DIMENSION, so (unlike a construction built
        // from round numbers) eviction overshoots its target rather than
        // landing exactly on it: it stops after 19 entries (19 x 751 =
        // 14,269), leaving the cache 356 samples *under* budget — enough
        // headroom that the 17 tiny follow-up renders below (each adding a
        // handful of samples) never trigger a second eviction of their own,
        // which would otherwise replenish the pool and make it look
        // bottomless instead of capped.
        //
        // Reuse is observed indirectly, through `resamplePeaks`' own
        // `output` buffer argument (ESCSUITE-13 round 2, MAJOR-1(d)):
        // captured at call time (before `resamplePeaks` mutates it in
        // place), a length of 0 is a freshly allocated array and a length of
        // 751 is one of the 19 evicted entries' buffers, handed back for
        // reuse.
        const sourceDuration = 200
        const SMALL_ENTRY_SIZE = 751
        const peaks: WaveformPeak[] = Array.from(
          { length: SMALL_ENTRY_SIZE * sourceDuration },
          () => ({ min: 0, max: 0 })
        )
        const SMALL_ENTRY_COUNT = 663 // see the derivation above: 19 evicted, margin 356

        function setDpr(value: number): void {
          Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
        }

        /** A 1s window of the source — exactly 751 of its 751/sec peaks. */
        function smallWindow() {
          return (
            <AudioWaveform
              peaks={peaks}
              sourceDuration={sourceDuration}
              startTime={0}
              endTime={1}
              width={100}
              height={40}
            />
          )
        }

        /** The source's whole 200s range, wide enough to hit the 16,000 cap. */
        function bigWindow() {
          return (
            <AudioWaveform
              peaks={peaks}
              sourceDuration={sourceDuration}
              startTime={0}
              endTime={sourceDuration}
              width={20000}
              height={40}
            />
          )
        }

        setDpr(1)
        const { rerender } = render(smallWindow())
        for (let i = 1; i < SMALL_ENTRY_COUNT; i++) {
          setDpr(1 + i)
          rerender(smallWindow())
        }

        // The big entry: triggers the 19-entry eviction burst.
        setDpr(1)
        rerender(bigWindow())

        // Capture each resample's `output` buffer length *at call time*.
        // `original` must be the *real* function, not a leftover spy from an
        // earlier test: `vi.spyOn` on an already-spied property hands back
        // the existing spy rather than wrapping it again, so capturing it
        // here and then setting its own `mockImplementation` to call
        // "itself" would recurse forever. Every spy in this file is torn
        // down in a `finally` for exactly this reason.
        const original = resamplePeaks
        const bufferLengthsAtCall: number[] = []
        const resampleSpy = vi.spyOn(waveformUtils, 'resamplePeaks')
        try {
          resampleSpy.mockImplementation((windowPeaks, targetSamples, output) => {
            bufferLengthsAtCall.push(output ? output.length : -1)
            return original(windowPeaks, targetSamples, output)
          })

          // 16 more, brand-new, *tiny* windows (0.01s — a handful of peaks,
          // not 751, and each distinct from the others so none is a cache
          // hit): each should be handed one of the pool's 16 reused buffers
          // regardless of how small its own request is, since reuse hands
          // back whatever the buffer already held — `resamplePeaks` resizes
          // it to fit *after* this call is observed.
          for (let i = 0; i < 16; i++) {
            setDpr(1)
            rerender(
              <AudioWaveform
                peaks={peaks}
                sourceDuration={sourceDuration}
                startTime={10 + i * 0.1}
                endTime={10 + i * 0.1 + 0.01}
                width={100}
                height={40}
              />
            )
          }
          expect(bufferLengthsAtCall).toEqual(Array(16).fill(SMALL_ENTRY_SIZE))

          // The 17th: the pool is empty now (only 16 were ever kept, of the
          // 19 evicted) — a fresh, empty buffer, not an 18th or 19th reused one.
          setDpr(1)
          rerender(
            <AudioWaveform
              peaks={peaks}
              sourceDuration={sourceDuration}
              startTime={30}
              endTime={30.01}
              width={100}
              height={40}
            />
          )
          expect(bufferLengthsAtCall[16]).toBe(0)
        } finally {
          resampleSpy.mockRestore()
        }
      }, 40000)
    })

    describe('devicePixelRatio (ESCSUITE-13 round 2, MAJOR-2)', () => {
      it('scales the backing store and the sample count above 1', () => {
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const windowWidth = 64 * WINDOW_BUCKET_PX

        const { container } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={{ offset: 0, width: windowWidth }}
            height={40}
          />
        )
        const canvas = container.querySelector('canvas')!
        expect(canvas.width).toBe(windowWidth * 2)
        expect(mockCtx.scale).toHaveBeenCalledWith(2, 2)
        // Twice the device pixels of the window ⇒ twice the samples.
        expect(new Set(mockCtx.fillRect.mock.calls.map((c) => c[1])).size).toBe(windowWidth * 2)
      })

      it('treats a reported devicePixelRatio of 0 as 1', () => {
        Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true })
        const duration = 60
        const peaks = monotonicPeaks(duration * 1000)
        const windowWidth = 64 * WINDOW_BUCKET_PX

        const { container } = render(
          <AudioWaveform
            peaks={peaks}
            sourceDuration={duration}
            startTime={0}
            endTime={duration}
            width={30000}
            visibleRangePx={{ offset: 0, width: windowWidth }}
            height={40}
          />
        )
        const canvas = container.querySelector('canvas')!
        expect(canvas.width).toBe(windowWidth)
        expect(mockCtx.scale).toHaveBeenCalledWith(1, 1)
      })
    })
  })
})
