import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test, expect } from './cspGuard'
import { importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { installSpeechStub, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-467: "Transcribe to captions" runs in the offline ESCAPEARTIST file
 * under its own Content-Security-Policy.
 *
 * Playwright's Chromium is a bare embedder with no on-device speech service
 * (see `utils/speechStub.ts`), so the browser's recogniser is the stub here.
 * What this pins is the app's half: the lazily loaded transcription code, the
 * timeline audio it plays into the recogniser's track and the caption clips
 * it writes all work with the policy in force, and the `cspGuard` fixture
 * fails the test if the policy refused anything. A real browser's language
 * pack download is the browser's own, outside any page's policy; see
 * docs/VERIFY.md.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIST_FILE = pathToFileURL(path.resolve(HERE, '../../../artist/dist/index.html')).href

for (const [how, url] of [
  ['served over http', 'http://localhost:5185/?suppressRestore=1'],
  ['opened from file://', `${ARTIST_FILE}?suppressRestore=1`],
] as const) {
  test(`ESCAPEARTIST Standalone ${how} - transcribes to captions under its offline policy`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit cannot store an imported Blob in IndexedDB under Playwright (ESCSUITE-258)')
    test.setTimeout(90_000)

    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await page.goto(url)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(10) })

    await transcribeButton(page).click()
    await expect(page.getByText('Transcribed 2 captions onto the Captions track.')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()

    const record = await stubRecord(page)
    expect(record.maxLevel, 'the timeline’s sound reached the recogniser’s track').toBeGreaterThan(0.01)
  })
}
