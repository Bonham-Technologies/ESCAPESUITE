import { describe, it, expect, vi } from 'vitest';
import {
  applyRotation,
  applyTransformOptions,
  blendModeToCanvas,
  buildFontString,
  calculateMediaPosition,
  drawArrow,
  drawEllipse,
  drawLine,
  drawMedia,
  drawRectangle,
  drawShape,
  drawTextWithBackground,
  hasVisibleFill,
  withTransform,
} from './canvasUtils';
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas';

/**
 * A recording 2D context. Everything drawn is kept in order in `calls`, so a
 * test can assert what was drawn and in what sequence rather than only that
 * some stub was poked.
 */
function ctx2d(): RecordingCanvasRenderingContext2D & CanvasRenderingContext2D {
  return createRecordingContext() as unknown as RecordingCanvasRenderingContext2D &
    CanvasRenderingContext2D;
}

const methodsOf = (ctx: RecordingCanvasRenderingContext2D) => ctx.calls.map((c) => c.method);

describe('canvasUtils', () => {
  describe('blendModeToCanvas', () => {
    it('maps every blend mode to a canvas composite operation', () => {
      expect(blendModeToCanvas).toEqual({
        normal: 'source-over',
        multiply: 'multiply',
        screen: 'screen',
        overlay: 'overlay',
        darken: 'darken',
        lighten: 'lighten',
        difference: 'difference',
        add: 'lighter',
      });
    });
  });

  describe('applyRotation', () => {
    it('applies rotation transform around center point', () => {
      const ctx = ctx2d();
      applyRotation(ctx, 100, 100, 45);

      expect(ctx.translate).toHaveBeenCalledTimes(2);
      expect(ctx.translate).toHaveBeenNthCalledWith(1, 100, 100);
      expect(ctx.translate).toHaveBeenNthCalledWith(2, -100, -100);
      expect(ctx.rotate).toHaveBeenCalledWith((45 * Math.PI) / 180);
      // Translate to the pivot, rotate, translate back — in that order.
      expect(methodsOf(ctx)).toEqual(['translate', 'rotate', 'translate']);
    });

    it('does nothing for zero rotation', () => {
      const ctx = ctx2d();
      applyRotation(ctx, 100, 100, 0);
      expect(ctx.calls).toEqual([]);
    });
  });

  describe('applyTransformOptions', () => {
    it('applies opacity, blur and rotation together', () => {
      const ctx = ctx2d();
      applyTransformOptions(ctx, { x: 10, y: 20, opacity: 0.25, blur: 4, rotation: 90 });

      expect(ctx.globalAlpha).toBe(0.25);
      expect(ctx.filter).toBe('blur(4px)');
      expect(ctx.translate).toHaveBeenNthCalledWith(1, 10, 20);
      expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    });

    it('leaves the context untouched for the identity transform', () => {
      const ctx = ctx2d();
      applyTransformOptions(ctx, { x: 0, y: 0, opacity: 1, blur: 0, rotation: 0 });

      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.filter).toBe('none');
      expect(ctx.calls).toEqual([]);
    });

    it('leaves the context untouched when the options are all absent', () => {
      const ctx = ctx2d();
      applyTransformOptions(ctx, { x: 0, y: 0 });

      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.filter).toBe('none');
      expect(ctx.calls).toEqual([]);
    });
  });

  describe('withTransform', () => {
    it('brackets the draw between save and restore, with the transform applied first', () => {
      const ctx = ctx2d();
      const draw = vi.fn(() => {
        ctx.fillRect(0, 0, 1, 1);
      });

      withTransform(ctx, { x: 5, y: 5, rotation: 180, opacity: 0.5 }, draw);

      expect(draw).toHaveBeenCalledTimes(1);
      expect(methodsOf(ctx)).toEqual(['save', 'translate', 'rotate', 'translate', 'fillRect', 'restore']);
      expect(ctx.globalAlpha).toBe(0.5);
    });
  });

  describe('hasVisibleFill', () => {
    it('returns true for opaque colors', () => {
      expect(hasVisibleFill('#ff0000')).toBe(true);
      expect(hasVisibleFill('#ff0000ff')).toBe(true);
      expect(hasVisibleFill('rgba(255,0,0,1)')).toBe(true);
    });

    it('returns false for transparent colors', () => {
      expect(hasVisibleFill('#ff000000')).toBe(false);
      expect(hasVisibleFill('')).toBe(false);
    });

    it('only treats a 9-character #-prefixed value ending in 00 as transparent', () => {
      // Right length and suffix but no leading '#'
      expect(hasVisibleFill('ff0000000')).toBe(true);
      // Leading '#' and 00 suffix but the wrong length
      expect(hasVisibleFill('#ff0000')).toBe(true);
      expect(hasVisibleFill('rgba(0,0,0,0.00')).toBe(true);
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
    it('calculates position for a source matching the canvas aspect', () => {
      const result = calculateMediaPosition(1920, 1080, 1920, 1080, {
        x: 0.5,
        y: 0.5,
        scaleX: 1,
        scaleY: 1,
      });

      expect(result).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });

    it('fits a source wider than the canvas to the canvas width', () => {
      const result = calculateMediaPosition(1000, 1000, 2000, 500, {
        x: 0.5,
        y: 0.5,
        scaleX: 1,
        scaleY: 1,
      });

      expect(result.width).toBe(1000);
      expect(result.height).toBe(250);
      expect(result.y).toBe(375); // (1000 - 250) * 0.5
    });

    it('fits a source taller than the canvas to the canvas height', () => {
      const result = calculateMediaPosition(1000, 1000, 500, 2000, {
        x: 0.5,
        y: 0.5,
        scaleX: 1,
        scaleY: 1,
      });

      expect(result.height).toBe(1000);
      expect(result.width).toBe(250);
      expect(result.x).toBe(375);
    });

    it('calculates position with scale', () => {
      const result = calculateMediaPosition(1920, 1080, 1920, 1080, {
        x: 0.5,
        y: 0.5,
        scaleX: 0.5,
        scaleY: 0.5,
      });

      expect(result.width).toBe(960);
      expect(result.height).toBe(540);
      expect(result.x).toBe(480); // (1920 - 960) * 0.5
      expect(result.y).toBe(270); // (1080 - 540) * 0.5
    });

    it('anchors to the top-left at position 0,0', () => {
      const result = calculateMediaPosition(1920, 1080, 1920, 1080, {
        x: 0,
        y: 0,
        scaleX: 0.5,
        scaleY: 0.5,
      });

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('drawRectangle', () => {
    it('draws filled rectangle', () => {
      const ctx = ctx2d();
      drawRectangle(ctx, 100, 100, 50, 30, true, false);

      expect(ctx.fillRect).toHaveBeenCalledWith(75, 85, 50, 30);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it('draws stroked rectangle', () => {
      const ctx = ctx2d();
      drawRectangle(ctx, 100, 100, 50, 30, false, true);

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalledWith(75, 85, 50, 30);
    });

    it('draws both fill and stroke', () => {
      const ctx = ctx2d();
      drawRectangle(ctx, 100, 100, 50, 30, true, true);

      expect(methodsOf(ctx)).toEqual(['fillRect', 'strokeRect']);
    });
  });

  describe('drawEllipse', () => {
    it('draws ellipse path', () => {
      const ctx = ctx2d();
      drawEllipse(ctx, 100, 100, 50, 30, true, true);

      expect(ctx.ellipse).toHaveBeenCalledWith(100, 100, 25, 15, 0, 0, Math.PI * 2);
      expect(methodsOf(ctx)).toEqual(['beginPath', 'ellipse', 'fill', 'stroke']);
    });

    it('skips fill and stroke when neither is requested', () => {
      const ctx = ctx2d();
      drawEllipse(ctx, 100, 100, 50, 30, false, false);

      expect(methodsOf(ctx)).toEqual(['beginPath', 'ellipse']);
    });
  });

  describe('drawLine', () => {
    it('strokes a horizontal line centred on the given point', () => {
      const ctx = ctx2d();
      drawLine(ctx, 100, 40, 60);

      expect(ctx.moveTo).toHaveBeenCalledWith(70, 40);
      expect(ctx.lineTo).toHaveBeenCalledWith(130, 40);
      expect(methodsOf(ctx)).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke']);
    });
  });

  describe('drawArrow', () => {
    it('strokes a shaft and fills a head sized from the smaller dimension', () => {
      const ctx = ctx2d();
      drawArrow(ctx, 100, 50, 100, 40);

      // arrowSize = min(100, 40) * 0.2 = 8
      expect(ctx.argsFor('moveTo')).toEqual([
        [50, 50], // shaft start
        [150, 50], // head tip
      ]);
      expect(ctx.argsFor('lineTo')).toEqual([
        [142, 50], // shaft end, short of the tip by arrowSize
        [142, 46],
        [142, 54],
      ]);
      expect(methodsOf(ctx)).toEqual([
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'beginPath',
        'moveTo',
        'lineTo',
        'lineTo',
        'closePath',
        'fill',
      ]);
    });
  });

  describe('drawShape', () => {
    const base = {
      centerX: 100,
      centerY: 100,
      width: 50,
      height: 30,
      fillColor: '#ff0000',
      strokeColor: '#000000',
      strokeWidth: 2,
    } as const;

    it('sets styles and brackets the draw in save/restore', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base });

      expect(ctx.fillStyle).toBe('#ff0000');
      expect(ctx.strokeStyle).toBe('#000000');
      expect(ctx.lineWidth).toBe(2);
      expect(methodsOf(ctx)).toEqual(['save', 'fillRect', 'strokeRect', 'restore']);
    });

    it('applies opacity', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base, strokeWidth: 0, opacity: 0.5 });
      expect(ctx.globalAlpha).toBe(0.5);
    });

    it('applies blur filter', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base, strokeWidth: 0, blur: 5 });
      expect(ctx.filter).toBe('blur(5px)');
    });

    it('applies rotation around the shape centre', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base, rotation: 30 });

      expect(ctx.translate).toHaveBeenNthCalledWith(1, 100, 100);
      expect(ctx.rotate).toHaveBeenCalledWith((30 * Math.PI) / 180);
    });

    it('omits the fill when the fill colour is fully transparent', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base, fillColor: '#ff000000' });

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
    });

    it('omits the stroke when the stroke width is zero', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'rectangle', ...base, strokeWidth: 0 });

      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it('dispatches to the ellipse renderer', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'ellipse', ...base });
      expect(ctx.ellipse).toHaveBeenCalledWith(100, 100, 25, 15, 0, 0, Math.PI * 2);
    });

    it('dispatches to the line renderer', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'line', ...base });
      expect(ctx.argsFor('moveTo')).toEqual([[75, 100]]);
      expect(ctx.argsFor('lineTo')).toEqual([[125, 100]]);
    });

    it('dispatches to the arrow renderer', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'arrow', ...base });
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
    });

    it('skips blur-type shapes entirely', () => {
      const ctx = ctx2d();
      drawShape(ctx, { type: 'blur', ...base });
      expect(ctx.calls).toEqual([]);
    });
  });

  describe('drawTextWithBackground', () => {
    const base = {
      text: 'Hello',
      x: 200,
      y: 100,
      fontFamily: 'Arial',
      fontSize: 20,
      fontWeight: 'bold',
      fontStyle: 'italic',
      color: '#ffffff',
      textAlign: 'left',
    } as const;

    it('sets the font and draws the text, bracketed by save/restore', () => {
      const ctx = ctx2d();
      drawTextWithBackground(ctx, { ...base });

      expect(ctx.font).toBe('italic bold 20px Arial');
      expect(ctx.textAlign).toBe('left');
      expect(ctx.textBaseline).toBe('middle');
      expect(ctx.fillStyle).toBe('#ffffff');
      expect(ctx.argsFor('fillText')).toEqual([['Hello', 200, 100]]);
      expect(methodsOf(ctx)).toEqual(['save', 'fillText', 'restore']);
    });

    it('draws a left-aligned background box behind the text', () => {
      const ctx = ctx2d();
      ctx.measuredTextWidth = 100;
      drawTextWithBackground(ctx, { ...base, backgroundColor: '#000000' });

      // padding = 4, bgWidth = 108, bgHeight = 28
      expect(ctx.argsFor('fillRect')).toEqual([[196, 86, 108, 28]]);
      // Background first, then the glyphs on top.
      expect(methodsOf(ctx)).toEqual(['save', 'measureText', 'fillRect', 'fillText', 'restore']);
    });

    it('centres the background box for centred text', () => {
      const ctx = ctx2d();
      ctx.measuredTextWidth = 100;
      drawTextWithBackground(ctx, { ...base, textAlign: 'center', backgroundColor: '#000000' });

      expect(ctx.argsFor('fillRect')).toEqual([[146, 86, 108, 28]]);
    });

    it('right-aligns the background box for right-aligned text', () => {
      const ctx = ctx2d();
      ctx.measuredTextWidth = 100;
      drawTextWithBackground(ctx, { ...base, textAlign: 'right', backgroundColor: '#000000' });

      expect(ctx.argsFor('fillRect')).toEqual([[96, 86, 108, 28]]);
    });

    it('skips the background box when the background colour is transparent', () => {
      const ctx = ctx2d();
      drawTextWithBackground(ctx, { ...base, backgroundColor: '#00000000' });

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.measureText).not.toHaveBeenCalled();
    });

    it('applies opacity, blur and rotation', () => {
      const ctx = ctx2d();
      drawTextWithBackground(ctx, { ...base, opacity: 0.4, blur: 3, rotation: 45 });

      expect(ctx.globalAlpha).toBe(0.4);
      expect(ctx.filter).toBe('blur(3px)');
      expect(ctx.translate).toHaveBeenNthCalledWith(1, 200, 100);
      expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    });
  });

  describe('drawMedia', () => {
    const source = {} as CanvasImageSource;

    it('draws the source at the calculated position with the blend mode applied', () => {
      const ctx = ctx2d();
      drawMedia(ctx, {
        source,
        canvasWidth: 1920,
        canvasHeight: 1080,
        sourceWidth: 1920,
        sourceHeight: 1080,
        transform: { x: 0.5, y: 0.5, scaleX: 0.5, scaleY: 0.5 },
        blendMode: 'screen',
      });

      expect(ctx.globalCompositeOperation).toBe('screen');
      expect(ctx.argsFor('drawImage')).toEqual([[source, 480, 270, 960, 540]]);
      expect(methodsOf(ctx)).toEqual(['save', 'drawImage', 'restore']);
    });

    it('defaults to the normal blend mode', () => {
      const ctx = ctx2d();
      drawMedia(ctx, {
        source,
        canvasWidth: 100,
        canvasHeight: 100,
        sourceWidth: 100,
        sourceHeight: 100,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
      });

      expect(ctx.globalCompositeOperation).toBe('source-over');
    });

    it('applies opacity, blur and rotation about the drawn rect centre', () => {
      const ctx = ctx2d();
      drawMedia(ctx, {
        source,
        canvasWidth: 200,
        canvasHeight: 200,
        sourceWidth: 200,
        sourceHeight: 200,
        transform: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, opacity: 0.3, blur: 2, rotation: 90 },
      });

      expect(ctx.globalAlpha).toBe(0.3);
      expect(ctx.filter).toBe('blur(2px)');
      // Drawn rect is 100x100 at (0,0), so the pivot is its centre.
      expect(ctx.translate).toHaveBeenNthCalledWith(1, 50, 50);
      expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    });

    it('leaves alpha, filter and rotation alone for an identity transform', () => {
      const ctx = ctx2d();
      drawMedia(ctx, {
        source,
        canvasWidth: 100,
        canvasHeight: 100,
        sourceWidth: 100,
        sourceHeight: 100,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, blur: 0, rotation: 0 },
      });

      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.filter).toBe('none');
      expect(ctx.translate).not.toHaveBeenCalled();
    });
  });
});
