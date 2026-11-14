import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { runAxeCheck } from '../../utils/accessibility'
import { installSpeechStub, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-444: "Transcribe to captions" always listened for the browser's
 * own language (`navigator.language`), so a recording in any other language
 * could not be transcribed.
 *
 * Now a "Transcription language" select sits beside the button, starting on
 * the browser's language and remembered across reloads. `available()` is
 * still asked only on a press, for the chosen language, and the language-pack
 * notice names it.
 *
 * The recogniser is the stub in `utils/speechStub.ts`, which also presents a
 * Google Chrome brand: the headless shell's real `available()` kills the
 * renderer, and the control is hidden in a bare Chromium embedder.
 */

const CLIP_SECONDS = 8
const DONE = 'Transcribed 2 captions onto the Captions track.'

const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Transcription language' })

async function openEditor(page: Page): Promise<void> {
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
}

async function openWithTone(page: Page): Promise<void> {
  await openEditor(page)
  await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
  await expect(timelineClips(page)).toHaveCount(1)
}

test.describe('ESCSUITE-444: transcribe in the language the user picks', () => {
  test.describe.configure({ timeout: 90_000 })

  test('the chosen language is the one available() is asked for and the run hears, and it is remembered', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await openWithTone(page)

    // Beside the button, on the browser's own language, and nothing asked yet.
    const browserLanguage = await page.evaluate(() => navigator.language)
    await expect(languageSelect(page)).toBeVisible()
    await expect(transcribeButton(page)).toBeVisible()
    await expect(languageSelect(page)).toHaveValue(browserLanguage)
    const results = await runAxeCheck(page, { includeSelector: 'select[aria-label="Transcription language"]' })
    expect(results.violations, 'the language select is accessible').toEqual([])

    await languageSelect(page).selectOption('de-DE')
    expect((await stubRecord(page)).available, 'choosing a language asks the browser nothing').toEqual([])

    await transcribeButton(page).click()
    await expect(page.getByText(DONE)).toBeVisible({ timeout: 30_000 })
    const record = await stubRecord(page)
    expect(record.available).toEqual([{ langs: ['de-DE'], processLocally: true }])
    expect(record.constructed).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('escapeartist-transcription-language'))).toBe('de-DE')

    // Remembered: the next time the editor opens it starts on German, and
    // still asks the browser nothing until pressed.
    await page.reload()
    await waitForAppReady(page, 'artist')
    await expect(languageSelect(page)).toHaveValue('de-DE')
    expect((await stubRecord(page)).available).toEqual([])
  })

  test('the language-pack notice names the chosen language, and that pack is installed', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'downloadable' })
    await openWithTone(page)
    await languageSelect(page).selectOption({ label: 'Japanese (Japan)' })
    await transcribeButton(page).click()

    await expect(
      page.getByText(
        'Your browser will download a speech language pack for Japanese (Japan) once. Your audio never leaves this device.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(languageSelect(page)).toBeDisabled()
    expect((await stubRecord(page)).install).toEqual([])

    await page.getByRole('button', { name: 'Download language pack' }).click()
    await expect(page.getByText(DONE)).toBeVisible({ timeout: 30_000 })
    const record = await stubRecord(page)
    expect(record.available).toEqual([{ langs: ['ja-JP'], processLocally: true }])
    expect(record.install).toEqual([{ langs: ['ja-JP'], processLocally: true }])
  })

  test.describe('with a browser language the list does not have', () => {
    test.use({ locale: 'sv-SE' })

    test("offers the browser's own language first, and asks for it on the press", async ({ page }) => {
      await installSpeechStub(page, { api: 'local', answer: 'unavailable' })
      await openEditor(page)
      await expect(languageSelect(page)).toHaveValue('sv-SE')
      await expect(languageSelect(page).locator('option').first()).toHaveText('Swedish (Sweden)')
      await expect(languageSelect(page).locator('option', { hasText: 'English (United States)' })).toHaveCount(1)

      await transcribeButton(page).click()
      // The browser's own language cannot be had: the control hides, as before.
      await expect(page.getByText('On-device speech recognition is not available in this browser.')).toBeVisible()
      await expect(transcribeButton(page)).toHaveCount(0)
      await expect(languageSelect(page)).toHaveCount(0)
      expect((await stubRecord(page)).available).toEqual([{ langs: ['sv-SE'], processLocally: true }])
    })
  })
})
