import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'

/**
 * ESCSUITE-355 (user-reported): in a take recorded as separate tracks, a split,
 * a delete and closing the gap cut only the picture. The microphone stayed one
 * whole clip, so the cut speech kept playing under the wrong frames.
 *
 * A take's parts are now linked: a cut or delete of one acts on all of them,
 * and Alt acts on one alone. The take is seeded straight into the shared
 * database, the way `tests/escapeartist/take-import.spec.ts` seeds one; its
 * bytes are placeholders, since nothing here plays it.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const TAKE_ID = 'e2e-355-screen'

const TAKE_PARTS = [
  {
    id: TAKE_ID,
    name: 'Talk',
    duration: 6,
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
    id: 'e2e-355-mic',
    name: 'Talk — microphone',
    duration: 6,
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

/** Every clip on screen whose label contains `name`. */
const clipsNamed = (page: Page, name: RegExp) => page.locator('[data-clip-id]').filter({ hasText: name })

/** Click a clip's box `fraction` of the way along it. */
async function clickAlong(page: Page, name: RegExp, fraction: number, modifiers: ('Alt')[] = []) {
  const box = await clipsNamed(page, name).first().boundingBox()
  if (!box) throw new Error(`clip ${String(name)} has no box`)
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2)
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.down()
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
}

test.describe('ESCSUITE-355: a take recorded as separate tracks is cut as one', () => {
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

  test('the razor cuts the microphone where it cuts the screen, and a delete takes both pieces', async ({ page }) => {
    await page.keyboard.press('c')
    await clickAlong(page, /^Talk(?! —)/, 0.5)

    await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
    await expect(clipsNamed(page, /microphone/)).toHaveCount(2)

    await page.keyboard.press('v')
    // The second half of the screen recording.
    await clipsNamed(page, /^Talk \(2\)/).click()
    await page.keyboard.press('Delete')

    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
    await expect(clipsNamed(page, /microphone/)).toHaveCount(1)
  })

  test('with Alt held, the razor cuts the screen alone', async ({ page }) => {
    await page.keyboard.press('c')
    await clickAlong(page, /^Talk(?! —)/, 0.5, ['Alt'])

    await expect(page.getByText(/^3 clips · 2 tracks$/)).toBeVisible()
    await expect(clipsNamed(page, /microphone/)).toHaveCount(1)
  })
})
