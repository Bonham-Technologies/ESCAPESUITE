// On-device translation: the browser's Translator and Language Detector APIs
// (ESCSUITE-473).
//
// "Translate captions" turns a caption track into a second one in another
// language with the browser's own translation model, on this device. Chrome
// ships these APIs from version 138 on desktop and downloads a model the
// first time a site uses a language pair. ESCAPEARTIST ships no model and
// fetches none; the browser downloads its own from its own vendor, and only
// after the user has confirmed a notice (see `TranslateControl`).
//
// Nothing here runs on load. `getTranslatorCtor` is static detection — it
// reads properties and calls nothing — and is all the control does on mount.
// Every call into the API comes from a press. As a precaution the speech
// feature's brand gate applies too: a bare Chromium embedder (Electron, CEF,
// the headless shell) that exposes the Blink half of an on-device AI API
// without the browser-side service behind it is not asked at all
// (`isBareChromiumEmbedder`, `on-device-transcription.md`).
//
// None of this is in lib.dom yet, so the shapes are typed here from Chrome's
// documentation and the Writing Assistance APIs draft, and every member is
// feature-detected.

import { isBareChromiumEmbedder } from './speechRecognitionLocal';

/** `availability()`'s answer, for both APIs. */
export type ModelAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

export interface TranslatorLanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

/** The `downloadprogress` event: `loaded` is the fraction downloaded, 0 to 1. */
export interface DownloadProgressLike {
  readonly loaded: number;
}

/** What `create()`'s `monitor` callback is handed. */
export interface CreateMonitorLike {
  addEventListener(type: 'downloadprogress', listener: (event: DownloadProgressLike) => void): void;
}

export interface TranslatorLike {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?: () => void;
}

export interface TranslatorCtor {
  availability(options: TranslatorLanguagePair): Promise<string>;
  create(
    options: TranslatorLanguagePair & { monitor?: (monitor: CreateMonitorLike) => void; signal?: AbortSignal }
  ): Promise<TranslatorLike>;
}

export interface LanguageDetectionLike {
  readonly detectedLanguage: string;
  readonly confidence: number;
}

export interface LanguageDetectorLike {
  detect(text: string, options?: { signal?: AbortSignal }): Promise<readonly LanguageDetectionLike[]>;
  destroy?: () => void;
}

export interface LanguageDetectorCtor {
  availability(options?: object): Promise<string>;
  create(options?: { signal?: AbortSignal }): Promise<LanguageDetectorLike>;
}

type TranslatorWindow = {
  Translator?: unknown;
  LanguageDetector?: unknown;
  navigator?: { userAgentData?: { brands?: readonly { brand: string }[] } };
};

function hasStatics(candidate: unknown): boolean {
  if (candidate === null || (typeof candidate !== 'function' && typeof candidate !== 'object')) return false;
  const ctor = candidate as { availability?: unknown; create?: unknown };
  return typeof ctor.availability === 'function' && typeof ctor.create === 'function';
}

/**
 * The browser's `Translator`, or `null` where there is none (every browser but
 * desktop Chrome 138+ today) or in a bare Chromium embedder. Static detection
 * only: reads properties, calls nothing, so it is safe on mount.
 */
export function getTranslatorCtor(win: TranslatorWindow = globalThis as TranslatorWindow): TranslatorCtor | null {
  if (!('Translator' in win) || isBareChromiumEmbedder(win)) return null;
  return hasStatics(win.Translator) ? (win.Translator as TranslatorCtor) : null;
}

/** The browser's `LanguageDetector`, on the same terms as {@link getTranslatorCtor}. */
export function getLanguageDetectorCtor(
  win: TranslatorWindow = globalThis as TranslatorWindow
): LanguageDetectorCtor | null {
  if (!('LanguageDetector' in win) || isBareChromiumEmbedder(win)) return null;
  return hasStatics(win.LanguageDetector) ? (win.LanguageDetector as LanguageDetectorCtor) : null;
}

function normaliseAvailability(answer: unknown): ModelAvailability {
  return answer === 'available' || answer === 'downloading' || answer === 'downloadable' ? answer : 'unavailable';
}

/**
 * Whether the browser can translate `pair` on this device: its own answer, or
 * `'unavailable'` when there is no API, the call fails (a Permissions-Policy
 * that disallows `translator`, a tag it does not know) or the answer is not
 * one of the four the API names.
 */
export async function probeTranslation(pair: TranslatorLanguagePair, win?: TranslatorWindow): Promise<ModelAvailability> {
  const ctor = getTranslatorCtor(win);
  if (!ctor) return 'unavailable';
  try {
    return normaliseAvailability(await ctor.availability({ ...pair }));
  } catch {
    return 'unavailable';
  }
}

/**
 * Create a translator for `pair`. Where the model has to be downloaded the
 * browser downloads it now, from its own vendor, and `onProgress` hears the
 * fraction done (0 to 1). The browser requires a user gesture for that, so a
 * caller that shows the download notice calls this straight from the
 * confirm button's click, before anything else is awaited.
 */
export function createTranslator(
  pair: TranslatorLanguagePair,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  win?: TranslatorWindow
): Promise<TranslatorLike> {
  const ctor = getTranslatorCtor(win);
  if (!ctor) return Promise.reject(new Error('This browser cannot translate on this device.'));
  try {
    return ctor.create({
      ...pair,
      ...(signal ? { signal } : {}),
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const loaded = Number(event?.loaded);
          if (Number.isFinite(loaded)) onProgress?.(Math.min(1, Math.max(0, loaded)));
        });
      },
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The least confidence a detection needs to be offered as the captions' language. */
export const DETECTION_MIN_CONFIDENCE = 0.5;

/**
 * The language `text` is most likely in, or `null`. Asked only when the
 * detector's model is **already** installed (`availability()` answers
 * `available`): detecting a language is a convenience, so it never makes the
 * browser download anything. A guess under {@link DETECTION_MIN_CONFIDENCE},
 * `und` (undetermined), any failure and no API all answer `null`.
 */
export async function detectLanguage(
  text: string,
  { signal }: { signal?: AbortSignal } = {},
  win?: TranslatorWindow
): Promise<string | null> {
  const ctor = getLanguageDetectorCtor(win);
  if (!ctor || !text.trim()) return null;
  let detector: LanguageDetectorLike | null = null;
  try {
    if (normaliseAvailability(await ctor.availability()) !== 'available') return null;
    detector = await ctor.create(signal ? { signal } : undefined);
    const [best] = await detector.detect(text, signal ? { signal } : undefined);
    if (!best || typeof best.detectedLanguage !== 'string' || best.detectedLanguage === 'und') return null;
    return best.confidence >= DETECTION_MIN_CONFIDENCE ? best.detectedLanguage : null;
  } catch {
    return null;
  } finally {
    detector?.destroy?.();
  }
}
