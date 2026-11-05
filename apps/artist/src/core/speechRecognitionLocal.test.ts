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
