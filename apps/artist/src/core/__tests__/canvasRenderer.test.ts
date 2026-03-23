import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drawTextOverlayToCanvasAnimated } from '../canvasRenderer';
import type { TextOverlayData } from '../../store/types';
import type { AnimatedOverlayValues } from '../exportTypes';

function createMockCtx() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    font: '',
    textAlign: 'center' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    fillStyle: '',
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function createTextData(overrides: Partial<TextOverlayData> = {}): TextOverlayData {
  return {
    text: 'Hello',
    x: 0.5,
    y: 0.5,
    fontFamily: 'Arial',
    fontSize: 24,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#ffffff',
    backgroundColor: '#00000000',
    textAlign: 'center',
    ...overrides,
  };
}

function createAnimated(overrides: Partial<AnimatedOverlayValues> = {}): AnimatedOverlayValues {
  return {
    x: 0.5,
    y: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blur: 0,
    ...overrides,
  };
}

describe('drawTextOverlayToCanvasAnimated', () => {
  const canvasWidth = 1920;
  const canvasHeight = 1080;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('renders single line text with one fillText call', () => {
    const textData = createTextData({ text: 'Hello World' });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith(
      'Hello World',
      canvasWidth * 0.5,
      canvasHeight * 0.5
    );
  });

  it('renders multi-line text with one fillText call per line', () => {
    const textData = createTextData({ text: 'Line 1\nLine 2\nLine 3' });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('Line 1');
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('Line 2');
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[2][0]).toBe('Line 3');
  });

  it('spaces lines correctly by lineHeight (fontSize * 1.2)', () => {
    const fontSize = 24;
    const textData = createTextData({ text: 'Line 1\nLine 2\nLine 3', fontSize });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    const lineHeight = fontSize * 1.2;
    const totalHeight = 3 * lineHeight;
    const centerY = canvasHeight * 0.5;

    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    const expectedY0 = centerY - (totalHeight / 2) + (0 * lineHeight) + (lineHeight / 2);
    const expectedY1 = centerY - (totalHeight / 2) + (1 * lineHeight) + (lineHeight / 2);
    const expectedY2 = centerY - (totalHeight / 2) + (2 * lineHeight) + (lineHeight / 2);

    expect(calls[0][2]).toBeCloseTo(expectedY0);
    expect(calls[1][2]).toBeCloseTo(expectedY1);
    expect(calls[2][2]).toBeCloseTo(expectedY2);

    // Verify spacing between lines equals lineHeight
    expect(calls[1][2] - calls[0][2]).toBeCloseTo(lineHeight);
    expect(calls[2][2] - calls[1][2]).toBeCloseTo(lineHeight);
  });

  it('uses widest line for background rectangle width', () => {
    const textData = createTextData({
      text: 'Short\nA much longer line\nMed',
      backgroundColor: '#000000ff',
    });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    // measureText returns text.length * 10
    // 'A much longer line' is 18 chars = 180px (widest)
    const padding = textData.fontSize * 0.3;
    const expectedBgWidth = 180 + padding * 2;

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    const fillRectCall = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fillRectCall[2]).toBeCloseTo(expectedBgWidth); // width argument
  });

  it('background rectangle height encompasses all lines', () => {
    const fontSize = 24;
    const textData = createTextData({
      text: 'Line 1\nLine 2\nLine 3',
      fontSize,
      backgroundColor: '#000000ff',
    });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    const lineHeight = fontSize * 1.2;
    const totalHeight = 3 * lineHeight;
    const padding = fontSize * 0.3;
    const expectedBgHeight = totalHeight + padding * 2;

    const fillRectCall = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fillRectCall[3]).toBeCloseTo(expectedBgHeight); // height argument
  });

  it('handles empty lines from consecutive newlines', () => {
    const textData = createTextData({ text: 'First\n\nThird' });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('First');
    expect(calls[1][0]).toBe('');
    expect(calls[2][0]).toBe('Third');

    // All three lines should still be evenly spaced
    const lineHeight = textData.fontSize * 1.2;
    expect(calls[1][2] - calls[0][2]).toBeCloseTo(lineHeight);
    expect(calls[2][2] - calls[1][2]).toBeCloseTo(lineHeight);
  });

  it('single line text renders at the center Y position', () => {
    const textData = createTextData({ text: 'Single line' });
    const animated = createAnimated({ y: 0.5 });

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    // For single line: y - (lineHeight/2) + (lineHeight/2) = y
    expect(calls[0][2]).toBeCloseTo(canvasHeight * 0.5);
  });

  it('does not draw background when backgroundColor is transparent', () => {
    const textData = createTextData({ text: 'Line 1\nLine 2', backgroundColor: '#00000000' });
    const animated = createAnimated();

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('all lines use the same X position', () => {
    const textData = createTextData({ text: 'Line 1\nLine 2\nLine 3' });
    const animated = createAnimated({ x: 0.3 });

    drawTextOverlayToCanvasAnimated(ctx, textData, canvasWidth, canvasHeight, animated);

    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    const expectedX = canvasWidth * 0.3;
    expect(calls[0][1]).toBeCloseTo(expectedX);
    expect(calls[1][1]).toBeCloseTo(expectedX);
    expect(calls[2][1]).toBeCloseTo(expectedX);
  });
});
