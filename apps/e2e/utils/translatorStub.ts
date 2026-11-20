import type { Page } from '@playwright/test'
import { CHROME_BRANDS, type Brand } from './speechStub'

/**
 * A stand-in for the browser's on-device Translator and Language Detector
 * APIs, for ARTIST's "Translate captions" (ESCSUITE-473).
 *
 * Installed with `page.addInitScript`, so a run needs no translation model in
 * the test browser (Playwright's Chromium has neither API). It records every
 * call, fires `downloadprogress` on `create()`'s monitor when the model is
 * "downloaded", and translates with `STUB_TRANSLATIONS` (anything else comes
 * back as `es: <text>`). Like the speech stub it presents a Google Chrome
 * brand: the editor hides the feature in a bare Chromium embedder, which
 * Playwright's headless shell is.
 */

export const STUB_TRANSLATIONS: Record<string, string> = {
  'Hello from the captions.': 'Hola desde los subtítulos.',
  'Made on this device.': 'Hecho en este dispositivo.',
}

export type TranslatorStubMode =
  | { api: 'none' }
  | { api: 'translator'; answer: string; detected?: string | null }

export interface TranslatorStubRecord {
  availability: unknown[]
  created: Array<{ sourceLanguage: unknown; targetLanguage: unknown; monitor: boolean }>
  translated: string[]
  detected: string[]
}

export async function installTranslatorStub(page: Page, mode: TranslatorStubMode, brands: Brand[] = CHROME_BRANDS): Promise<void> {
  await page.addInitScript(
    ({ mode, translations, brands }) => {
      const w = window as unknown as Record<string, unknown>
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        get: () => ({ brands, mobile: false, platform: 'Linux' }),
      })
      const record = { availability: [] as unknown[], created: [] as unknown[], translated: [] as string[], detected: [] as string[] }
      w.__translatorStub = record
      if (mode.api === 'none') {
        delete w.Translator
        delete w.LanguageDetector
        return
      }
      let answer = mode.answer
      w.Translator = {
        availability: async (options: unknown) => {
          record.availability.push(options)
          return answer
        },
        create: async (options: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }) => {
          record.created.push({ sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage, monitor: typeof options.monitor === 'function' })
          const monitor = new EventTarget()
          options.monitor?.(monitor)
          if (answer !== 'available') {
            for (const loaded of [0, 0.5, 1]) {
              await new Promise((resolve) => setTimeout(resolve, 100))
              monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }))
            }
            answer = 'available'
          }
          return {
            translate: async (text: string) => {
              record.translated.push(text)
              return translations[text] ?? `es: ${text}`
            },
            destroy: () => {},
          }
        },
      }
      w.LanguageDetector = {
        availability: async () => (mode.detected ? 'available' : 'downloadable'),
        create: async () => ({
          detect: async (text: string) => {
            record.detected.push(text)
            return mode.detected ? [{ detectedLanguage: mode.detected, confidence: 0.95 }] : []
          },
          destroy: () => {},
        }),
      }
    },
    { mode, translations: STUB_TRANSLATIONS, brands }
  )
}

/** What the stub has recorded so far. */
export const translatorRecord = (page: Page): Promise<TranslatorStubRecord> =>
  page.evaluate(() => (window as unknown as { __translatorStub: TranslatorStubRecord }).__translatorStub)

/** The "Translate captions" button. */
export const translateButton = (page: Page) => page.getByRole('button', { name: 'Translate captions' })
