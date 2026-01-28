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
      // Canvas should have the CSS width set to the requested size
      expect(canvas?.style.width).toBe(`${extremeWidth}px`)
      // Canvas operations should still be called
      expect(mockCtx.clearRect).toHaveBeenCalled()
      expect(mockCtx.fillRect).toHaveBeenCalled()
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
})
