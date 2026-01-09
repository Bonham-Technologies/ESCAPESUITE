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
