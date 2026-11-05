// ESCSUITE-404: the on-device speech probe. Only a recogniser with the
// on-device mode counts, and every question put to the browser carries
// `processLocally: true`.
import { describe, it, expect, vi } from 'vitest';
import {
  getLocalRecognitionCtor,
  installLocalLanguagePack,
  localSpeechOptions,
  probeLocalRecognition,
  transcriptionLanguage,
} from './speechRecognitionLocal';

function makeCtor(statics: { available?: unknown; install?: unknown }, withProcessLocally = true) {
  function Recognition() {}
  if (withProcessLocally) Object.defineProperty(Recognition.prototype, 'processLocally', { value: false, writable: true });
  Object.assign(Recognition, statics);
  return Recognition;
}

describe('getLocalRecognitionCtor (ESCSUITE-404)', () => {
  it('is null with no SpeechRecognition at all (Firefox before 160)', () => {
    expect(getLocalRecognitionCtor({})).toBeNull();
  });

  it("is null for a recogniser without the on-device statics (Safari's prefixed one, Chrome before 139)", () => {
    const webkitSpeechRecognition = makeCtor({});
    expect(getLocalRecognitionCtor({ webkitSpeechRecognition })).toBeNull();
  });

  it('is null when instances have no processLocally', () => {
    const SpeechRecognition = makeCtor({ available: vi.fn(), install: vi.fn() }, false);
    expect(getLocalRecognitionCtor({ SpeechRecognition })).toBeNull();
  });

  it('is null for a non-function global', () => {
    expect(getLocalRecognitionCtor({ SpeechRecognition: {} })).toBeNull();
  });

  it('takes the unprefixed constructor, or the prefixed one when it has the on-device mode', () => {
    const SpeechRecognition = makeCtor({ available: vi.fn(), install: vi.fn() });
    expect(getLocalRecognitionCtor({ SpeechRecognition })).toBe(SpeechRecognition);
    const webkitSpeechRecognition = makeCtor({ available: vi.fn(), install: vi.fn() });
    expect(getLocalRecognitionCtor({ webkitSpeechRecognition })).toBe(webkitSpeechRecognition);
  });
});

describe('getLocalRecognitionCtor: the brand gate (ESCSUITE-404)', () => {
  // A bare Chromium embedder (Electron, CEF, Playwright's headless shell) has
  // the API in Blink but not Chrome's browser-side service, and available()
  // kills its renderer, so it must not see the on-device mode at all.
  const GREASE = { brand: 'Not_A Brand', version: '8' };
  const withBrands = (brands: Array<{ brand: string; version: string }> | undefined) => ({
    SpeechRecognition: makeCtor({ available: vi.fn(), install: vi.fn() }),
    navigator: brands === undefined ? {} : { userAgentData: { brands } },
  });

  it.each([
    ['Google Chrome', [{ brand: 'Google Chrome', version: '139' }, GREASE, { brand: 'Chromium', version: '139' }]],
    ['Microsoft Edge', [{ brand: 'Chromium', version: '139' }, { brand: 'Microsoft Edge', version: '139' }, GREASE]],
    ['Opera', [GREASE, { brand: 'Chromium', version: '139' }, { brand: 'Opera', version: '123' }]],
    ['Brave', [{ brand: 'Brave', version: '139' }, { brand: 'Chromium', version: '139' }, GREASE]],
  ])('allows %s', (_label, brands) => {
    const win = withBrands(brands);
    expect(getLocalRecognitionCtor(win)).toBe(win.SpeechRecognition);
  });

  it.each([
    ['Electron or full Chromium (Chromium only)', [{ brand: 'Chromium', version: '139' }, GREASE]],
    ["Playwright's headless shell (HeadlessChrome)", [{ brand: 'HeadlessChrome', version: '153' }, GREASE, { brand: 'Chromium', version: '153' }]],
  ])('is null in %s, and never touches the API', (_label, brands) => {
    const win = withBrands(brands);
    const ctor = win.SpeechRecognition as unknown as { available: ReturnType<typeof vi.fn> };
    expect(getLocalRecognitionCtor(win)).toBeNull();
    expect(ctor.available).not.toHaveBeenCalled();
  });

  it('does not gate without userAgentData (Firefox, Safari, a non-secure context) or without a Chromium brand', () => {
    const absent = withBrands(undefined);
    expect(getLocalRecognitionCtor(absent)).toBe(absent.SpeechRecognition);
    const greaseOnly = withBrands([GREASE]);
    expect(getLocalRecognitionCtor(greaseOnly)).toBe(greaseOnly.SpeechRecognition);
  });

  it('makes probe and install answer as if there were no API, without calling it', async () => {
    const win = withBrands([{ brand: 'Chromium', version: '139' }, GREASE]);
    const ctor = win.SpeechRecognition as unknown as { available: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> };
    await expect(probeLocalRecognition('en-US', win)).resolves.toBe('unavailable');
    await expect(installLocalLanguagePack('en-US', win)).resolves.toBe(false);
    expect(ctor.available).not.toHaveBeenCalled();
    expect(ctor.install).not.toHaveBeenCalled();
  });
});

describe('probeLocalRecognition (ESCSUITE-404)', () => {
  it('asks available() for the one language, on device only', async () => {
    const available = vi.fn().mockResolvedValue('downloadable');
    const SpeechRecognition = makeCtor({ available, install: vi.fn() });
    await expect(probeLocalRecognition('de-DE', { SpeechRecognition })).resolves.toBe('downloadable');
    expect(available).toHaveBeenCalledWith({ langs: ['de-DE'], processLocally: true });
  });

  it.each(['available', 'downloading', 'downloadable', 'unavailable'] as const)('passes %s through', async (answer) => {
    const SpeechRecognition = makeCtor({ available: vi.fn().mockResolvedValue(answer), install: vi.fn() });
    await expect(probeLocalRecognition('en-US', { SpeechRecognition })).resolves.toBe(answer);
  });

  it('reads an answer the spec does not name, a rejection, or no API as unavailable', async () => {
    const odd = makeCtor({ available: vi.fn().mockResolvedValue('maybe'), install: vi.fn() });
    await expect(probeLocalRecognition('en-US', { SpeechRecognition: odd })).resolves.toBe('unavailable');
    const blocked = makeCtor({ available: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')), install: vi.fn() });
    await expect(probeLocalRecognition('en-US', { SpeechRecognition: blocked })).resolves.toBe('unavailable');
    await expect(probeLocalRecognition('en-US', {})).resolves.toBe('unavailable');
    const fine = makeCtor({ available: vi.fn().mockResolvedValue('available'), install: vi.fn() });
    await expect(probeLocalRecognition('', { SpeechRecognition: fine })).resolves.toBe('unavailable');
  });
});

describe('installLocalLanguagePack (ESCSUITE-404)', () => {
  it('asks install() on device only and reports its answer', async () => {
    const install = vi.fn().mockResolvedValue(true);
    const SpeechRecognition = makeCtor({ available: vi.fn(), install });
    await expect(installLocalLanguagePack('fr-FR', { SpeechRecognition })).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith({ langs: ['fr-FR'], processLocally: true });
  });

  it('is false when the install fails, rejects or there is no API', async () => {
    const no = makeCtor({ available: vi.fn(), install: vi.fn().mockResolvedValue(false) });
    await expect(installLocalLanguagePack('en-US', { SpeechRecognition: no })).resolves.toBe(false);
    const throws = makeCtor({ available: vi.fn(), install: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(installLocalLanguagePack('en-US', { SpeechRecognition: throws })).resolves.toBe(false);
    await expect(installLocalLanguagePack('en-US', {})).resolves.toBe(false);
  });
});

describe('the options and the language', () => {
  it('always carry processLocally: true', () => {
    expect(localSpeechOptions('en-GB')).toEqual({ langs: ['en-GB'], processLocally: true });
  });

  it("is the browser's language, en-US when it has none", () => {
    expect(transcriptionLanguage({ language: 'nl-NL' })).toBe('nl-NL');
    expect(transcriptionLanguage({ language: '' })).toBe('en-US');
    expect(transcriptionLanguage(undefined)).toBe('en-US');
  });
});
