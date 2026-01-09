// Watermark utilities for trial exports

export interface WatermarkConfig {
  text: string
  subtext: string
  opacity: number
  fontSize: number
}

export const defaultWatermarkConfig: WatermarkConfig = {
  text: 'ESCAPE Suite Trial',
  subtext: 'escapesuite.io',
  opacity: 0.5,
  fontSize: 24,
}

/**
 * Draw watermark on a canvas context
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: WatermarkConfig = defaultWatermarkConfig
): void {
  ctx.save()

  // Main text (bottom left)
  ctx.fillStyle = `rgba(255, 255, 255, ${config.opacity})`
  ctx.font = `${config.fontSize}px system-ui, -apple-system, sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(config.text, 20, height - 30)

  // Subtext
  ctx.font = `${config.fontSize * 0.67}px system-ui, -apple-system, sans-serif`
  ctx.fillText(config.subtext, 20, height - 10)

  // Top right corner watermark (smaller)
  ctx.font = `${config.fontSize * 0.67}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle = `rgba(255, 255, 255, ${config.opacity * 0.6})`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(config.subtext, width - 20, 20)

  ctx.restore()
}

/**
 * A simple stream processor that adds watermark to any video stream
 */
export class StreamWatermarker {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private video: HTMLVideoElement | null = null
  private animationFrameId: number | null = null
  private outputStream: MediaStream | null = null
  private config: WatermarkConfig

  constructor(width: number, height: number, config: Partial<WatermarkConfig> = {}) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context')
    }
    this.ctx = ctx
    this.config = { ...defaultWatermarkConfig, ...config }
  }

  /**
   * Set the input video stream
   */
  setStream(stream: MediaStream): void {
    if (this.video) {
      this.video.srcObject = null
    }

    this.video = document.createElement('video')
    this.video.srcObject = stream
    this.video.muted = true
    this.video.play()
  }

  /**
   * Start processing and return watermarked stream
   */
  start(frameRate: number = 30): MediaStream {
    this.outputStream = this.canvas.captureStream(frameRate)
    this.render()
    return this.outputStream
  }

  /**
   * Stop processing
   */
  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }

    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }

    this.outputStream = null
  }

  /**
   * Get canvas for preview
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  private render = (): void => {
    this.drawFrame()
    this.animationFrameId = requestAnimationFrame(this.render)
  }

  private drawFrame(): void {
    const { width, height } = this.canvas

    // Clear canvas
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, width, height)

    // Draw video
    if (this.video && this.video.readyState >= 2) {
      this.ctx.drawImage(this.video, 0, 0, width, height)
    }

    // Draw watermark
    drawWatermark(this.ctx, width, height, this.config)
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stop()
  }
}
