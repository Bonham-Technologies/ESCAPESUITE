import { describe, it, expect, vi } from 'vitest';
import {
  blendModeToCanvas,
  applyRotation,
  hasVisibleFill,
  buildFontString,
  calculateMediaPosition,
  drawShape,
  drawRectangle,
  drawEllipse,
} from './canvasUtils';

// Mock canvas context
function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 })),
    drawImage: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

describe('canvasUtils', () => {
  describe('blendModeToCanvas', () => {
    it('maps all blend modes correctly', () => {
      expect(blendModeToCanvas.normal).toBe('source-over');
      expect(blendModeToCanvas.multiply).toBe('multiply');
      expect(blendModeToCanvas.screen).toBe('screen');
      expect(blendModeToCanvas.overlay).toBe('overlay');
      expect(blendModeToCanvas.add).toBe('lighter');
    });
  });

  describe('applyRotation', () => {
    it('applies rotation transform around center point', () => {
      const ctx = createMockContext();
      applyRotation(ctx, 100, 100, 45);

      expect(ctx.translate).toHaveBeenCalledTimes(2);
      expect(ctx.translate).toHaveBeenNthCalledWith(1, 100, 100);
      expect(ctx.translate).toHaveBeenNthCalledWith(2, -100, -100);
      expect(ctx.rotate).toHaveBeenCalledWith((45 * Math.PI) / 180);
    });

    it('does nothing for zero rotation', () => {
      const ctx = createMockContext();
      applyRotation(ctx, 100, 100, 0);

      expect(ctx.translate).not.toHaveBeenCalled();
      expect(ctx.rotate).not.toHaveBeenCalled();
    });
  });

  describe('hasVisibleFill', () => {
    it('returns true for opaque colors', () => {
      // 6-char hex without alpha - doesn't end in '00'
      expect(hasVisibleFill('#ff0000')).toBe(true);
      // 8-char hex with full opacity (ff)
      expect(hasVisibleFill('#ff0000ff')).toBe(true);
      // rgba format (string doesn't end in '00')
      expect(hasVisibleFill('rgba(255,0,0,1)')).toBe(true);
    });

    it('returns false for transparent colors', () => {
      // 8-char hex with zero alpha
      expect(hasVisibleFill('#ff000000')).toBe(false);
      // Empty string
      expect(hasVisibleFill('')).toBe(false);
    });
  });

  describe('buildFontString', () => {
    it('builds correct font string', () => {
      expect(buildFontString(16, 'Arial')).toBe('normal normal 16px Arial');
      expect(buildFontString(24, 'Helvetica', 'bold')).toBe('normal bold 24px Helvetica');
      expect(buildFontString(18, 'Times', 'normal', 'italic')).toBe('italic normal 18px Times');
      expect(buildFontString(20, 'Georgia', 'bold', 'italic')).toBe('italic bold 20px Georgia');
    });
  });

  describe('calculateMediaPosition', () => {
    it('calculates position for wider source', () => {
      const result = calculateMediaPosition(
        1920, 1080, // canvas
        1920, 1080, // source (same aspect)
        { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1 }
      );

      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('calculates position with scale', () => {
      const result = calculateMediaPosition(
        1920, 1080,
        1920, 1080,
        { x: 0.5, y: 0.5, scaleX: 0.5, scaleY: 0.5 }
      );

      expect(result.width).toBe(960);
      expect(result.height).toBe(540);
      expect(result.x).toBe(480); // (1920 - 960) * 0.5
      expect(result.y).toBe(270); // (1080 - 540) * 0.5
    });

    it('calculates position with offset', () => {
      const result = calculateMediaPosition(
        1920, 1080,
        1920, 1080,
        { x: 0, y: 0, scaleX: 1, scaleY: 1 }
      );

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('drawRectangle', () => {
    it('draws filled rectangle', () => {
      const ctx = createMockContext();
      drawRectangle(ctx, 100, 100, 50, 30, true, false);

      expect(ctx.fillRect).toHaveBeenCalledWith(75, 85, 50, 30);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it('draws stroked rectangle', () => {
      const ctx = createMockContext();
      drawRectangle(ctx, 100, 100, 50, 30, false, true);

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalledWith(75, 85, 50, 30);
    });

    it('draws both fill and stroke', () => {
      const ctx = createMockContext();
      drawRectangle(ctx, 100, 100, 50, 30, true, true);

      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
    });
  });

  describe('drawEllipse', () => {
    it('draws ellipse path', () => {
      const ctx = createMockContext();
      drawEllipse(ctx, 100, 100, 50, 30, true, true);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.ellipse).toHaveBeenCalledWith(100, 100, 25, 15, 0, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe('drawShape', () => {
    it('saves and restores context', () => {
      const ctx = createMockContext();
      drawShape(ctx, {
        type: 'rectangle',
        centerX: 100,
        centerY: 100,
        width: 50,
        height: 30,
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 2,
      });

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('applies opacity', () => {
      const ctx = createMockContext();
      drawShape(ctx, {
        type: 'rectangle',
        centerX: 100,
        centerY: 100,
        width: 50,
        height: 30,
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 0,
        opacity: 0.5,
      });

      expect(ctx.globalAlpha).toBe(0.5);
    });

    it('applies blur filter', () => {
      const ctx = createMockContext();
      drawShape(ctx, {
        type: 'rectangle',
        centerX: 100,
        centerY: 100,
        width: 50,
        height: 30,
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 0,
        blur: 5,
      });

      expect(ctx.filter).toBe('blur(5px)');
    });

    it('skips blur-type shapes', () => {
      const ctx = createMockContext();
      drawShape(ctx, {
        type: 'blur',
        centerX: 100,
        centerY: 100,
        width: 50,
        height: 30,
        fillColor: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 0,
      });

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
    });
  });
});
