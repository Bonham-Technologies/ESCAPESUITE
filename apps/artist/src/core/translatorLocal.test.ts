// The Translator / Language Detector probe (ESCSUITE-473): static detection,
// the brand gate, and every call normalised or caught.
import { describe, it, expect, vi } from 'vitest'
import {
  createTranslator,
  detectLanguage,
  getLanguageDetectorCtor,
  getTranslatorCtor,
  probeTranslation,
  type CreateMonitorLike,
} from './translatorLocal'

const pair = { sourceLanguage: 'en', targetLanguage: 'es' }
const chrome = { userAgentData: { brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }] } }
const electron = { userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Not_A Brand' }] } }
const translatorWith = (more: Record<string, unknown> = {}) => ({
  availability: vi.fn(async () => 'available'),
  create: vi.fn(async () => ({ translate: async (t: string) => t })),
  ...more,
})

describe('getTranslatorCtor / getLanguageDetectorCtor', () => {
  it('finds a Translator with availability() and create(), and calls neither', () => {
    const Translator = translatorWith()
    expect(getTranslatorCtor({ Translator, navigator: chrome })).toBe(Translator)
    expect(getTranslatorCtor({ Translator })).toBe(Translator)
    expect(Translator.availability).not.toHaveBeenCalled()
    expect(Translator.create).not.toHaveBeenCalled()
  })

  it('answers null with no API, an incomplete one, or in a bare Chromium embedder', () => {
    expect(getTranslatorCtor({})).toBeNull()
    expect(getTranslatorCtor({ Translator: undefined })).toBeNull()
    expect(getTranslatorCtor({ Translator: null })).toBeNull()
    expect(getTranslatorCtor({ Translator: { availability() {} } })).toBeNull()
    expect(getTranslatorCtor({ Translator: translatorWith(), navigator: electron })).toBeNull()
    expect(getLanguageDetectorCtor({})).toBeNull()
    expect(getLanguageDetectorCtor({ LanguageDetector: translatorWith(), navigator: electron })).toBeNull()
    const LanguageDetector = translatorWith()
    expect(getLanguageDetectorCtor({ LanguageDetector })).toBe(LanguageDetector)
  })
})

describe('probeTranslation', () => {
  it.each(['available', 'downloadable', 'downloading', 'unavailable'])('passes on %s', async (answer) => {
    const Translator = translatorWith({ availability: vi.fn(async () => answer) })
    expect(await probeTranslation(pair, { Translator })).toBe(answer)
    expect(Translator.availability).toHaveBeenCalledWith(pair)
  })

  it('reads anything else, a failure and no API as unavailable', async () => {
    expect(await probeTranslation(pair, { Translator: translatorWith({ availability: async () => 'readily' }) })).toBe('unavailable')
    expect(await probeTranslation(pair, { Translator: translatorWith({ availability: async () => { throw new Error('policy') } }) })).toBe('unavailable')
    expect(await probeTranslation(pair, {})).toBe('unavailable')
  })
})

describe('createTranslator', () => {
  it('creates with a monitor that reports download progress, clamped, and passes the signal', async () => {
    const translator = { translate: async (t: string) => t }
    const create = vi.fn(async (options: { monitor?: (m: CreateMonitorLike) => void }) => {
      options.monitor?.({
        addEventListener: (_type, listener) => {
          for (const loaded of [0, 0.5, 1.2, Number.NaN]) listener({ loaded })
        },
      })
      return translator
    })
    const onProgress = vi.fn()
    const signal = new AbortController().signal
    await expect(createTranslator(pair, { onProgress, signal }, { Translator: translatorWith({ create }) })).resolves.toBe(translator)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ ...pair, signal }))
    expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0, 0.5, 1])
  })

  it('rejects with no API, and when create() throws synchronously', async () => {
    await expect(createTranslator(pair, {}, {})).rejects.toThrow('cannot translate')
    const create = () => {
      throw new Error('sync')
    }
    await expect(createTranslator(pair, undefined, { Translator: translatorWith({ create }) })).rejects.toThrow('sync')
  })
})

describe('detectLanguage', () => {
  const detectorWith = (availability: string, results: unknown, destroy = vi.fn()) => {
    const detect = vi.fn(async () => results)
    const create = vi.fn(async () => ({ detect, destroy }))
    return { LanguageDetector: { availability: vi.fn(async () => availability), create }, detect, create, destroy }
  }

  it('answers the best guess from an installed model, and lets it go', async () => {
    const d = detectorWith('available', [{ detectedLanguage: 'fr', confidence: 0.8 }, { detectedLanguage: 'en', confidence: 0.1 }])
    expect(await detectLanguage('Bonjour', {}, d)).toBe('fr')
    expect(d.destroy).toHaveBeenCalled()
  })

  it('never creates a detector whose model would have to be downloaded', async () => {
    for (const answer of ['downloadable', 'downloading', 'unavailable']) {
      const d = detectorWith(answer, [])
      expect(await detectLanguage('Bonjour', {}, d)).toBeNull()
      expect(d.create).not.toHaveBeenCalled()
    }
  })

  it('answers null for a weak guess, und, nothing, an error, blank text or no API', async () => {
    expect(await detectLanguage('x', {}, detectorWith('available', [{ detectedLanguage: 'fr', confidence: 0.2 }]))).toBeNull()
    expect(await detectLanguage('x', {}, detectorWith('available', [{ detectedLanguage: 'und', confidence: 0.9 }]))).toBeNull()
    expect(await detectLanguage('x', {}, detectorWith('available', []))).toBeNull()
    const failing = { LanguageDetector: { availability: async () => 'available', create: async () => { throw new Error('x') } } }
    expect(await detectLanguage('x', {}, failing)).toBeNull()
    expect(await detectLanguage('   ', {}, detectorWith('available', [{ detectedLanguage: 'fr', confidence: 1 }]))).toBeNull()
    expect(await detectLanguage('x', {}, {})).toBeNull()
  })

  it('passes a signal through', async () => {
    const d = detectorWith('available', [{ detectedLanguage: 'de', confidence: 0.9 }])
    const signal = new AbortController().signal
    expect(await detectLanguage('Hallo', { signal }, d)).toBe('de')
    expect(d.create).toHaveBeenCalledWith({ signal })
    expect(d.detect).toHaveBeenCalledWith('Hallo', { signal })
  })
})
