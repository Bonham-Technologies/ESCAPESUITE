import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-359 (user-reported): the preview froze for good after a click on
 * the timeline. The import re-index (ESCSUITE-305) copied a Cues-less WebM
 * through Mediabunny's muxer, which starts a Cluster on a delta frame once one
 * passes 32.767 s and still writes a video cue for it. Chromium trusts the cue
 * as a key frame, so a seek past ~33 s in a take with sparse key frames (every
 * MediaRecorder take) left the decoder with nothing to start from: playback
 * ran on, audio and all, and no new picture was ever presented.
 *
 * Two ways in, both fixtures in fixtures/sparse-keyframes (README there):
 *   * a fresh import of a Cues-less take, which is re-indexed on the way in;
 *   * a library row stored before the fix, with the bad cue already in it,
 *     which the read (`getVideoBlob`) has to repair.
 * Each clicks the ruler at 45 s, presses play and asserts the canvas shows new
 * pictures. Before the fix both stay on one frame.
 *
 * Chromium only: the wedge is Chromium's (Firefox seeks the same bytes, which
 * is ESCSUITE-305's own pin), and it is what CI runs.
 */

const FIXTURES = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/sparse-keyframes')
/** 60 s, 15 fps testsrc2 plus a tone, one key frame at 0 s, no Cues. */
const SPARSE_TAKE = resolvePath(FIXTURES, 'long-sparse.webm')
/** The same packets as the pre-fix re-index stored them: a video cue on the delta frame at ~32.8 s. */
const STORED_BEFORE_FIX = resolvePath(FIXTURES, 'long-sparse-reindexed-before-359.webm')
const TAKE_SECONDS = 60
const SEEK_TO_SECONDS = 45

/** A cheap fingerprint of the preview canvas's pixels. */
function previewFingerprint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas:not([class*="waveform"])') as HTMLCanvasElement
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    let hash = 0
    for (let i = 0; i < data.length; i += 16) hash = (hash * 31 + data[i]) | 0
    return hash
  })
}

/** Zoom out until the whole clip is on screen, then click the ruler `seconds` into it. */
async function clickRulerAt(page: Page, seconds: number): Promise<void> {
  const ruler = page.getByRole('group', { name: 'Timeline ruler' })
  const clip = page.locator('[data-clip-id]').first()
  for (let i = 0; i < 12; i++) {
    const [clipBox, rulerBox] = [await clip.boundingBox(), await ruler.boundingBox()]
    if (clipBox && rulerBox && clipBox.x + clipBox.width <= rulerBox.x + rulerBox.width) break
    await page.locator('body').press('-')
  }
  const clipBox = (await clip.boundingBox())!
  const rulerBox = (await ruler.boundingBox())!
  await page.mouse.click(clipBox.x + (clipBox.width * seconds) / TAKE_SECONDS, rulerBox.y + rulerBox.height / 2)
}

/** Click the ruler at 45 s, press play, and count the distinct pictures the preview shows over 8 s. */
async function picturesAfterFarSeek(page: Page): Promise<number> {
  await clickRulerAt(page, SEEK_TO_SECONDS)
  await page.getByTitle('Play (Space)').click()
  const seen = new Set<number>()
  // Long enough to cover the decode forward from the key frame at 0 s.
  const until = Date.now() + 8_000
  while (Date.now() < until && seen.size < 5) {
    seen.add(await previewFingerprint(page))
    await page.waitForTimeout(200)
  }
  return seen.size
}

test.describe('ESCSUITE-359: the preview keeps playing after a far seek into a re-indexed WebM', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The wedge is Chromium\'s; Firefox is ESCSUITE-305\'s pin')

  test('a fresh import of a Cues-less take with one key frame', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, SPARSE_TAKE)

    expect(await picturesAfterFarSeek(page)).toBeGreaterThanOrEqual(5)
  })

  test('a library row stored with the bad cue before the fix', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, SPARSE_TAKE)

    // Put the pre-fix bytes in the row, as an import between 2026-10-17 and
    // this fix stored them, and wait for the session the reload will offer.
    const before = [...(await readFile(STORED_BEFORE_FIX))]
    await page.evaluate(
      (bytes) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('video-editor-db')
          request.onerror = () => reject(new Error('open failed'))
          request.onsuccess = () => {
            const db = request.result
            const store = db.transaction('videos', 'readwrite').objectStore('videos')
            const all = store.getAll()
            all.onsuccess = () => {
              const [record] = all.result as Array<{ id: string; blob: Blob }>
              store.put({ ...record, blob: new Blob([new Uint8Array(bytes)], { type: 'video/webm' }) })
              store.transaction.oncomplete = () => {
                db.close()
                resolve()
              }
            }
            all.onerror = () => reject(new Error('read failed'))
          }
        }),
      before
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const request = indexedDB.open('video-editor-db')
                request.onsuccess = () => {
                  const db = request.result
                  const keys = db.transaction('settings', 'readonly').objectStore('settings').getAllKeys()
                  keys.onsuccess = () => {
                    db.close()
                    resolve((keys.result as string[]).filter((k) => String(k).startsWith('session')).length)
                  }
                }
              })
          ),
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0)

    await page.reload()
    await waitForAppReady(page, 'artist')
    await page.getByRole('button', { name: 'Restore Session' }).click()
    await expect(page.getByText(/^1 clip/).first()).toBeVisible({ timeout: 15_000 })

    expect(await picturesAfterFarSeek(page)).toBeGreaterThanOrEqual(5)
  })
})
