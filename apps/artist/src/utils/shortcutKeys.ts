/**
 * How a shortcut hint names the chord modifier (ESCSUITE-491).
 *
 * Every chord the editor binds answers Ctrl *or* Cmd (`e.ctrlKey ||
 * e.metaKey`, `app/useAppKeyboardShortcuts.ts`), so the key a hint should name
 * is the platform's own: ⌘ on Apple platforms, Ctrl everywhere else. Text a
 * screen reader reads spells it out instead (Command, Control): a glyph or an
 * abbreviation is not a word every reader pronounces.
 *
 * Pure functions with the platform passed in, so a test can render both; the
 * components call `currentShortcutPlatform()` at render.
 */

/** The two spellings a hint can take. */
export type ShortcutPlatform = 'apple' | 'other';

/** The parts of `navigator` this reads; `userAgentData` is not in TypeScript's DOM lib. */
export interface PlatformNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * macOS, iOS and iPadOS by name. iPadOS 13+ reports itself as a Mac
 * (`MacIntel`, "Macintosh") in both `navigator.platform` and the user agent,
 * which is the answer wanted here: an iPad's keyboard has ⌘ too.
 */
const APPLE = /mac|iphone|ipad|ipod/i;

/**
 * Which spelling this browser's platform takes. Reads, in order, the one that
 * answers first: `navigator.userAgentData.platform` (Chromium's, e.g.
 * `"macOS"`), `navigator.platform` (deprecated but in every engine, e.g.
 * `"MacIntel"`), then the user-agent string. No navigator at all (a worker
 * test, the headless kit) is `'other'`.
 */
export function shortcutPlatform(nav: PlatformNavigator | undefined): ShortcutPlatform {
  if (!nav) return 'other';
  const named = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return APPLE.test(named) ? 'apple' : 'other';
}

/** This browser's spelling, read from the live `navigator`. */
export function currentShortcutPlatform(): ShortcutPlatform {
  return shortcutPlatform(typeof navigator === 'undefined' ? undefined : navigator);
}

/** The modifier as a hint shows it: `⌘` or `Ctrl`. */
export function modifierKey(platform: ShortcutPlatform): string {
  return platform === 'apple' ? '⌘' : 'Ctrl';
}

/** The modifier as a screen reader should say it: `Command` or `Control`. */
export function modifierKeyName(platform: ShortcutPlatform): string {
  return platform === 'apple' ? 'Command' : 'Control';
}

/**
 * A modifier chord as a hint shows it: `⌘Z` on Apple platforms (written the
 * way macOS's own menus write it, with no plus) and `Ctrl+Z` elsewhere.
 */
export function chordLabel(key: string, platform: ShortcutPlatform): string {
  return platform === 'apple' ? `${modifierKey(platform)}${key}` : `${modifierKey(platform)}+${key}`;
}

/** A modifier chord spelled out for a screen reader: `Command+Z` or `Control+Z`. */
export function chordSpoken(key: string, platform: ShortcutPlatform): string {
  return `${modifierKeyName(platform)}+${key}`;
}
