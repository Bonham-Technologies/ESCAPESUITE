import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { AudioWaveform } from './AudioWaveform'
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

    /** How many distinct bars one render of `AudioWaveform` draws. */
    function distinctBarsDrawn(
      peaks: WaveformPeak[],
      sourceDuration: number,
      width: number,
      visibleRangePx?: { offset: number; width: number }
    ): number {
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
      // fixed for one render), rounded to absorb float noise between calls.
      const minYs = mockCtx.fillRect.mock.calls.map((call) => call[1] as number)
      unmount()
      return new Set(minYs).size
    }

    it('ten times the zoom draws far more than ten times the waveform detail per second of audio', () => {
      const duration = 60
      // 1000 samples/sec — deliberately denser than ESCAPECRAFT's real 100/sec
      // extraction default, so the window below is never source-bottlenecked:
      // this test is about what AudioWaveform does with the peaks it is
      // given, not about how many peaks the extractor could ever hand it.
      const peaks = monotonicPeaks(duration * 1000)

      // Zoom 1: the clip's whole 3000px box (60s at 50px/s) fits on screen —
      // no visibleRangePx, the zoomed-out fallback. This is exactly the
      // report's own zoom-1 measurement: the whole clip resampled to <=2000.
      const zoom1Bars = distinctBarsDrawn(peaks, duration, 3000)
      const zoom1SecondsPerBar = duration / zoom1Bars
      expect(zoom1Bars).toBe(2000)
      expect(zoom1SecondsPerBar).toBeCloseTo(0.03, 5)

      // Zoom 10: the clip's box is 30,000px (500px/s), but the *same* 3000px
      // of screen — nothing about the viewport changed — now shows only a 6s
      // slice of it, scrolled to the middle.
      const zoom10Bars = distinctBarsDrawn(peaks, duration, 30000, { offset: 13500, width: 3000 })
      const zoom10SecondsPerBar = 6 / zoom10Bars

      // Before ESCSUITE-13 both of these read 0.030s/bar — the whole clip was
      // always resampled to the same <=2000-sample array regardless of zoom,
      // so the window only ever got *wider*, never finer. Zooming in now
      // reveals at least ten times the detail per second of audio on screen.
      expect(zoom10SecondsPerBar).toBeLessThan(zoom1SecondsPerBar / 10)
    })

    it('scrolling a zoomed-in clip re-samples to the newly visible slice', () => {
      const duration = 60
      const peaks = monotonicPeaks(duration * 1000)

      mockCtx.fillRect.mockClear()
      const { rerender } = render(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={duration}
          startTime={0}
          endTime={duration}
          width={30000}
          visibleRangePx={{ offset: 0, width: 3000 }}
          height={40}
        />
      )
      const firstWindow = mockCtx.fillRect.mock.calls.map((call) => call[1])
      expect(firstWindow.length).toBeGreaterThan(0)

      mockCtx.fillRect.mockClear()
      rerender(
        <AudioWaveform
          peaks={peaks}
          sourceDuration={duration}
          startTime={0}
          endTime={duration}
          width={30000}
          visibleRangePx={{ offset: 13500, width: 3000 }}
          height={40}
        />
      )
      const secondWindow = mockCtx.fillRect.mock.calls.map((call) => call[1])

      // Same canvas size, same sample count, but a different slice of the
      // clip — the drawn peaks must differ, not just repeat the first window.
      expect(secondWindow.length).toBe(firstWindow.length)
      expect(secondWindow).not.toEqual(firstWindow)
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
  })
})
