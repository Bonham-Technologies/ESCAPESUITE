// The languages and wording of "Translate captions" (ESCSUITE-473).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_KEY,
  defaultTranslationTarget,
  readStoredTranslationLanguage,
  sameTranslationLanguage,
  storeTranslationLanguage,
  translationLanguageOptions,
  translationModelNotice,
  translationTrackName,
  translatorLanguage,
} from './translationLanguage'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('translatorLanguage', () => {
  it.each([
    ['en-US', 'en'],
    ['EN-gb', 'en'],
    ['es', 'es'],
    ['pt-BR', 'pt'],
    ['zh-CN', 'zh'],
    ['zh', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-TW', 'zh-Hant'],
    ['zh-Hant-HK', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
  ])('%s → %s', (tag, expected) => expect(translatorLanguage(tag)).toBe(expected))

  it('answers null for what is not a tag', () => {
    expect(translatorLanguage('')).toBeNull()
    expect(translatorLanguage('not a tag!')).toBeNull()
  })
})

describe('sameTranslationLanguage', () => {
  it('matches regional variants and tells scripts apart', () => {
    expect(sameTranslationLanguage('en-US', 'en-GB')).toBe(true)
    expect(sameTranslationLanguage('es', 'es-ES')).toBe(true)
    expect(sameTranslationLanguage('zh-CN', 'zh-TW')).toBe(false)
    expect(sameTranslationLanguage('en', 'es')).toBe(false)
    expect(sameTranslationLanguage(undefined, 'es')).toBe(false)
    expect(sameTranslationLanguage('bad tag!', 'bad tag!')).toBe(false)
  })
})

describe('the options and the default', () => {
  it('lists an unlisted tag first, once, then the list', () => {
    expect(translationLanguageOptions('sv', 'sv', 'es', null, 'not a tag!')).toEqual(['sv', ...TRANSLATION_LANGUAGES])
    expect(translationLanguageOptions()).toEqual([...TRANSLATION_LANGUAGES])
  })

  it('offers Spanish to an English browser and English to any other', () => {
    expect(defaultTranslationTarget('en-US')).toBe('es')
    expect(defaultTranslationTarget('de-DE')).toBe('en')
  })
})

describe('the wording', () => {
  it('names the pair in the notice, and the language in the track name', () => {
    expect(translationModelNotice('en', 'es')).toBe(
      'Your browser will download a translation model for English to Spanish once. Your captions never leave this device.'
    )
    expect(translationTrackName('zh-Hant')).toBe('Captions (Chinese (Traditional))')
  })
})

describe('the remembered target', () => {
  it('is remembered, canonicalised, and ignored when not a tag', () => {
    expect(readStoredTranslationLanguage()).toBeNull()
    storeTranslationLanguage('ja')
    expect(localStorage.getItem(TRANSLATION_LANGUAGE_KEY)).toBe('ja')
    expect(readStoredTranslationLanguage()).toBe('ja')
    localStorage.setItem(TRANSLATION_LANGUAGE_KEY, 'not a tag!')
    expect(readStoredTranslationLanguage()).toBeNull()
  })

  it('is forgotten quietly where storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => storeTranslationLanguage('ja')).not.toThrow()
    expect(readStoredTranslationLanguage()).toBeNull()
  })
})
