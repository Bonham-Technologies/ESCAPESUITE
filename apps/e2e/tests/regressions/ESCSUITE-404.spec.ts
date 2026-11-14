import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import {
  CHROME_BRANDS,
  CHROMIUM_ONLY_BRANDS,
  STUB_WORDS,
  installSpeechStub,
  stubRecord,
  transcribeButton,
} from '../../utils/speechStub'

/**
 * ESCSUITE-404: "Transcribe to captions" with the browser's on-device speech
 * recognition.
 *
 * The Web Speech API is replaced by the stub in `utils/speechStub.ts`, which
 * also presents a Google Chrome brand (see there). The timeline holds a 10 s
 * synthesised tone, which every browser here decodes.
 *
 * What it pins: no control where on-device recognition is missing or in a
 * bare Chromium embedder; nothing asked of the API until the button is
 * pressed, and the control hiding itself when the press finds it
 * `unavailable`; the real headless shell opening the editor without
 * crashing; the recogniser is never started without
 * `processLocally: true`; the stub's words become caption clips, undone in one
 * step and written by the .srt / .vtt sidecar; the app makes no fetch or XHR
 * of its own while it transcribes; and a `downloadable` language pack is
 * downloaded only after the notice.
 */

const CLIP_SECONDS = 10
// ESCSUITE-444: the notice names the language, here the browser's own (Playwright's default locale).
const NOTICE = 'Your browser will download a speech language pack for English (United States) once. Your audio never leaves this device.'
const WORDS = STUB_WORDS
const UNAVAILABLE_NOTICE = 'On-device speech recognition is not available in this browser.'

async function openWithTone(page: Page): Promise<void> {
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
}

test.describe('ESCSUITE-404: transcribe to captions on this device', () => {
  test.describe.configure({ timeout: 90_000 })

  for (const [label, mode, brands] of [
    ['no SpeechRecognition (Firefox, Safari)', { api: 'none' }, CHROME_BRANDS],
    ['a recogniser with no on-device mode', { api: 'no-local' }, CHROME_BRANDS],
    ['a bare Chromium embedder (Electron, the headless shell)', { api: 'local', answer: 'available' }, CHROMIUM_ONLY_BRANDS],
  ] as const) {
    test(`no transcribe control with ${label}`, async ({ page }) => {
      await installSpeechStub(page, mode, [...brands])
      await openWithTone(page)
      await expect(page.getByText(/^1 clip/).first()).toBeVisible()
      await page.waitForTimeout(500)
      await expect(transcribeButton(page)).toHaveCount(0)
      await expect(page.getByText('Transcribe', { exact: false })).toHaveCount(0)
      expect((await stubRecord(page)).available).toEqual([])
    })
  }

  test('asks available() only when pressed, and hides the control when it answers unavailable', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'unavailable' })
    await openWithTone(page)
    await expect(transcribeButton(page)).toBeVisible()
    expect((await stubRecord(page)).available, 'opening the editor asks the browser nothing').toEqual([])

    await transcribeButton(page).click()
    await expect(page.getByText(UNAVAILABLE_NOTICE)).toBeVisible()
    await expect(transcribeButton(page)).toHaveCount(0)
    const record = await stubRecord(page)
    // ESCSUITE-444: the select's language, which starts on the browser's own.
    const chosen = await page.evaluate(() => navigator.language)
    await expect(page.getByRole('combobox', { name: 'Transcription language' })).toHaveCount(0)
    expect(record.available).toEqual([{ langs: [chosen], processLocally: true }])
    expect(record.install).toEqual([])
    expect(record.constructed).toBe(0)
  })

  test('the real headless shell opens the editor without its renderer crashing, and shows no control', async ({ page, browserName }) => {
    // No stub: the browser's own API. In Playwright's Chromium headless shell
    // available() kills the renderer, so the editor must never call it on its
    // own. The brand gate hides the control there.
    test.skip(browserName !== 'chromium', 'the crash is a Chromium embedder one')
    let crashed = false
    page.on('crash', () => { crashed = true })
    await openWithTone(page)
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()
    await page.waitForTimeout(500)
    await expect(transcribeButton(page)).toHaveCount(0)
    expect(crashed, 'the page crashed').toBe(false)
  })

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
    expect(record.available).toEqual([{ langs: [await page.evaluate(() => navigator.language)], processLocally: true }])
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
    expect((await stubRecord(page)).available, 'opening the editor asks the browser nothing').toEqual([])

    await transcribeButton(page).click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    expect((await stubRecord(page)).install).toEqual([])

    await page.getByRole('button', { name: 'Download language pack' }).click()
    await expect(page.getByText('Transcribed 2 captions onto the Captions track.')).toBeVisible({ timeout: 30_000 })
    const record = await stubRecord(page)
    expect(record.install).toEqual([{ langs: ['en-US'], processLocally: true }])
    for (const start of record.starts) expect(start.processLocally).toBe(true)
  })
})
