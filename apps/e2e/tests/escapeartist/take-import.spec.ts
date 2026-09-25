import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'

/**
 * A take recorded as separate tracks, handed to ESCAPEARTIST (ESCSUITE-14
 * slice 2).
 *
 * The take is seeded straight into the shared database rather than recorded,
 * because what is under test is the *import*: the id names the take's primary
 * part, and ESCAPEARTIST has to find its webcam half, add both to the media
 * library and place them on two tracks with the webcam's transform seeded from
 * the placement it was recorded at. Recording one for real is CRAFT's own e2e
 * (`tests/escapecraft/separate-tracks.spec.ts`).
 *
 * jsdom cannot hold any of this: there is no layout, so the inspector's
 * percentages are the only place the transform is visible as a user sees it.
 */

const DB_NAME = 'video-editor-db'
/** `DB_VERSION` in `packages/shared/src/storage`, whose four stores the seed builds. */
const DB_VERSION = 1
const TAKE_ID = 'e2e-take-primary'
const WEBCAM_ID = 'e2e-take-webcam'

/** The two records ESCAPECRAFT's save path writes for a separate-tracks take. */
const TAKE_PARTS = [
  {
    id: TAKE_ID,
    name: 'Handoff take',
    duration: 6,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 2048,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_000,
    hasAudio: true,
    hasWebcam: true,
    takeId: TAKE_ID,
    role: 'screen',
    startOffset: 0,
    overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
  },
  {
    id: WEBCAM_ID,
    name: 'Handoff take — webcam',
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_001,
    hasAudio: false,
    hasWebcam: true,
    takeId: TAKE_ID,
    role: 'webcam',
    startOffset: 0.5,
  },
]

/**
 * Put the take's parts into the shared database, blobs and all.
 *
 * The schema is created here rather than waited for: opening at the shared
 * layer's own `DB_VERSION` and building the four stores exactly as
 * `packages/shared/src/storage` does (the shape `seedArtistSession` in
 * tests/integration/host-embedding.spec.ts mirrors) means the seed does not
 * depend on the app having mounted and opened the database first. A page load
 * settles no IndexedDB work, so depending on that ordering is a race the first
 * slow run would lose — with a version-0 database and no `videos` store.
 */
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
        // Report what actually went wrong: an IDB error object stringifies to
        // "null" through Playwright, which hides (for instance) WebKit's
        // refusal to store a Blob at all.
        request.onerror = () => reject(new Error(`seed open failed: ${String(request.error)}`))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('videos', 'readwrite')
          const store = tx.objectStore('videos')
          for (const metadata of parts) {
            store.put({
              id: metadata.id,
              blob: new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'video/webm' }),
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

/** The value beside one of the inspector's transform sliders, e.g. "88%". */
async function transformValue(page: Page, label: string): Promise<string> {
  const row = page
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
  return (await row.locator('span').last().innerText()).trim()
}

test.describe('ESCAPEARTIST imports a multi-part take', () => {
  // The fixture is a take *in the database*, and WebKit under Playwright cannot
  // put a Blob into IndexedDB at all — every `put` here fails with
  // "UnknownError: Error preparing Blob/File data to be stored in object store",
  // in the seed helper, before a single assertion runs. It is the same WebKit
  // limitation `tests/integration/indexeddb-sharing.spec.ts` already skips for,
  // and it stops the take being written, not the import being done: Chromium
  // (what CI runs) and Firefox both place it.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit cannot store Blobs in IndexedDB under Playwright, so the take cannot be seeded'
  )

  test.beforeEach(async ({ page }) => {
    // IndexedDB is per origin, so the seed needs a document served from
    // ESCAPEARTIST's. That is all this load is for: `seedTake` creates the
    // schema itself, so nothing here waits on the app having mounted.
    await page.goto(ARTIST_URL)
    await seedTake(page)
  })

  test('places both parts on two tracks with the webcam above the screen', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)

    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    const clips = page.locator('[data-clip-id]')
    await expect(clips).toHaveCount(2)
    // Tracks render highest index first, so the first clip in the DOM is the
    // one on top — the webcam, which is what "on a track above it" means on
    // screen.
    await expect(clips.first()).toContainText('Handoff take — webcam')
    await expect(clips.last()).toContainText('Handoff take')
  })

  test('seeds the webcam clip with the corner it was recorded in', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()

    // 1920 x 0.2 = 384 wide, 16:9 so 216 high, inset 1920 x 20/1280 = 30px from
    // the bottom-right corner: centred at 1698/1920 = 88% across and
    // 942/1080 = 87% down, drawn at 384/1280 = 30% of the camera's own pixels.
    await expect(page.getByText('00:00.500')).toBeVisible()
    expect(await transformValue(page, 'Pos X')).toBe('88%')
    expect(await transformValue(page, 'Pos Y')).toBe('87%')
    expect(await transformValue(page, 'Scale')).toBe('30%')
  })
})
