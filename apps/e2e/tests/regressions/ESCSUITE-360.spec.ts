import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'

/**
 * ESCSUITE-360: a ripple trim of one part of a take recorded as separate
 * tracks trimmed that clip and closed the gap on its own row only. The
 * microphone row stayed put, so after the cut the speech no longer lined up
 * with the picture.
 *
 * A ripple trim now trims every linked part by the same amount and closes the
 * gap on every row. The take is seeded straight into the shared database, as
 * in `ESCSUITE-355.spec.ts`; its bytes are placeholders, since nothing here
 * plays it.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const TAKE_ID = 'e2e-360-screen'
const TAKE_SECONDS = 6
/** The timeline's scale at the zoom of 1 a fresh editor opens at. */
const PPS = 50

const TAKE_PARTS = [
  {
    id: TAKE_ID,
    name: 'Talk',
    duration: TAKE_SECONDS,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 2048,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_000,
    hasAudio: false,
    takeId: TAKE_ID,
    role: 'screen',
    startOffset: 0,
  },
  {
    id: 'e2e-360-mic',
    name: 'Talk — microphone',
    duration: TAKE_SECONDS,
    width: 0,
    height: 0,
    frameRate: 0,
    mimeType: 'audio/webm',
    size: 1024,
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
  await page.evaluate(
    ({ dbName, dbVersion, parts }) =>
      new Promise<void>((resolve, reject) => {
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
            store.put({
              id: metadata.id,
              blob: new Blob([new Uint8Array([26, 69, 223, 163])], { type: metadata.mimeType }),
              metadata,
            })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error(`seed write failed: ${String(tx.error)}`))
        }
      }),
    { dbName: DB_NAME, dbVersion: DB_VERSION, parts: TAKE_PARTS }
  )
}

/** Every clip on screen whose label matches `name`. */
const clipsNamed = (page: Page, name: RegExp) => page.locator('[data-clip-id]').filter({ hasText: name })

/** The screen clips (`Talk`, `Talk (2)`), not the microphone's. */
const SCREEN = /^Talk(?! —)/
const MIC = /microphone/

/** Each clip's left and right edge in client pixels, left to right. */
async function edges(clips: Locator): Promise<{ left: number; right: number }[]> {
  const boxes = await clips.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right }
    })
  )
  return boxes.sort((a, b) => a.left - b.left)
}

test.describe('ESCSUITE-360: a ripple trim keeps a take\'s rows in step', () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit cannot store Blobs in IndexedDB under Playwright, so the take cannot be seeded'
  )

  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await seedTake(page)
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })
  })

  test('ripple-trimming the screen trims the microphone and closes the gap on both rows', async ({ page }) => {
    const take = (await clipsNamed(page, SCREEN).first().boundingBox())!
    expect(take.width / TAKE_SECONDS, 'the timeline is at zoom 1 (50 px per second)').toBeCloseTo(PPS, 0)
    const y = take.y + take.height / 2

    // Park the playhead past the take, off the trim handles it would cover.
    const park = () => page.mouse.click(take.x + (TAKE_SECONDS + 1) * PPS, y)
    await park()

    // Cut the take in half: the microphone is cut with it (ESCSUITE-355).
    await page.getByTitle(/^Razor Tool/).click()
    await page.mouse.click(take.x + (TAKE_SECONDS / 2) * PPS, y)
    await page.getByTitle(/^Selection Tool/).click()
    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
    await park()

    // Ripple tool: drag the first screen piece's end 1 s to the left.
    await page.getByTitle(/^Ripple Edit/).click()
    const first = (await edges(clipsNamed(page, SCREEN)))[0]
    const x = first.right - 3 // the end handle is the clip's last 8 px
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x - (PPS * i) / 10, y)
    await page.mouse.up()

    const screen = await edges(clipsNamed(page, SCREEN))
    expect(screen[0].right - first.right, 'the screen piece is 1 s shorter').toBeCloseTo(-PPS, -1)
    expect(screen[1].left, 'the next screen piece closed the gap').toBeCloseTo(screen[0].right, 0)

    // The microphone row follows, piece for piece.
    const mic = await edges(clipsNamed(page, MIC))
    expect(mic).toHaveLength(2)
    for (let i = 0; i < 2; i++) {
      expect(mic[i].left, `microphone piece ${i + 1} starts with the screen`).toBeCloseTo(screen[i].left, 0)
      expect(mic[i].right, `microphone piece ${i + 1} ends with the screen`).toBeCloseTo(screen[i].right, 0)
    }
  })
})
