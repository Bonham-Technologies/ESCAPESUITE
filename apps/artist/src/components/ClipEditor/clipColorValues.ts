// Hex-with-alpha string maths for ClipEditor's color controls.
//
// A shape's fill color is stored as an 8- or 9-character hex string (`#rrggbb`
// plus an optional 2-digit alpha), and the `<input type="color">` element only
// ever speaks 6-digit hex — so every control that touches fill color has to
// split the alpha off, or fold a new one back in. Pure string-and-number
// functions, so the splitting and folding is tested directly rather than
// through the inputs that trigger it. `hasVisibleFill` itself stays imported
// from `core/canvasRenderer`, the single place that decides what "visible"
// means.
import { hasVisibleFill } from '../../core/canvasRenderer';

/** Clamp a font-size input to a sane minimum, falling back to 48 if it doesn't parse. */
export function clampFontSize(raw: string): number {
  return Math.max(8, parseInt(raw) || 48);
}

/** A text background color at its fixed 80% (`cc`) opacity. */
export function withBackgroundAlpha(rgb: string): string {
  return rgb + 'cc';
}

/** A new fill color's rgb with the existing color's alpha carried over. */
export function withFillRgb(fillColor: string, rgb: string): string {
  const currentAlpha = fillColor.length > 7 ? fillColor.substring(7) : 'ff';
  return rgb + currentAlpha;
}

/** Flip a fill between fully transparent and 50% opacity, keeping its rgb. */
export function toggleFill(fillColor: string): string {
  if (hasVisibleFill(fillColor)) {
    // Set to no fill (0% opacity)
    return fillColor.substring(0, 7) + '00';
  }
  // Re-enable fill with 50% opacity
  return fillColor.substring(0, 7) + '80';
}

/** A fill color's alpha channel as a rounded 0-100 percentage. */
export function fillAlphaPercent(fillColor: string): number {
  return Math.round(parseInt(fillColor.substring(7) || 'ff', 16) / 255 * 100);
}

/** A fill color with its alpha channel replaced by a 0-100 percentage. */
export function withFillAlphaPercent(fillColor: string, percent: number): string {
  const alpha = Math.round(percent / 100 * 255).toString(16).padStart(2, '0');
  return fillColor.substring(0, 7) + alpha;
}
