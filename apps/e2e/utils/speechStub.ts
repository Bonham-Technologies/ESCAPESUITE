import type { Page } from '@playwright/test'

/**
 * A stand-in for the browser's on-device Web Speech API, for ARTIST's
 * "Transcribe to captions" (ESCSUITE-404, -432, -433).
 *
 * Installed with `page.addInitScript`, so a run does not depend on a language
 * pack being installed in the test browser. It records how it was created and
 * started, meters the audio track it is handed (so a test knows the timeline's
 * own sound reached it, not a microphone), and answers with `STUB_WORDS` on its
 * own clock: the first words' interim result at 1 s and final at 2.5 s, the
 * second's at 5 s and 7 s.
 *
 * It also presents a Google Chrome brand in `navigator.userAgentData`: the
 * editor hides the feature in a bare Chromium embedder (a `Chromium` brand and
 * no vendor brand), which Playwright's headless shell is, because there
 * `available()` kills the page's renderer. A test that wants the feature in
 * Chromium needs both the stub and the brand.
 */

export const STUB_WORDS = ['hello from the stub', 'captions made on this device']

/**
 * `stopNeverEnds` (ESCSUITE-438): `stop()` stops listening but never fires
 * `onend`, as a recogniser that hangs would.
 */
export type StubMode = { api: 'none' } | { api: 'no-local' } | { api: 'local'; answer: string; stopNeverEnds?: boolean }
export type Brand = { brand: string; version: string }

export const CHROME_BRANDS: Brand[] = [
  { brand: 'Google Chrome', version: '139' },
  { brand: 'Not;A=Brand', version: '99' },
  { brand: 'Chromium', version: '139' },
]
export const CHROMIUM_ONLY_BRANDS: Brand[] = [
  { brand: 'Chromium', version: '139' },
  { brand: 'Not;A=Brand', version: '99' },
]

export interface StubRecord {
  available: unknown[]
  install: unknown[]
  starts: Array<{ processLocally: unknown; isTrack: boolean; kind: string | null; readyState: string | null }>
  constructed: number
  maxLevel: number
}

export async function installSpeechStub(page: Page, mode: StubMode, brands: Brand[] = CHROME_BRANDS): Promise<void> {
  await page.addInitScript(
    ({ mode, words, brands }) => {
      const w = window as unknown as Record<string, unknown>
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        get: () => ({ brands, mobile: false, platform: 'Linux' }),
      })
      const record = { available: [] as unknown[], install: [] as unknown[], starts: [] as unknown[], constructed: 0, maxLevel: 0 }
      w.__speechStub = record
      w.webkitSpeechRecognition = undefined
      if (mode.api === 'none') {
        w.SpeechRecognition = undefined
        return
      }

      class StubRecognition {
        lang = ''
        continuous = false
        interimResults = false
        onresult: ((e: unknown) => void) | null = null
        onerror: ((e: unknown) => void) | null = null
        onend: (() => void) | null = null
        private local = false
        private timers: number[] = []
        constructor() {
          record.constructed++
        }
        start(track?: MediaStreamTrack) {
          record.starts.push({
            processLocally: (this as { processLocally?: unknown }).processLocally,
            isTrack: track instanceof MediaStreamTrack,
            kind: track?.kind ?? null,
            readyState: track?.readyState ?? null,
          })
          if (track instanceof MediaStreamTrack) {
            // Meter what it is handed.
            const ac = new AudioContext()
            void ac.resume()
            const analyser = ac.createAnalyser()
            ac.createMediaStreamSource(new MediaStream([track])).connect(analyser)
            const data = new Float32Array(analyser.fftSize)
            const meter = window.setInterval(() => {
              analyser.getFloatTimeDomainData(data)
              for (const v of data) record.maxLevel = Math.max(record.maxLevel, Math.abs(v))
            }, 50)
            this.timers.push(meter)
          }
          const say = (index: number, transcript: string, isFinal: boolean) => {
            const result = Object.assign([{ transcript, confidence: 0.9 }], { isFinal })
            const results: unknown[] = []
            results[index] = result
            this.onresult?.({ resultIndex: index, results })
          }
          const at = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, ms))
          at(1000, () => say(0, words[0].split(' ')[0], false))
          at(2500, () => say(0, words[0], true))
          at(5000, () => say(1, words[1].split(' ')[0], false))
          at(7000, () => say(1, words[1], true))
        }
        private finish(fireEnd = true) {
          for (const t of this.timers) { clearTimeout(t); clearInterval(t) }
          this.timers = []
          if (fireEnd) setTimeout(() => this.onend?.(), 20)
        }
        stop() { this.finish(!(mode.api === 'local' && mode.stopNeverEnds)) }
        abort() { this.finish() }
      }
      if (mode.api === 'local') {
        Object.defineProperty(StubRecognition.prototype, 'processLocally', {
          get() { return (this as { local: boolean }).local },
          set(v: boolean) { (this as { local: boolean }).local = v },
          configurable: true,
        })
        Object.assign(StubRecognition, {
          available: async (options: unknown) => {
            record.available.push(options)
            return mode.answer
          },
          install: async (options: unknown) => {
            record.install.push(options)
            mode.answer = 'available'
            return true
          },
        })
      }
      w.SpeechRecognition = StubRecognition
    },
    { mode, words: STUB_WORDS, brands }
  )
}

/** What the stub has recorded so far. */
export const stubRecord = (page: Page): Promise<StubRecord> =>
  page.evaluate(() => (window as unknown as { __speechStub: StubRecord }).__speechStub)

/** The "Transcribe to captions" button. */
export const transcribeButton = (page: Page) => page.getByRole('button', { name: 'Transcribe to captions' })
