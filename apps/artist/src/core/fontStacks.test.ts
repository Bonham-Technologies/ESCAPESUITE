import { describe, expect, it } from 'vitest';
import { FONT_OPTIONS, FONT_STACKS, fontStackFor, textFontString } from './fontStacks';

describe('fontStacks', () => {
  it('maps every offered family to a stack that starts with it and ends in a generic', () => {
    expect(FONT_OPTIONS.map((o) => o.value)).toEqual(Object.keys(FONT_STACKS));
    for (const { value, stack } of FONT_OPTIONS) {
      expect(fontStackFor(value)).toBe(stack);
      expect(stack.replace(/'/g, '').startsWith(value)).toBe(true);
      expect(stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it.each([
    ['Arial', 'Arial, Helvetica, sans-serif'],
    ['Helvetica', 'Helvetica, Arial, sans-serif'],
    ['Times New Roman', "'Times New Roman', Times, serif"],
    ['Georgia', "Georgia, 'Times New Roman', serif"],
    ['Verdana', 'Verdana, Geneva, sans-serif'],
    ['Courier New', "'Courier New', Courier, monospace"],
    ['Impact', "Impact, 'Arial Black', sans-serif"],
  ])('%s -> %s', (family, stack) => {
    expect(fontStackFor(family)).toBe(stack);
  });

  it('puts sans-serif behind an unknown family', () => {
    expect(fontStackFor('Inter')).toBe('Inter, sans-serif');
  });

  it('quotes an unknown family that has a space in it', () => {
    expect(fontStackFor('Open Sans')).toBe("'Open Sans', sans-serif");
  });

  it('does not re-quote a family that is already quoted or comma-separated', () => {
    expect(fontStackFor("'Open Sans'")).toBe("'Open Sans', sans-serif");
    expect(fontStackFor('Inter, serif')).toBe('Inter, serif, sans-serif');
  });

  it('builds the canvas font string with style, weight, size and stack', () => {
    expect(textFontString({ fontStyle: 'italic', fontWeight: 'bold', fontSize: 32, fontFamily: 'Georgia' })).toBe(
      "italic bold 32px Georgia, 'Times New Roman', serif",
    );
    expect(textFontString({ fontStyle: 'normal', fontWeight: 'normal', fontSize: 20, fontFamily: 'Impact' })).toBe(
      "20px Impact, 'Arial Black', sans-serif",
    );
  });
});
