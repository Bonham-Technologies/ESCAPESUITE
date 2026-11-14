// The spoken language "Transcribe to captions" listens for (ESCSUITE-444).
//
// It used to be the browser's own language, always, so a recording in any
// other language could not be transcribed. The control now offers a select
// beside its button: the browser's own language first, then a short fixed
// list. The choice is remembered in `localStorage`, like the editor's other
// layout preferences, and quietly forgotten where storage is blocked.
//
// Nothing here touches the speech API: offering a language is not a promise
// the browser can recognise it. `available()` is still asked only when the
// button is pressed, for the chosen language (`speechRecognitionLocal.ts`).

/** The `localStorage` key the chosen language is remembered under. */
export const TRANSCRIPTION_LANGUAGE_KEY = 'escapeartist-transcription-language';

/**
 * The languages offered besides the browser's own, as BCP 47 tags, in the
 * order of their English names. Kept short on purpose: widely spoken
 * languages for which Chrome offers on-device speech language packs. Whether
 * one can be had in this browser is the browser's answer on the press.
 */
export const TRANSCRIPTION_LANGUAGES = [
  'zh-CN',
  'nl-NL',
  'en-GB',
  'en-US',
  'fr-FR',
  'de-DE',
  'hi-IN',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pl-PL',
  'pt-BR',
  'es-ES',
] as const;

/** Whether `tag` is one of `TRANSCRIPTION_LANGUAGES`. */
export function isListedTranscriptionLanguage(tag: string): boolean {
  return (TRANSCRIPTION_LANGUAGES as readonly string[]).includes(tag);
}

/** `value` as a canonical BCP 47 tag (`EN-us` → `en-US`), or `null` when it is not one. */
export function canonicalLanguageTag(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const [tag] = Intl.getCanonicalLocales(value);
    return tag ?? null;
  } catch {
    return null;
  }
}

/** `tag`'s name in English, "Language (Region)", or the tag itself where the browser cannot name it. */
export function languageName(tag: string): string {
  const DisplayNames = (globalThis.Intl as { DisplayNames?: typeof Intl.DisplayNames } | undefined)?.DisplayNames;
  if (typeof DisplayNames !== 'function') return tag;
  try {
    return new DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(tag) || tag;
  } catch {
    return tag;
  }
}

/**
 * The notice shown before the browser downloads a language pack (ESCSUITE-404,
 * owner-approved wording), naming the chosen language (ESCSUITE-444).
 */
export function languagePackNotice(language: string): string {
  return `Your browser will download a speech language pack for ${language} once. Your audio never leaves this device.`;
}

/**
 * The select's options: the browser's own language and the chosen one, each
 * only if the fixed list does not have it, then the list. Every tag once.
 */
export function transcriptionLanguageOptions(chosen: string, browserLanguage: string): string[] {
  const listed = new Set<string>(TRANSCRIPTION_LANGUAGES);
  const extras: string[] = [];
  for (const value of [browserLanguage, chosen]) {
    const tag = canonicalLanguageTag(value);
    if (tag && !listed.has(tag) && !extras.includes(tag)) extras.push(tag);
  }
  return [...extras, ...TRANSCRIPTION_LANGUAGES];
}

/** The remembered language, or `null` when none is (or storage cannot be read). */
export function readStoredTranscriptionLanguage(): string | null {
  try {
    return canonicalLanguageTag(localStorage.getItem(TRANSCRIPTION_LANGUAGE_KEY));
  } catch {
    return null;
  }
}

/** Remember `tag` for next time; where storage is blocked it lasts until the editor closes. */
export function storeTranscriptionLanguage(tag: string): void {
  try {
    localStorage.setItem(TRANSCRIPTION_LANGUAGE_KEY, tag);
  } catch {
    // Blocked storage (a sandboxed frame, some private windows): not remembered.
  }
}
