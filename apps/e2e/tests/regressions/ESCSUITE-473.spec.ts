import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { assertNetworkSilence, trackNetworkSilence } from '../../utils/networkSilence'
import {
  STUB_TRANSLATIONS,
  installTranslatorStub,
  translateButton,
  translatorRecord,
} from '../../utils/translatorStub'

/**
 * ESCSUITE-473: "Translate captions" with the browser's on-device Translator
 * API, into a second caption track.
 *
 * The Translator and Language Detector APIs are replaced by the stub in
 * `utils/translatorStub.ts` (no browser here has a model installed, and
 * Playwright's Chromium has neither API), which also presents a Google Chrome
 * brand. The stub is plain script, so this runs in every browser.
 *
 * What it pins: no control and no call where the API is missing; nothing asked
 * until the button is pressed; an imported file's unknown language suggested
 * by the detector and confirmed by the user; a model downloaded only after the
 * notice that names the pair (Cancel downloads nothing); the translation as a
 * second caption track whose cues keep the source cues' times exactly, undone
 * in one step; no fetch, XHR, WebSocket or EventSource while translating; and
 * a sidecar per caption track, named with its language.
 */

const SRT = [
  '1',
  '00:00:01,250 --> 00:00:03,500',
  'Hello from the captions.',
  '',
  '2',
  '00:00:04,000 --> 00:00:06,125',
  'Made on this device.',
  '',
].join('\n')
const ENGLISH = Object.keys(STUB_TRANSLATIONS)
const SPANISH = Object.values(STUB_TRANSLATIONS)
const NOTICE = 'Your browser will download a translation model for English to Spanish once. Your captions never leave this device.'

async function openWithCaptions(page: Page): Promise<void> {
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeToneWav(8) })
  await page.locator('input[type="file"]').setInputFiles({ name: 'talk.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) })
  await expect(page.getByText('Imported 2 captions onto the Captions track.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()
}

/** The cues' timing lines of a WebVTT file, in order. */
const timings = (vtt: string) => vtt.split('\n').filter((line) => line.includes('-->'))

async function downloadVtt(page: Page, row: string): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('group', { name: row }).getByRole('button', { name: 'Download .vtt' }).click(),
  ])
  return { name: download.suggestedFilename(), text: await readFile((await download.path())!, 'utf8') }
}

test.describe('ESCSUITE-473: translate captions on this device', () => {
  test.describe.configure({ timeout: 90_000 })

  test('no translate control, and nothing asked, without the Translator API', async ({ page }) => {
    await installTranslatorStub(page, { api: 'none' })
    await openWithCaptions(page)
    await page.waitForTimeout(500)
    await expect(translateButton(page)).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Translation language' })).toHaveCount(0)
  })

  test('an imported file’s language is confirmed, the translation lands on a second track with the same times, quietly, in one undo step', async ({ page, context }) => {
    const tracker = await trackNetworkSilence(context, { origin: new URL(ARTIST_URL).origin })
    await installTranslatorStub(page, { api: 'translator', answer: 'available', detected: 'en' })
    await openWithCaptions(page)
    await expect(translateButton(page)).toBeVisible()
    expect((await translatorRecord(page)).availability, 'opening the editor asks the browser nothing').toEqual([])

    const requests: Array<{ url: string; type: string }> = []
    page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }))

    // An English browser is offered Spanish first.
    await expect(page.getByRole('combobox', { name: 'Translation language' })).toHaveValue('es')
    await translateButton(page).click()
    await expect(page.getByText('These captions look like English. Is that the language they are in?')).toBeVisible()
    expect((await translatorRecord(page)).availability, 'nothing asked of the translator before the language is confirmed').toEqual([])
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Translated 2 captions into Spanish on a new caption track.')).toBeVisible({ timeout: 15_000 })

    // Criterion 4: no request of the app's own while it translated.
    expect(
      requests.filter((r) => ['fetch', 'xhr', 'websocket', 'eventsource'].includes(r.type)),
      'the app made a network request while translating'
    ).toEqual([])
    assertNetworkSilence(tracker)

    const record = await translatorRecord(page)
    expect(record.availability).toEqual([{ sourceLanguage: 'en', targetLanguage: 'es' }])
    expect(record.created).toEqual([{ sourceLanguage: 'en', targetLanguage: 'es', monitor: true }])
    expect(record.translated).toEqual(ENGLISH)

    // Criterion 3: a second caption track holding the translation.
    await expect(page.getByText(/^5 clips · 3 tracks$/)).toBeVisible()
    for (const words of SPANISH) await expect(timelineClips(page).filter({ hasText: words })).toHaveCount(1)

    // Criterion 6: a sidecar per track, named with its language, the times identical.
    await openExportDialog(page)
    const english = await downloadVtt(page, 'English')
    const spanish = await downloadVtt(page, 'Spanish')
    // WebKit's download hands Playwright the name with spaces turned into underscores.
    expect(english.name).toMatch(/^Untitled[ _]Project\.en\.vtt$/)
    expect(spanish.name).toMatch(/^Untitled[ _]Project\.es\.vtt$/)
    expect(timings(english.text)).toEqual(['00:00:01.250 --> 00:00:03.500', '00:00:04.000 --> 00:00:06.125'])
    expect(timings(spanish.text)).toEqual(timings(english.text))
    for (const words of SPANISH) expect(spanish.text).toContain(words)
    for (const words of ENGLISH) expect(english.text).toContain(words)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()

    // One undo takes the whole translation back off, track and all.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()
  })

  test('a model to download is downloaded only after the notice naming the pair; Cancel downloads nothing', async ({ page }) => {
    await installTranslatorStub(page, { api: 'translator', answer: 'downloadable', detected: 'en' })
    await openWithCaptions(page)

    await translateButton(page).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    expect((await translatorRecord(page)).created).toEqual([])

    await page.getByRole('group', { name: 'Translation model' }).getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeHidden()
    await page.waitForTimeout(300)
    expect((await translatorRecord(page)).created, 'Cancel downloads nothing').toEqual([])
    await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()

    // The confirmed language was not written on Cancel, so it is asked again.
    await translateButton(page).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Download translation model' }).click()
    await expect(page.getByText('Translated 2 captions into Spanish on a new caption track.')).toBeVisible({ timeout: 15_000 })
    const record = await translatorRecord(page)
    expect(record.created).toEqual([{ sourceLanguage: 'en', targetLanguage: 'es', monitor: true }])
    await expect(page.getByText(/^5 clips · 3 tracks$/)).toBeVisible()
  })
})
