// clipColorValues on its own: hex-with-alpha string maths, no component.
//
// `#rrggbb` plus an optional 2-digit alpha suffix is the shape every case
// below manipulates, matching the strings ClipEditor's color inputs and
// shape fill data actually hold.
import { describe, it, expect } from 'vitest';
import {
  clampFontSize,
  withBackgroundAlpha,
  withFillRgb,
  toggleFill,
  fillAlphaPercent,
  withFillAlphaPercent,
} from './clipColorValues';

describe('clampFontSize', () => {
  it('parses a normal numeric string', () => {
    expect(clampFontSize('24')).toBe(24);
  });

  it('parses "250" as-is above the floor (no upper clamp here)', () => {
    expect(clampFontSize('250')).toBe(250);
  });

  it('falls back to 48 for an empty string', () => {
    expect(clampFontSize('')).toBe(48);
  });

  it('parses a single digit below the floor and clamps to 8', () => {
    expect(clampFontSize('4')).toBe(8);
  });

  it('falls back to 48 for a non-numeric string', () => {
    expect(clampFontSize('abc')).toBe(48);
  });

  it('is unaffected by a value already above the floor', () => {
    expect(clampFontSize('9')).toBe(9);
  });
});

describe('withBackgroundAlpha', () => {
  it('appends the fixed cc alpha suffix', () => {
    expect(withBackgroundAlpha('#112233')).toBe('#112233cc');
  });
});

describe('withFillRgb', () => {
  it('carries over the existing 2-digit alpha suffix', () => {
    expect(withFillRgb('#000000ff', '#ff0000')).toBe('#ff0000ff');
  });

  it('falls back to ff when the existing color has no alpha suffix', () => {
    expect(withFillRgb('#000000', '#00ff00')).toBe('#00ff00ff');
  });

  it('carries over a transparent (00) alpha suffix', () => {
    expect(withFillRgb('#00000000', '#0000ff')).toBe('#0000ff00');
  });
});

describe('toggleFill', () => {
  it('turns a visible six-digit opaque color transparent', () => {
    expect(toggleFill('#ff0000')).toBe('#ff000000');
  });

  it('turns a visible 8-digit fill color transparent', () => {
    expect(toggleFill('#ff0000ff')).toBe('#ff000000');
  });

  it('re-enables a fully transparent fill at 50% opacity', () => {
    expect(toggleFill('#00000000')).toBe('#00000080');
  });
});

describe('fillAlphaPercent', () => {
  it('is 100 for a fully opaque (ff) alpha', () => {
    expect(fillAlphaPercent('#ff0000ff')).toBe(100);
  });

  it('is 0 for a fully transparent (00) alpha', () => {
    expect(fillAlphaPercent('#00000000')).toBe(0);
  });

  it('falls back to ff (100%) when the color has no alpha suffix (six-digit, opaque)', () => {
    expect(fillAlphaPercent('#ff0000')).toBe(100);
  });

  it('rounds a mid alpha to the nearest percent', () => {
    // 0x80 / 255 * 100 = 50.196... -> rounds to 50
    expect(fillAlphaPercent('#ff000080')).toBe(50);
  });
});

describe('withFillAlphaPercent', () => {
  it('encodes 100% as an ff alpha suffix', () => {
    expect(withFillAlphaPercent('#ff0000ff', 100)).toBe('#ff0000ff');
  });

  it('encodes 0% as a 00 alpha suffix', () => {
    expect(withFillAlphaPercent('#ff0000ff', 0)).toBe('#ff000000');
  });

  it('pads a single hex digit alpha to two digits', () => {
    // 1% of 255 rounds to 3 (0x03), which toString(16) gives as a single char
    expect(withFillAlphaPercent('#ff0000ff', 1)).toBe('#ff000003');
  });

  it('discards any existing alpha suffix on the input color, keeping only the rgb', () => {
    expect(withFillAlphaPercent('#ff000080', 100)).toBe('#ff0000ff');
  });
});
