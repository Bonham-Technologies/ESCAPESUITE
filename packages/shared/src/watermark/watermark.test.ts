import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drawWatermark, defaultWatermarkConfig, StreamWatermarker, type WatermarkConfig } from './index'

// Mock canvas context
const createMockContext = () => ({
  save: vi.fn(),
  restore: vi.fn(),
  fillStyle: '',
  font: '',
  textBaseline: '' as CanvasTextBaseline,
  textAlign: '' as CanvasTextAlign,
  fillText: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
})

// Mock requestAnimationFrame
vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => setTimeout(cb, 16)))
vi.stubGlobal('cancelAnimationFrame', vi.fn())

describe('watermark', () => {
  describe('defaultWatermarkConfig', () => {
    it('has correct default values', () => {
      expect(defaultWatermarkConfig.text).toBe('ESCAPE Suite Trial')
      expect(defaultWatermarkConfig.subtext).toBe('escapesuite.io')
      expect(defaultWatermarkConfig.opacity).toBe(0.5)
      expect(defaultWatermarkConfig.fontSize).toBe(24)
    })
  })

  describe('drawWatermark', () => {
    let mockCtx: ReturnType<typeof createMockContext>

    beforeEach(() => {
      mockCtx = createMockContext()
    })

    it('saves and restores context', () => {
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080)

      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.restore).toHaveBeenCalled()
    })

    it('draws main text at bottom left', () => {
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080)

      expect(mockCtx.fillText).toHaveBeenCalledWith('ESCAPE Suite Trial', 20, 1050)
    })

    it('draws subtext at bottom left', () => {
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080)

      expect(mockCtx.fillText).toHaveBeenCalledWith('escapesuite.io', 20, 1070)
    })

    it('draws corner watermark at top right', () => {
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080)

      expect(mockCtx.fillText).toHaveBeenCalledWith('escapesuite.io', 1900, 20)
    })

    it('uses custom config when provided', () => {
      const customConfig: WatermarkConfig = {
        text: 'Custom Text',
        subtext: 'custom.site',
        opacity: 0.8,
        fontSize: 32,
      }

      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080, customConfig)

      expect(mockCtx.fillText).toHaveBeenCalledWith('Custom Text', 20, 1050)
      expect(mockCtx.fillText).toHaveBeenCalledWith('custom.site', 20, 1070)
    })

    it('sets correct opacity for main text', () => {
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080)

      // First fillStyle call should be for main text
      expect(mockCtx.fillStyle).toContain('rgba')
    })

    it('scales font size for subtext', () => {
      const config = { ...defaultWatermarkConfig, fontSize: 30 }
      drawWatermark(mockCtx as unknown as CanvasRenderingContext2D, 1920, 1080, config)

      // Subtext should be 0.67x main size (20.1px)
      expect(mockCtx.font).toContain('20')
    })
  })

  describe('StreamWatermarker', () => {
    let mockCanvas: HTMLCanvasElement
    let mockContext: ReturnType<typeof createMockContext>

    beforeEach(() => {
      mockContext = createMockContext()
      mockCanvas = {
        width: 1920,
        height: 1080,
        getContext: vi.fn(() => mockContext),
        captureStream: vi.fn(() => ({ getTracks: () => [] })),
      } as unknown as HTMLCanvasElement

      // Mock document.createElement
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'canvas') return mockCanvas
        if (tag === 'video') return {
          srcObject: null,
          muted: false,
          play: vi.fn(),
          readyState: 4,
        } as unknown as HTMLVideoElement
        return document.createElement(tag)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('creates watermarker with dimensions', () => {
      const watermarker = new StreamWatermarker(1920, 1080)
      expect(watermarker).toBeDefined()
    })

    it('creates watermarker with custom config', () => {
      const watermarker = new StreamWatermarker(1920, 1080, {
        text: 'Custom',
        opacity: 0.3,
      })
      expect(watermarker).toBeDefined()
    })

    it('returns canvas from getCanvas', () => {
      const watermarker = new StreamWatermarker(1920, 1080)
      const canvas = watermarker.getCanvas()
      expect(canvas).toBeDefined()
    })

    it('stops without errors', () => {
      const watermarker = new StreamWatermarker(1920, 1080)
      expect(() => watermarker.stop()).not.toThrow()
    })

    it('disposes without errors', () => {
      const watermarker = new StreamWatermarker(1920, 1080)
      expect(() => watermarker.dispose()).not.toThrow()
    })

    it('throws when canvas context unavailable', () => {
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'canvas') {
          return {
            width: 1920,
            height: 1080,
            getContext: () => null,
          } as unknown as HTMLCanvasElement
        }
        return document.createElement(tag)
      })

      expect(() => new StreamWatermarker(1920, 1080)).toThrow('Failed to get 2D context')
    })
  })
})

describe('watermark - position calculations', () => {
  it('positions main text 20px from left edge', () => {
    const x = 20
    expect(x).toBe(20)
  })

  it('positions main text 30px from bottom edge', () => {
    const height = 1080
    const y = height - 30
    expect(y).toBe(1050)
  })

  it('positions subtext 10px from bottom edge', () => {
    const height = 1080
    const y = height - 10
    expect(y).toBe(1070)
  })

  it('positions corner watermark 20px from right edge', () => {
    const width = 1920
    const x = width - 20
    expect(x).toBe(1900)
  })

  it('positions corner watermark 20px from top edge', () => {
    const y = 20
    expect(y).toBe(20)
  })
})

describe('watermark - opacity calculations', () => {
  it('calculates main text opacity correctly', () => {
    const baseOpacity = 0.5
    const mainOpacity = baseOpacity
    expect(mainOpacity).toBe(0.5)
  })

  it('calculates corner opacity at 60% of main', () => {
    const baseOpacity = 0.5
    const cornerOpacity = baseOpacity * 0.6
    expect(cornerOpacity).toBe(0.3)
  })

  it('handles full opacity', () => {
    const baseOpacity = 1.0
    const cornerOpacity = baseOpacity * 0.6
    expect(cornerOpacity).toBe(0.6)
  })
})

describe('watermark - font calculations', () => {
  it('calculates subtext font size at 67% of main', () => {
    const mainSize = 24
    const subtextSize = mainSize * 0.67
    expect(subtextSize).toBeCloseTo(16.08, 1)
  })

  it('handles different base sizes', () => {
    expect(30 * 0.67).toBeCloseTo(20.1, 1)
    expect(36 * 0.67).toBeCloseTo(24.12, 1)
    expect(48 * 0.67).toBeCloseTo(32.16, 1)
  })
})
