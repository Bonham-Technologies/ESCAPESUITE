// ESCSUITE-444: the spoken language "Transcribe to captions" listens for,
// chosen beside the button and remembered.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TRANSCRIPTION_LANGUAGES,
  TRANSCRIPTION_LANGUAGE_KEY,
  canonicalLanguageTag,
  languageName,
  readStoredTranscriptionLanguage,
  storeTranscriptionLanguage,
  transcriptionLanguageOptions,
} from './transcriptionLanguage';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('canonicalLanguageTag', () => {
  it('canonicalises a BCP 47 tag, and refuses anything that is not one', () => {
    expect(canonicalLanguageTag('EN-us')).toBe('en-US');
    expect(canonicalLanguageTag('de-DE')).toBe('de-DE');
    expect(canonicalLanguageTag('not a tag')).toBeNull();
    expect(canonicalLanguageTag('')).toBeNull();
    expect(canonicalLanguageTag(42)).toBeNull();
    expect(canonicalLanguageTag(null)).toBeNull();
  });
});

describe('languageName', () => {
  it('names a tag in English, language then region', () => {
    expect(languageName('en-US')).toBe('English (United States)');
    expect(languageName('ja-JP')).toBe('Japanese (Japan)');
    expect(languageName('sv-SE')).toBe('Swedish (Sweden)');
  });

  it('falls back to the tag itself where the browser cannot name it', () => {
    // Intl's members are not enumerable, so the stand-in inherits them.
    vi.stubGlobal('Intl', Object.assign(Object.create(Intl) as typeof Intl, { DisplayNames: undefined }));
    try {
      expect(languageName('de-DE')).toBe('de-DE');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the tag itself where naming it throws or answers nothing', () => {
    const throwing = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockImplementation(() => {
      throw new RangeError('bad tag');
    });
    expect(languageName('de-DE')).toBe('de-DE');
    throwing.mockImplementation(() => undefined);
    expect(languageName('de-DE')).toBe('de-DE');
  });
});

describe('transcriptionLanguageOptions', () => {
  it('is the fixed list when the browser speaks one of its languages', () => {
    expect(transcriptionLanguageOptions('en-US', 'en-US')).toEqual([...TRANSCRIPTION_LANGUAGES]);
  });

  it("puts the browser's own language first when the list does not have it", () => {
    expect(transcriptionLanguageOptions('sv-SE', 'sv-SE')).toEqual(['sv-SE', ...TRANSCRIPTION_LANGUAGES]);
  });

  it('keeps a remembered language the list does not have, after the browser’s own', () => {
    expect(transcriptionLanguageOptions('da-DK', 'sv-SE')).toEqual(['sv-SE', 'da-DK', ...TRANSCRIPTION_LANGUAGES]);
    expect(transcriptionLanguageOptions('da-DK', 'en-US')).toEqual(['da-DK', ...TRANSCRIPTION_LANGUAGES]);
  });

  it('lists every language once, whatever the case it came in', () => {
    const options = transcriptionLanguageOptions('DE-de', 'en-us');
    expect(options).toEqual([...TRANSCRIPTION_LANGUAGES]);
    expect(new Set(options).size).toBe(options.length);
  });

  it('is a small list of distinct, canonical BCP 47 tags', () => {
    expect(TRANSCRIPTION_LANGUAGES.length).toBeLessThanOrEqual(16);
    for (const tag of TRANSCRIPTION_LANGUAGES) expect(canonicalLanguageTag(tag)).toBe(tag);
    expect(new Set(TRANSCRIPTION_LANGUAGES).size).toBe(TRANSCRIPTION_LANGUAGES.length);
  });
});

describe('the remembered language', () => {
  it('is stored under its own key and read back', () => {
    expect(readStoredTranscriptionLanguage()).toBeNull();
    storeTranscriptionLanguage('ja-JP');
    expect(localStorage.getItem(TRANSCRIPTION_LANGUAGE_KEY)).toBe('ja-JP');
    expect(readStoredTranscriptionLanguage()).toBe('ja-JP');
  });

  it('ignores a stored value that is not a language tag', () => {
    localStorage.setItem(TRANSCRIPTION_LANGUAGE_KEY, 'not a tag');
    expect(readStoredTranscriptionLanguage()).toBeNull();
  });

  it('is forgotten quietly where storage is blocked (a sandboxed frame, a private window)', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readStoredTranscriptionLanguage()).toBeNull();
    expect(() => storeTranscriptionLanguage('fr-FR')).not.toThrow();
  });
});
