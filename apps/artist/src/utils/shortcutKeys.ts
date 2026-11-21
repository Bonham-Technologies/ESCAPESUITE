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

/**
 * Letters whose ⌘ chord macOS or the browser keeps for itself, so a page never
 * sees it: ⌘H hides the app, ⌘M minimises the window, ⌘Q quits, and ⌘W, ⌘N,
 * ⌘T close a tab or open a window or tab. The cascade answers Ctrl as well
 * (`e.ctrlKey || e.metaKey`), and a Mac's Control chord does reach the page,
 * so on Apple platforms a hint for one of these names Control (`⌃M`) instead
 * of ⌘. Of these the cascade binds only M (go to previous marker).
 */
const APPLE_KEEPS_COMMAND = new Set(['h', 'm', 'q', 'w', 'n', 't']);

/** On this platform, is `key`'s chord pressed with Control because ⌘ is taken? */
function controlOnApple(platform: ShortcutPlatform, key: string | undefined): boolean {
  return platform === 'apple' && key !== undefined && APPLE_KEEPS_COMMAND.has(key.toLowerCase());
}

/**
 * The modifier as a hint shows it: `⌘` or `Ctrl`. Given the chord's letter, a
 * chord macOS keeps for itself shows `⌃` (Control) on Apple platforms.
 */
export function modifierKey(platform: ShortcutPlatform, key?: string): string {
  if (controlOnApple(platform, key)) return '⌃';
  return platform === 'apple' ? '⌘' : 'Ctrl';
}

/**
 * The modifier as a screen reader should say it: `Command` or `Control`; a
 * chord macOS keeps for itself says `Control` on Apple platforms too.
 */
export function modifierKeyName(platform: ShortcutPlatform, key?: string): string {
  if (controlOnApple(platform, key)) return 'Control';
  return platform === 'apple' ? 'Command' : 'Control';
}

/**
 * A modifier chord as a hint shows it: `⌘Z` on Apple platforms (written the
 * way macOS's own menus write it, with no plus; `⌃M` for a chord macOS keeps)
 * and `Ctrl+Z` elsewhere.
 */
export function chordLabel(key: string, platform: ShortcutPlatform): string {
  return platform === 'apple' ? `${modifierKey(platform, key)}${key}` : `${modifierKey(platform, key)}+${key}`;
}

/** A modifier chord spelled out for a screen reader: `Command+Z` or `Control+Z`. */
export function chordSpoken(key: string, platform: ShortcutPlatform): string {
  return `${modifierKeyName(platform, key)}+${key}`;
}
