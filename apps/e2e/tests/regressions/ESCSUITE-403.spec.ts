import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'
import {
  AV_FIXTURE_SILENCE,
  AV_FIXTURE_TIMING,
  AV_FIXTURE_WEBM,
  expectPreviewFrameChangesOnSeek,
  expectWaveformDrawn,
  installMediaHealthProbe,
  waveformCanvas,
} from '../../utils/mediaHealth'
import { analyseAudio, exportWebM, levelBetween, longestSilence } from '../../utils/timeline'

/**
 * ESCSUITE-403: "Remove silences". Find the pauses in a recording's sound and
 * cut them all in one undoable step, keeping a take recorded as separate
 * tracks in step.
 *
 * The take is seeded into the shared database as in `ESCSUITE-355.spec.ts`,
 * but with real bytes: both parts are the A/V fixture (ESCSUITE-348; tone
 * 0–2 s, digital silence 2–3 s, tone 3–5 s), the screen part for its picture
 * and the microphone for its sound, so the waveform the detection reads is the
 * one the import decodes. With the defaults (−40 dBFS, 0.7 s gap, 0.1 s
 * padding) the one pause is cut from 2.1 s to 2.9 s.
 *
 * Chromium only: the export at the end goes through WebCodecs.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const TAKE_ID = 'e2e-403-screen'
const { duration: SECONDS, silence: SILENCE } = AV_FIXTURE_TIMING
/** The defaults' cut: the pause less 0.1 s of padding on each side. */
const CUT = { start: SILENCE.start + 0.1, end: SILENCE.end - 0.1 }
const CUT_LENGTH = CUT.end - CUT.start
/** The timeline's scale at the zoom of 1 a fresh editor opens at. */
const PPS = 50
/** One video frame at the fixture's 30 fps. */
const FRAME = 1 / 30

const TAKE_PARTS = [
  {
    id: TAKE_ID,
    name: 'Talk',
    duration: SECONDS,
    width: 640,
    height: 360,
    frameRate: 30,
    mimeType: 'video/webm',
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_000,
    // The screen half of a separate-tracks take carries no sound of its own.
    hasAudio: false,
    takeId: TAKE_ID,
    role: 'screen',
    startOffset: 0,
  },
  {
    id: 'e2e-403-mic',
    name: 'Talk — microphone',
    duration: SECONDS,
    width: 0,
    height: 0,
    frameRate: 0,
    mimeType: 'video/webm',
    mediaType: 'audio',
    source: 'recording',
    recordedAt: 1_700_000_000_001,
    hasAudio: true,
    takeId: TAKE_ID,
    role: 'mic',
    startOffset: 0,
  },
]

async function seedTake(page: Page) {
  const bytes = readFileSync(AV_FIXTURE_WEBM).toString('base64')
  await page.evaluate(
    ({ dbName, dbVersion, parts, base64 }) =>
      new Promise<void>((resolve, reject) => {
        const binary = atob(base64)
        const data = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
        }
        request.onerror = () => reject(new Error(`seed open failed: ${String(request.error)}`))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('videos', 'readwrite')
          const store = tx.objectStore('videos')
          for (const metadata of parts) {
            const blob = new Blob([data], { type: metadata.mimeType })
            store.put({ id: metadata.id, blob, metadata: { ...metadata, size: blob.size } })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error(`seed write failed: ${String(tx.error)}`))
        }
      }),
    { dbName: DB_NAME, dbVersion: DB_VERSION, parts: TAKE_PARTS, base64: bytes }
  )
}

/** Every clip on screen whose label matches `name`. */
const clipsNamed = (page: Page, name: RegExp) => page.locator('[data-clip-id]').filter({ hasText: name })
const SCREEN = /^Talk(?! —)/
const MIC = /microphone/

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

test.describe('ESCSUITE-403: Remove silences cuts every pause from a take, in step, in one undo', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The take is seeded as Blobs in IndexedDB and exported through WebCodecs: Chromium only'
  )

  test.beforeEach(async ({ page }) => {
    await installMediaHealthProbe(page)
    await page.goto(ARTIST_URL)
    await seedTake(page)
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })
  })

  test('finds the pause, removes it from both rows, exports without it, and one Ctrl+Z brings it back', async ({ page }) => {
    test.setTimeout(120_000)
    const mic = clipsNamed(page, MIC).first()
    // The waveform the detection reads is the one the import decoded: tone, a gap, tone.
    await expectWaveformDrawn(waveformCanvas(page, mic), { silence: AV_FIXTURE_SILENCE })

    await test.step('find the pauses from the screen part', async () => {
      await clipsNamed(page, SCREEN).first().click()
      await page.getByRole('button', { name: 'Find silences' }).click()
      const dialog = page.getByRole('dialog', { name: 'Remove silences' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('status')).toHaveText(/^1 pause found/)
      const [pause] = await dialog.getByRole('listitem').allTextContents()
      const [, from, to] = /0:(\d+\.\d+) – 0:(\d+\.\d+)/.exec(pause)!.map(Number)
      // Within 50 ms of the pause, less the padding: the codec may smear its edges by a few ms.
      expect(Math.abs(from - CUT.start), `the cut starts at ${from}`).toBeLessThanOrEqual(0.05)
      expect(Math.abs(to - CUT.end), `the cut ends at ${to}`).toBeLessThanOrEqual(0.05)
      // And the timeline shows it.
      const band = (await page.getByTestId('silence-band').boundingBox())!
      expect(band.width / PPS).toBeCloseTo(to - from, 1)
    })

    await test.step('Remove all shortens both rows by the pause and keeps them in step', async () => {
      await page.getByRole('button', { name: 'Remove all' }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
      const screen = await spans(page, clipsNamed(page, SCREEN))
      const sound = await spans(page, clipsNamed(page, MIC))
      expect(screen).toHaveLength(2)
      expect(sound).toHaveLength(2)
      // The pieces butt together, and each row is the take less the pause.
      expect(screen[1].start - screen[0].end, 'no gap left on the screen row').toBeCloseTo(0, 1)
      expect(screen[1].end, 'the screen row is the take less the pause').toBeCloseTo(SECONDS - CUT_LENGTH, 1)
      // Audio and video in step: every edge of the microphone sits on the screen's.
      for (let i = 0; i < 2; i++) {
        expect(Math.abs(sound[i].start - screen[i].start), `piece ${i} starts together`).toBeLessThan(2 / PPS)
        expect(Math.abs(sound[i].end - screen[i].end), `piece ${i} ends together`).toBeLessThan(2 / PPS)
      }
      // Both pieces still draw their sound, and the preview still plays the picture after the join.
      for (const piece of await clipsNamed(page, MIC).all()) await expectWaveformDrawn(waveformCanvas(page, piece))
      await expectPreviewFrameChangesOnSeek(page, () => page.getByTitle('Go to end (End)').click())
    })

    await test.step('one Ctrl+Z restores everything Remove all cut, and Ctrl+Y cuts it again', async () => {
      await page.keyboard.press('Control+z')
      await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
      const screen = await spans(page, clipsNamed(page, SCREEN))
      const sound = await spans(page, clipsNamed(page, MIC))
      expect(screen[0].end).toBeCloseTo(SECONDS, 1)
      expect(sound[0].end).toBeCloseTo(SECONDS, 1)
      await page.keyboard.press('Control+y')
      await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
    })

    await test.step('the export is the take less the pause, with tone on both sides of the join', async () => {
      const audio = await analyseAudio(page, await exportWebM(page))
      expect(audio.duration, 'the export is the take less the pause').toBeGreaterThan(SECONDS - CUT_LENGTH - FRAME * 2)
      expect(audio.duration, 'the export is the take less the pause').toBeLessThan(SECONDS - CUT_LENGTH + FRAME * 2)
      // What is left of the pause is the padding: 0.1 s each side of the join.
      expect(longestSilence(audio), 'more than the padding is left of the pause').toBeLessThanOrEqual(0.25)
      expect(levelBetween(audio, CUT.start - 0.4, CUT.start - 0.2), 'no tone before the join').toBeGreaterThan(0.2)
      expect(levelBetween(audio, CUT.start + 0.2, CUT.start + 0.4), 'no tone after the join').toBeGreaterThan(0.2)
    })
  })
})
