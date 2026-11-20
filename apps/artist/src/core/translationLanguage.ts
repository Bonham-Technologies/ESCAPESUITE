// The languages "Translate captions" offers, and its wording (ESCSUITE-473).
//
// Nothing here touches the Translator API: offering a language promises
// nothing. Whether a pair can be translated on this device is the browser's
// answer to `Translator.availability()`, asked only on the press.

import { canonicalLanguageTag, languageName } from './transcriptionLanguage';

/** The `localStorage` key the chosen target language is remembered under. */
export const TRANSLATION_LANGUAGE_KEY = 'escapeartist-translation-language';

/**
 * The languages offered, as BCP 47 tags, in the order of their English names.
 * Kept short on purpose: widely used languages that Chrome's on-device
 * translation lists. Whether a pair can be had in this browser is its answer
 * on the press.
 */
export const TRANSLATION_LANGUAGES = [
  'ar',
  'zh',
  'zh-Hant',
  'nl',
  'en',
  'fr',
  'de',
  'hi',
  'it',
  'ja',
  'ko',
  'pl',
  'pt',
  'ru',
  'es',
  'tr',
  'uk',
  'vi',
] as const;

/**
 * `tag` as the Translator API is asked for it: the language alone (`en-US` →
 * `en`), but Chinese keeps its script (`zh-TW` and `zh-Hant-HK` → `zh-Hant`,
 * every other Chinese → `zh`), since the two are written differently. `null`
 * when `tag` is not a language tag.
 */
export function translatorLanguage(tag: string): string | null {
  const canonical = canonicalLanguageTag(tag);
  if (!canonical) return null;
  const [language, ...rest] = canonical.split('-');
  if (language !== 'zh') return language;
  const traditional = rest.some((part) => part === 'Hant' || part === 'TW' || part === 'HK' || part === 'MO');
  return traditional ? 'zh-Hant' : 'zh';
}

/** Whether two tags name the same language for translation (`en-US` and `en-GB` do). */
export function sameTranslationLanguage(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = translatorLanguage(a);
  return left !== null && left === translatorLanguage(b);
}

/** The options for a language select: `extras` (the tags the list lacks, each once), then the list. */
export function translationLanguageOptions(...extras: Array<string | null | undefined>): string[] {
  const listed = new Set<string>(TRANSLATION_LANGUAGES);
  const head: string[] = [];
  for (const value of extras) {
    const tag = value ? canonicalLanguageTag(value) : null;
    if (tag && !listed.has(tag) && !head.includes(tag)) head.push(tag);
  }
  return [...head, ...TRANSLATION_LANGUAGES];
}

/** The target offered first: English, or Spanish for a browser that is already in English. */
export function defaultTranslationTarget(browserLanguage: string): string {
  return translatorLanguage(browserLanguage) === 'en' ? 'es' : 'en';
}

/**
 * The notice shown before the browser downloads a translation model, naming
 * the pair. Worded after the transcription's language-pack notice
 * (`languagePackNotice`).
 */
export function translationModelNotice(source: string, target: string): string {
  return `Your browser will download a translation model for ${languageName(source)} to ${languageName(target)} once. Your captions never leave this device.`;
}

/** The name of the track a translation lands on: "Captions (Spanish)". */
export function translationTrackName(target: string): string {
  return `Captions (${languageName(target)})`;
}

/** The remembered target language, or `null` when none is (or storage cannot be read). */
export function readStoredTranslationLanguage(): string | null {
  try {
    return canonicalLanguageTag(localStorage.getItem(TRANSLATION_LANGUAGE_KEY));
  } catch {
    return null;
  }
}

/** Remember `tag` for next time; where storage is blocked it lasts until the editor closes. */
export function storeTranslationLanguage(tag: string): void {
  try {
    localStorage.setItem(TRANSLATION_LANGUAGE_KEY, tag);
  } catch {
    // Blocked storage (a sandboxed frame, some private windows): not remembered.
  }
}
