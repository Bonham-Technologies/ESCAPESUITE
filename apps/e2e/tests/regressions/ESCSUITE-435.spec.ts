import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'
import { AV_FIXTURE_TIMING, AV_FIXTURE_WEBM } from '../../utils/mediaHealth'

/**
 * ESCSUITE-435: "Remove silences" listens only to what the export plays. A
 * clip on a muted (or hidden) row is left out of the mix, so it must not keep
 * a pause from being found; it is still cut and moved with the take.
 *
 * The take is seeded as in `ESCSUITE-403.spec.ts`, with a third part: the
 * screen for its picture (no sound), the microphone (the A/V fixture: tone
 * 0–2 s, digital silence 2–3 s, tone 3–5 s) and system audio, the same
 * fixture captured 1.5 s after the take started, so its tone (1.5–3.5 s on
 * the timeline) covers the microphone's pause. While the system row plays
 * there is no pause; muted, the microphone's pause is found and cut from
 * 2.1 s to 2.9 s with the defaults, on all three rows.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const TAKE_ID = 'e2e-435-screen'
const { duration: SECONDS, silence: SILENCE } = AV_FIXTURE_TIMING
/** When the system audio started, in seconds after the take. */
const SYSTEM_OFFSET = 1.5
/** The defaults' cut: the pause less 0.1 s of padding on each side. */
const CUT = { start: SILENCE.start + 0.1, end: SILENCE.end - 0.1 }
const CUT_LENGTH = CUT.end - CUT.start
/** The timeline's scale at the zoom of 1 a fresh editor opens at. */
const PPS = 50

function takeParts() {
  const common = { duration: SECONDS, mimeType: 'video/webm', source: 'recording', takeId: TAKE_ID }
  return [
    { ...common, id: TAKE_ID, name: 'Talk', width: 640, height: 360, frameRate: 30, mediaType: 'video', recordedAt: 1_700_000_000_000, hasAudio: false, role: 'screen', startOffset: 0 },
    { ...common, id: 'e2e-435-mic', name: 'Talk — microphone', width: 0, height: 0, frameRate: 0, mediaType: 'audio', recordedAt: 1_700_000_000_001, hasAudio: true, role: 'mic', startOffset: 0 },
    { ...common, id: 'e2e-435-system', name: 'Talk — system audio', width: 0, height: 0, frameRate: 0, mediaType: 'audio', recordedAt: 1_700_000_000_002, hasAudio: true, role: 'system', startOffset: SYSTEM_OFFSET },
  ]
}

async function seedTake(page: Page) {
  const base64 = readFileSync(AV_FIXTURE_WEBM).toString('base64')
  await page.evaluate(
    ({ dbName, dbVersion, parts, base64 }) =>
      new Promise<void>((resolve, reject) => {
        const binary = atob(base64)
        const data = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          for (const name of ['videos', 'thumbnails', 'projects']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
        }
        request.onerror = () => reject(new Error(`seed open failed: ${String(request.error)}`))
        request.onsuccess = () => {
          const tx = request.result.transaction('videos', 'readwrite')
          for (const metadata of parts) {
            const blob = new Blob([data], { type: metadata.mimeType })
            tx.objectStore('videos').put({ id: metadata.id, blob, metadata: { ...metadata, size: blob.size } })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error(`seed write failed: ${String(tx.error)}`))
        }
      }),
    { dbName: DB_NAME, dbVersion: DB_VERSION, parts: takeParts(), base64 }
  )
}

/** Every clip on screen whose label matches `name`. */
const clipsNamed = (page: Page, name: RegExp) => page.locator('[data-clip-id]').filter({ hasText: name })
const SCREEN = /^Talk(?! —)/
const MIC = /microphone/
const SYSTEM = /system audio/

/** Each clip's span in timeline seconds, left to right, from its box on screen. */
async function spans(page: Page, clips: Locator): Promise<{ start: number; end: number }[]> {
  const origin = await page
    .locator('[data-clip-id]')
    .first()
    .evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left)
  const boxes = await clips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))
  return boxes
    .map((b) => ({ start: (b.left - origin) / PPS, end: (b.right - origin) / PPS }))
    .sort((a, b) => a.start - b.start)
}

/** The Mute button in the header of the row `clip` sits on: the one level with it. */
async function muteButtonOfRow(page: Page, clip: Locator): Promise<Locator> {
  const row = (await clip.boundingBox())!
  const middle = row.y + row.height / 2
  const buttons = page.getByTitle('Mute', { exact: true })
  for (const button of await buttons.all()) {
    // The button sits in the header's volume section; the header spans the row's height.
    const header = (await button.locator('xpath=../..').boundingBox())!
    if (middle >= header.y && middle <= header.y + header.height) return button
  }
  throw new Error('no Mute button level with the clip')
}

/**
 * Select the screen part, clicking it `along` its width (a click there also
 * moves the playhead there, whose line then takes the next click at that spot),
 * and open "Remove silences".
 */
async function findSilencesFromScreen(page: Page, along: number): Promise<Locator> {
  const part = clipsNamed(page, SCREEN).first()
  const box = (await part.boundingBox())!
  await part.click({ position: { x: box.width * along, y: box.height / 2 } })
  await page.getByRole('button', { name: 'Find silences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove silences' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('ESCSUITE-435: Remove silences does not listen to a muted row, and still cuts it', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await seedTake(page)
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^3 clips · 3 tracks$/)).toBeVisible({ timeout: 15_000 })
  })

  test('finds the microphone\'s pause once the system audio row is muted, and cuts all three rows in step', async ({ page }) => {
    test.setTimeout(90_000)

    await test.step('while the system audio plays through the pause, there is nothing to cut', async () => {
      const dialog = await findSilencesFromScreen(page, 0.3)
      await expect(dialog.getByRole('status')).toHaveText('No pauses to cut with these settings.')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('muted, the system audio no longer hides the pause', async () => {
      await (await muteButtonOfRow(page, clipsNamed(page, SYSTEM).first())).click()
      const dialog = await findSilencesFromScreen(page, 0.7)
      await expect(dialog.getByRole('status')).toHaveText(/^1 pause found/)
      const [pause] = await dialog.getByRole('listitem').allTextContents()
      const [, from, to] = /0:(\d+\.\d+) – 0:(\d+\.\d+)/.exec(pause)!.map(Number)
      // Within 50 ms of the pause, less the padding: the codec may smear its edges by a few ms.
      expect(Math.abs(from - CUT.start), `the cut starts at ${from}`).toBeLessThanOrEqual(0.05)
      expect(Math.abs(to - CUT.end), `the cut ends at ${to}`).toBeLessThanOrEqual(0.05)
    })

    await test.step('Remove all cuts the muted row too, in step with the take', async () => {
      await page.getByRole('button', { name: 'Remove all' }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(page.getByText(/^6 clips · 3 tracks$/)).toBeVisible()
      const screen = await spans(page, clipsNamed(page, SCREEN))
      const mic = await spans(page, clipsNamed(page, MIC))
      const system = await spans(page, clipsNamed(page, SYSTEM))
      for (const row of [screen, mic, system]) expect(row).toHaveLength(2)
      expect(screen[1].end, 'the screen row is the take less the pause').toBeCloseTo(SECONDS - CUT_LENGTH, 1)
      // Every row joins where the screen does, and the system audio still starts where it did.
      for (const [name, row] of [['microphone', mic], ['system audio', system]] as const) {
        expect(Math.abs(row[0].end - screen[0].end), `the ${name} row joins with the screen`).toBeLessThan(2 / PPS)
        expect(Math.abs(row[1].start - screen[1].start), `the ${name} row joins with the screen`).toBeLessThan(2 / PPS)
      }
      expect(system[0].start).toBeCloseTo(SYSTEM_OFFSET, 1)
      expect(system[1].end, 'the system audio row is shortened by the pause').toBeCloseTo(SYSTEM_OFFSET + SECONDS - CUT_LENGTH, 1)
    })
  })
})
