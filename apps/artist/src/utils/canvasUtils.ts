/**
 * Shared canvas utilities for preview and export rendering
 * Reduces code duplication between PreviewPlayer and exporter
 */

import type { ShapeType, BlendMode } from '../store/types';

// ============================================
// TYPES
// ============================================

export interface ShapeRenderOptions {
  type: ShapeType;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  rotation?: number;
  opacity?: number;
  blur?: number;
}

export interface TextRenderOptions {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor?: string;
  textAlign: CanvasTextAlign;
  rotation?: number;
  opacity?: number;
  blur?: number;
}

export interface TransformOptions {
  x: number;
  y: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  blur?: number;
}

// ============================================
// BLEND MODE MAPPING
// ============================================

export const blendModeToCanvas: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  add: 'lighter',
};

// ============================================
// TRANSFORM UTILITIES
// ============================================

/**
 * Apply a rotation transform around a center point
 */
export function applyRotation(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  rotationDegrees: number
): void {
  if (rotationDegrees !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((rotationDegrees * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
}

/**
 * Apply common transform options to a context
 */
export function applyTransformOptions(
  ctx: CanvasRenderingContext2D,
  options: TransformOptions
): void {
  if (options.opacity !== undefined && options.opacity !== 1) {
    ctx.globalAlpha = options.opacity;
  }

  if (options.blur !== undefined && options.blur > 0) {
    ctx.filter = `blur(${options.blur}px)`;
  }

  if (options.rotation !== undefined && options.rotation !== 0) {
    applyRotation(ctx, options.x, options.y, options.rotation);
  }
}

/**
 * Wrapper for save/apply/draw/restore pattern
 */
export function withTransform(
  ctx: CanvasRenderingContext2D,
  options: TransformOptions,
  drawFn: () => void
): void {
  ctx.save();
  applyTransformOptions(ctx, options);
  drawFn();
  ctx.restore();
}

// ============================================
// SHAPE RENDERING
// ============================================

/**
 * Draw a rectangle shape
 */
export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  fill: boolean,
  stroke: boolean
): void {
  const x = centerX - width / 2;
  const y = centerY - height / 2;

  if (fill) {
    ctx.fillRect(x, y, width, height);
  }
  if (stroke) {
    ctx.strokeRect(x, y, width, height);
  }
}

/**
 * Draw an ellipse shape
 */
export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  fill: boolean,
  stroke: boolean
): void {
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);

  if (fill) {
    ctx.fill();
  }
  if (stroke) {
    ctx.stroke();
  }
}

/**
 * Draw a line shape
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number
): void {
  ctx.beginPath();
  ctx.moveTo(centerX - width / 2, centerY);
  ctx.lineTo(centerX + width / 2, centerY);
  ctx.stroke();
}

/**
 * Draw an arrow shape
 */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number
): void {
  const arrowSize = Math.min(width, height) * 0.2;

  // Arrow shaft
  ctx.beginPath();
  ctx.moveTo(centerX - width / 2, centerY);
  ctx.lineTo(centerX + width / 2 - arrowSize, centerY);
  ctx.stroke();

  // Arrow head
  ctx.beginPath();
  ctx.moveTo(centerX + width / 2, centerY);
  ctx.lineTo(centerX + width / 2 - arrowSize, centerY - arrowSize / 2);
  ctx.lineTo(centerX + width / 2 - arrowSize, centerY + arrowSize / 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * Check if a fill color is visible (not fully transparent)
 * Handles 8-character hex codes where last 2 chars are alpha (00 = transparent)
 */
export function hasVisibleFill(fillColor: string): boolean {
  if (!fillColor) return false;

  // Check for 8-character hex with alpha (e.g., #ff000000)
  // Only consider it transparent if it's exactly 9 chars (#xxxxxxxx) and ends with 00
  if (fillColor.length === 9 && fillColor.startsWith('#') && fillColor.endsWith('00')) {
    return false;
  }

  return true;
}

/**
 * Draw a shape with all styling options
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  options: ShapeRenderOptions
): void {
  const {
    type,
    centerX,
    centerY,
    width,
    height,
    fillColor,
    strokeColor,
    strokeWidth,
    rotation = 0,
    opacity = 1,
    blur = 0,
  } = options;

  // Skip blur-type shapes (they only affect underlying content)
  if (type === 'blur') {
    return;
  }

  ctx.save();

  // Apply transform options
  if (opacity !== 1) {
    ctx.globalAlpha = opacity;
  }
  if (blur > 0) {
    ctx.filter = `blur(${blur}px)`;
  }
  if (rotation !== 0) {
    applyRotation(ctx, centerX, centerY, rotation);
  }

  // Set styles
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  const fill = hasVisibleFill(fillColor);
  const stroke = strokeWidth > 0;

  // Draw based on type
  switch (type) {
    case 'rectangle':
      drawRectangle(ctx, centerX, centerY, width, height, fill, stroke);
      break;
    case 'ellipse':
      drawEllipse(ctx, centerX, centerY, width, height, fill, stroke);
      break;
    case 'line':
      drawLine(ctx, centerX, centerY, width);
      break;
    case 'arrow':
      drawArrow(ctx, centerX, centerY, width, height);
      break;
  }

  ctx.restore();
}

// ============================================
// TEXT RENDERING
// ============================================

/**
 * Build a canvas font string from options
 */
export function buildFontString(
  fontSize: number,
  fontFamily: string,
  fontWeight: 'normal' | 'bold' = 'normal',
  fontStyle: 'normal' | 'italic' = 'normal'
): string {
  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
}

/**
 * Draw text with background
 */
export function drawTextWithBackground(
  ctx: CanvasRenderingContext2D,
  options: TextRenderOptions
): void {
  const {
    text,
    x,
    y,
    fontFamily,
    fontSize,
    fontWeight = 'normal',
    fontStyle = 'normal',
    color,
    backgroundColor,
    textAlign,
    rotation = 0,
    opacity = 1,
    blur = 0,
  } = options;

  ctx.save();

  // Apply transform
  if (opacity !== 1) {
    ctx.globalAlpha = opacity;
  }
  if (blur > 0) {
    ctx.filter = `blur(${blur}px)`;
  }
  if (rotation !== 0) {
    applyRotation(ctx, x, y, rotation);
  }

  // Set font
  ctx.font = buildFontString(fontSize, fontFamily, fontWeight, fontStyle);
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';

  // Draw background if specified
  if (backgroundColor && hasVisibleFill(backgroundColor)) {
    const metrics = ctx.measureText(text);
    const padding = fontSize * 0.2;
    const bgWidth = metrics.width + padding * 2;
    const bgHeight = fontSize * 1.4;

    let bgX = x - padding;
    if (textAlign === 'center') {
      bgX = x - bgWidth / 2;
    } else if (textAlign === 'right') {
      bgX = x - bgWidth + padding;
    }

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
  }

  // Draw text
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  ctx.restore();
}

// ============================================
// IMAGE/VIDEO RENDERING
// ============================================

export interface MediaDrawOptions {
  source: CanvasImageSource;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  transform: TransformOptions & { scaleX: number; scaleY: number };
  blendMode?: BlendMode;
}

/**
 * Calculate position and size for drawing media on canvas
 */
export function calculateMediaPosition(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  transform: { x: number; y: number; scaleX: number; scaleY: number }
): { x: number; y: number; width: number; height: number } {
  const aspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let baseWidth: number;
  let baseHeight: number;

  if (aspect > canvasAspect) {
    baseWidth = canvasWidth;
    baseHeight = canvasWidth / aspect;
  } else {
    baseHeight = canvasHeight;
    baseWidth = canvasHeight * aspect;
  }

  const scaledWidth = baseWidth * transform.scaleX;
  const scaledHeight = baseHeight * transform.scaleY;

  const x = (canvasWidth - scaledWidth) * transform.x;
  const y = (canvasHeight - scaledHeight) * transform.y;

  return { x, y, width: scaledWidth, height: scaledHeight };
}

/**
 * Draw media (image/video) to canvas with transforms
 */
export function drawMedia(
  ctx: CanvasRenderingContext2D,
  options: MediaDrawOptions
): void {
  const { source, canvasWidth, canvasHeight, sourceWidth, sourceHeight, transform, blendMode = 'normal' } = options;

  const { x, y, width, height } = calculateMediaPosition(
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
    transform
  );

  ctx.save();

  // Set blend mode
  ctx.globalCompositeOperation = blendModeToCanvas[blendMode];

  // Apply transforms
  if (transform.opacity !== undefined && transform.opacity !== 1) {
    ctx.globalAlpha = transform.opacity;
  }
  if (transform.blur !== undefined && transform.blur > 0) {
    ctx.filter = `blur(${transform.blur}px)`;
  }
  if (transform.rotation !== undefined && transform.rotation !== 0) {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    applyRotation(ctx, centerX, centerY, transform.rotation);
  }

  ctx.drawImage(source, x, y, width, height);

  ctx.restore();
}
