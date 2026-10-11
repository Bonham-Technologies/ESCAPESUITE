// The one place a text overlay's family becomes a CSS font-family list.
//
// The inspector stores a bare family name ("Georgia") so saved projects keep
// their `fontFamily`. A bare name with no generic fallback renders in whatever
// the machine picks when it lacks the font — on the headless kit's Linux image
// that was an unrelated CJK face for Georgia, Verdana and Impact (ESCSUITE-253).
// Every reader — the preview, both exporters, the selection measurements and
// the headless bundle — builds its canvas `font` through `textFontString`, so
// one table covers all of them.

export interface FontOption {
  /** Stored in `textData.fontFamily`. */
  value: string;
  /** Shown in the inspector's select. */
  label: string;
  /** The CSS font-family list the canvas is given. */
  stack: string;
}

export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'Arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { value: 'Helvetica', label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif' },
  { value: 'Times New Roman', label: 'Times', stack: "'Times New Roman', Times, serif" },
  { value: 'Georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { value: 'Verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { value: 'Courier New', label: 'Courier', stack: "'Courier New', Courier, monospace" },
  { value: 'Impact', label: 'Impact', stack: "Impact, 'Arial Black', sans-serif" },
];

export const FONT_STACKS: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.map((option) => [option.value, option.stack]),
);

/** The stack for a stored family; an unknown one gets `sans-serif` behind it. */
export function fontStackFor(family: string): string {
  const known = FONT_STACKS[family];
  if (known) return known;
  // No name at all (an emptied or blank field): the generic alone, not ", sans-serif".
  if (!family.trim()) return 'sans-serif';
  // A bare name with a space in it needs quotes; one that is already quoted or
  // carries a comma is left as the author wrote it, with the generic behind it.
  const needsQuotes = /^[^,'"]*\s[^,'"]*$/.test(family);
  return needsQuotes ? `'${family}', sans-serif` : `${family}, sans-serif`;
}

interface TextFontFields {
  fontStyle?: string;
  fontWeight?: string;
  fontSize: number;
  fontFamily: string;
}

/** The canvas `font` string for a text overlay. */
export function textFontString(textData: TextFontFields): string {
  const style = textData.fontStyle === 'italic' ? 'italic ' : '';
  const weight = textData.fontWeight === 'bold' ? 'bold ' : '';
  return `${style}${weight}${textData.fontSize}px ${fontStackFor(textData.fontFamily)}`;
}
