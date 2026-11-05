// On-device speech recognition: the feature probe (ESCSUITE-404).
//
// This module is in the main bundle on purpose and is kept tiny: it only asks
// the browser whether it can recognise speech **on this device**. Everything
// that transcribes lives in `core/transcribe.ts`, which the editor reaches
// with a dynamic `import()` the first time someone asks to transcribe.
//
// The Web Speech API sends audio to the browser vendor's servers unless
// `processLocally` is true (Chrome's default is a Google server). ESCAPEARTIST
// only ever uses the on-device mode: `available()` and `install()` are asked
// with `processLocally: true`, and `core/transcribe.ts` is the one place that
// constructs a recogniser and refuses one that does not read back
// `processLocally === true`. There is no cloud fallback.
//
// None of this is in lib.dom yet, so the shapes are typed here from the Web
// Speech API spec and MDN, and every member is feature-detected.

/** `SpeechRecognition.available()`'s answer. */
export type LocalSpeechAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

/** The options `available()` and `install()` take. ESCAPEARTIST always passes `processLocally: true`. */
export interface LocalSpeechOptions {
  langs: string[];
  processLocally: true;
}

/** The slice of a `SpeechRecognitionResultList` ESCAPEARTIST reads. */
export interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: {
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: { readonly transcript: string };
  };
}

export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}

export interface SpeechErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

/** The slice of a `SpeechRecognition` instance ESCAPEARTIST uses. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}

/** The `SpeechRecognition` constructor, with the two static methods on-device recognition added. */
export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  available?: (options: LocalSpeechOptions) => Promise<string>;
  install?: (options: LocalSpeechOptions) => Promise<boolean>;
  readonly prototype: object;
}

type SpeechWindow = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

/**
 * The browser's `SpeechRecognition` constructor, but only when it supports the
 * on-device mode: a static `available()` and `install()` and a
 * `processLocally` property. `null` anywhere else — Safari's prefixed
 * recogniser, which has none of these, included.
 */
export function getLocalRecognitionCtor(win: SpeechWindow = globalThis as SpeechWindow): SpeechRecognitionCtor | null {
  for (const candidate of [win.SpeechRecognition, win.webkitSpeechRecognition]) {
    if (typeof candidate !== 'function') continue;
    const ctor = candidate as SpeechRecognitionCtor;
    if (typeof ctor.available !== 'function' || typeof ctor.install !== 'function') continue;
    if (!ctor.prototype || !('processLocally' in ctor.prototype)) continue;
    return ctor;
  }
  return null;
}

/** The options for `lang`, always on device. */
export function localSpeechOptions(lang: string): LocalSpeechOptions {
  return { langs: [lang], processLocally: true };
}

/**
 * Whether `lang` can be recognised on this device: the browser's own answer,
 * or `'unavailable'` when there is no on-device mode, the call fails (a
 * Permissions-Policy that disallows `on-device-speech-recognition`, an
 * invalid tag) or the answer is not one of the four the spec names.
 */
export async function probeLocalRecognition(
  lang: string,
  win?: SpeechWindow
): Promise<LocalSpeechAvailability> {
  const ctor = getLocalRecognitionCtor(win);
  if (!ctor || !lang) return 'unavailable';
  try {
    const answer = await ctor.available!(localSpeechOptions(lang));
    return answer === 'available' || answer === 'downloading' || answer === 'downloadable' ? answer : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Ask the browser to install `lang`'s on-device language pack. The browser
 * downloads it from its own vendor; ESCAPEARTIST fetches nothing. `true` once
 * the pack is installed (or already was), `false` if it could not be.
 */
export async function installLocalLanguagePack(lang: string, win?: SpeechWindow): Promise<boolean> {
  const ctor = getLocalRecognitionCtor(win);
  if (!ctor) return false;
  try {
    return (await ctor.install!(localSpeechOptions(lang))) === true;
  } catch {
    return false;
  }
}

/** The language the editor transcribes in: the browser's own, as a BCP 47 tag. */
export function transcriptionLanguage(nav: { language?: string } | undefined = globalThis.navigator): string {
  return nav?.language || 'en-US';
}
