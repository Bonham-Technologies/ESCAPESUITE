import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'

/**
 * ESCSUITE-404: "Transcribe to captions" with the browser's on-device speech
 * recognition.
 *
 * The Web Speech API is replaced by a stub (page.addInitScript) so the run
 * does not depend on a language pack being installed in the test browser.
 * The stub records how it was created and started, meters the audio track it
 * is handed (so the test knows the timeline's own sound reached it, not a
 * microphone), and answers with scripted words on its own clock. The timeline
 * holds a 10 s synthesised tone, which every browser here decodes.
 *
 * What it pins: no control where on-device recognition is missing or
 * `unavailable`; the recogniser is never started without
 * `processLocally: true`; the stub's words become caption clips, undone in one
 * step and written by the .srt / .vtt sidecar; the app makes no fetch or XHR
 * of its own while it transcribes; and a `downloadable` language pack is
 * downloaded only after the notice.
 */

const CLIP_SECONDS = 10
const NOTICE = 'Your browser will download a speech language pack once. Your audio never leaves this device.'
const WORDS = ['hello from the stub', 'captions made on this device']

type StubMode = { api: 'none' } | { api: 'no-local' } | { api: 'local'; answer: string }

interface StubRecord {
  available: unknown[]
  install: unknown[]
  starts: Array<{ processLocally: unknown; isTrack: boolean; kind: string | null; readyState: string | null }>
  constructed: number
  maxLevel: number
}

async function installSpeechStub(page: Page, mode: StubMode): Promise<void> {
  await page.addInitScript(
    ({ mode, words }) => {
      const w = window as unknown as Record<string, unknown>
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
        private finish() {
          for (const t of this.timers) { clearTimeout(t); clearInterval(t) }
          this.timers = []
          setTimeout(() => this.onend?.(), 20)
        }
        stop() { this.finish() }
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
    { mode, words: WORDS }
  )
}

const stubRecord = (page: Page) => page.evaluate(() => (window as unknown as { __speechStub: StubRecord }).__speechStub)
const transcribeButton = (page: Page) => page.getByRole('button', { name: 'Transcribe to captions' })

async function openWithTone(page: Page): Promise<void> {
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
}

test.describe('ESCSUITE-404: transcribe to captions on this device', () => {
  test.describe.configure({ timeout: 90_000 })

  for (const [label, mode] of [
    ['no SpeechRecognition (Firefox, Safari)', { api: 'none' }],
    ['a recogniser with no on-device mode', { api: 'no-local' }],
    ['available() answers unavailable', { api: 'local', answer: 'unavailable' }],
  ] as const) {
    test(`no transcribe control with ${label}`, async ({ page }) => {
      await installSpeechStub(page, mode)
      await openWithTone(page)
      // The probe has had its answer by the time the editor has a clip on it.
      await expect(page.getByText(/^1 clip/).first()).toBeVisible()
      await page.waitForTimeout(500)
      await expect(transcribeButton(page)).toHaveCount(0)
      await expect(page.getByText('Transcribe', { exact: false })).toHaveCount(0)
    })
  }

  test('the stub’s words become caption clips, on device only, with no request of the app’s own, one undo step, and the sidecar carries them', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await openWithTone(page)
    await expect(timelineClips(page)).toHaveCount(1)

    const requests: Array<{ url: string; type: string }> = []
    page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }))

    await transcribeButton(page).click()
    await expect(page.getByText(/Transcribing on this device/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Transcribed 2 captions onto the Captions track.')).toBeVisible({ timeout: 30_000 })

    // Criterion 4: no fetch or XHR of the app's own while it transcribed. The
    // only requests allowed are the lazily loaded transcription module's own
    // scripts, from the editor's origin.
    const origin = new URL(ARTIST_URL).origin
    const ownRequests = requests.filter((r) => r.type === 'fetch' || r.type === 'xhr' || r.type === 'websocket' || r.type === 'eventsource')
    expect(ownRequests, 'the app made a fetch or XHR while transcribing').toEqual([])
    expect(
      requests.filter((r) => r.type !== 'script' || new URL(r.url).origin !== origin),
      'only same-origin module scripts may load while transcribing'
    ).toEqual([])

    // Criterion 2: every start was on device, and on the mix's track, never the microphone.
    const record = await stubRecord(page)
    expect(record.constructed).toBe(1)
    expect(record.starts.length).toBeGreaterThanOrEqual(1)
    for (const start of record.starts) {
      expect(start).toEqual({ processLocally: true, isTrack: true, kind: 'audio', readyState: 'live' })
    }
    expect(record.available).toContainEqual({ langs: [expect.any(String)], processLocally: true })
    expect(record.maxLevel, 'the timeline’s sound reached the recogniser’s track').toBeGreaterThan(0.01)

    // Criterion 3: ordinary caption clips holding the stub's words.
    await expect(timelineClips(page)).toHaveCount(3)
    for (const words of WORDS) await expect(timelineClips(page).filter({ hasText: words })).toHaveCount(1)
    await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()

    // …written by the existing sidecar path.
    await openExportDialog(page)
    for (const format of ['srt', 'vtt'] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: `Download .${format}` }).click(),
      ])
      const text = await readFile((await download.path())!, 'utf8')
      for (const words of WORDS) expect(text, `.${format} sidecar`).toContain(words)
      if (format === 'vtt') expect(text.startsWith('WEBVTT')).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()

    // …and one undo takes the whole transcription back off, track and all.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(timelineClips(page)).toHaveCount(1)
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })

  test('a downloadable language pack is downloaded only after the notice, on device', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'downloadable' })
    await openWithTone(page)

    await transcribeButton(page).click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    expect((await stubRecord(page)).install).toEqual([])

    await page.getByRole('button', { name: 'Download language pack' }).click()
    await expect(page.getByText('Transcribed 2 captions onto the Captions track.')).toBeVisible({ timeout: 30_000 })
    const record = await stubRecord(page)
    expect(record.install).toEqual([{ langs: [expect.any(String)], processLocally: true }])
    for (const start of record.starts) expect(start.processLocally).toBe(true)
  })
})
