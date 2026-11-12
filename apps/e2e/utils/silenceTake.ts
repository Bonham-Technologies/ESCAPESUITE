import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL } from './artist'
import { AV_FIXTURE_TIMING, AV_FIXTURE_WEBM } from './mediaHealth'

/**
 * A separate-tracks take of the A/V fixture for "Remove silences" (ESCSUITE-434,
 * ESCSUITE-431), seeded into the shared database as `ESCSUITE-403.spec.ts`
 * does: the screen part for its picture, the microphone for its sound (tone
 * 0–2 s, digital silence 2–3 s, tone 3–5 s). With the dialog's defaults the
 * one pause is cut from 2.1 s to 2.9 s.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const { duration: SECONDS, silence: SILENCE } = AV_FIXTURE_TIMING
/** The defaults' cut: the pause less 0.1 s of padding on each side. */
export const SILENCE_CUT = { start: SILENCE.start + 0.1, end: SILENCE.end - 0.1 }
/** The timeline's scale at the zoom of 1 a fresh editor opens at. */
export const SILENCE_PPS = 50

function takeParts(takeId: string) {
  const common = { duration: SECONDS, mimeType: 'video/webm', source: 'recording', takeId, startOffset: 0 }
  return [
    { ...common, id: takeId, name: 'Talk', width: 640, height: 360, frameRate: 30, mediaType: 'video', recordedAt: 1_700_000_000_000, hasAudio: false, role: 'screen' },
    { ...common, id: `${takeId}-mic`, name: 'Talk — microphone', width: 0, height: 0, frameRate: 0, mediaType: 'audio', recordedAt: 1_700_000_000_001, hasAudio: true, role: 'mic' },
  ]
}

/** Seed the take as `takeId` and open the editor on it: two clips on two rows. */
export async function openSilenceTake(page: Page, takeId: string): Promise<void> {
  await page.goto(ARTIST_URL)
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
    { dbName: DB_NAME, dbVersion: DB_VERSION, parts: takeParts(takeId), base64 }
  )
  await page.goto(`${ARTIST_URL}?loadVideo=${takeId}&suppressRestore=1`)
  await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })
}

/** The left edge of the timeline's time 0 on screen. */
async function timelineOrigin(page: Page): Promise<number> {
  return page
    .locator('[data-clip-id]')
    .first()
    .evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left)
}

/** Move the playhead to `seconds` by clicking the ruler there. */
export async function seekByRuler(page: Page, seconds: number): Promise<void> {
  const ruler = (await page.getByRole('group', { name: 'Timeline ruler' }).boundingBox())!
  await page.mouse.click((await timelineOrigin(page)) + seconds * SILENCE_PPS, ruler.y + ruler.height / 2)
}

/** Each clip's span in timeline seconds, left to right, from its box on screen. */
export async function clipSpansOf(page: Page, clips: Locator): Promise<{ start: number; end: number }[]> {
  const origin = await timelineOrigin(page)
  const boxes = await clips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))
  return boxes
    .map((b) => ({ start: (b.left - origin) / SILENCE_PPS, end: (b.right - origin) / SILENCE_PPS }))
    .sort((a, b) => a.start - b.start)
}

/** Every clip on screen whose label matches `name`. */
export const clipsLabelled = (page: Page, name: RegExp): Locator => page.locator('[data-clip-id]').filter({ hasText: name })

/** Each timeline marker's time, read off where its flag is drawn. */
export async function markerTimes(page: Page): Promise<number[]> {
  const flags = page.getByRole('button', { name: /^Marker / })
  return (await flags.evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.left)))).map((px) => px / SILENCE_PPS)
}

/** Open "Remove silences" on the take's screen part, with the one pause listed. */
export async function openRemoveSilences(page: Page): Promise<Locator> {
  await clipsLabelled(page, /^Talk(?! —)/).first().click()
  await page.getByRole('button', { name: 'Find silences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove silences' })
  await expect(dialog.getByRole('status')).toHaveText(/^1 pause found/)
  return dialog
}
