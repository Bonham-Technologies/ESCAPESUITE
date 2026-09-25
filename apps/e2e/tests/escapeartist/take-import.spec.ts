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

/** The take whose screen half is smaller than ESCAPEARTIST's default project. */
const SMALL_TAKE_ID = 'e2e-small-primary'
const SMALL_WEBCAM_ID = 'e2e-small-webcam'

/**
 * A 1280x720 share with a 640x360 camera — a take recorded on a laptop screen,
 * handed to a 1920x1080 project.
 *
 * Its point is the *frame*: every part imports at native pixels centred on the
 * canvas, so the picture the camera sat in a corner of is a 1280x720 rectangle
 * inside the canvas rather than the canvas itself.
 */
const SMALL_TAKE_PARTS = [
  {
    ...TAKE_PARTS[0],
    id: SMALL_TAKE_ID,
    name: 'Laptop share',
    width: 1280,
    height: 720,
    recordedAt: 1_700_000_100_000,
    takeId: SMALL_TAKE_ID,
  },
  {
    ...TAKE_PARTS[1],
    id: SMALL_WEBCAM_ID,
    name: 'Laptop share — webcam',
    width: 640,
    height: 360,
    recordedAt: 1_700_000_100_001,
    takeId: SMALL_TAKE_ID,
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
async function seedTake(page: Page, parts: typeof TAKE_PARTS) {
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
    { dbName: DB_NAME, dbVersion: DB_VERSION, parts }
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
    // Both takes, so each test names the one it wants: `orderTakeParts` groups
    // on `takeId`, and only the take that was asked for joins the library.
    await seedTake(page, [...TAKE_PARTS, ...SMALL_TAKE_PARTS])
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

  test('measures the corner from the screen recording, not from a bigger canvas', async ({
    page,
  }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${SMALL_TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()

    // Every number below, and where it comes from. The project is
    // ESCAPEARTIST's default 1920x1080 (`createEmptyProject`) and this take's
    // screen half is 1280x720, so the screen imports at native pixels centred
    // on the canvas and the picture the camera sat in a corner of is the
    // rectangle
    //
    //   left = (1920 - 1280) / 2 = 320, top = (1080 - 720) / 2 = 180, 1280x720
    //
    // `overlayPlacementToTransform` then reads every number off *that*:
    //
    //   overlay width = 0.2 x 1280 = 256, and 16:9 so 144 high
    //   inset         = 20 — the frame is 1280 wide, which is the compositor's
    //                   cap rather than above it, so the flat padding (the
    //                   fraction gives the same 20 here; the sub-1280 case
    //                   where they differ is the unit test's)
    //   centre x      = 320 + 1280 - 20 - 128 = 1452 -> 1452/1920 = 0.75625
    //   centre y      = 180 +  720 - 20 -  72 =  808 ->  808/1080 = 0.748148
    //   scale         = 256 / 640 = 0.4 (the camera's own pixels)
    //
    // and the inspector prints `Math.round(value * 100)`% (`TransformSection`),
    // so 0.75625 -> 76, 0.748148 -> 75, 0.4 -> 40. Measuring from the canvas
    // instead would read 88% / 87% at 60% (1920 x 0.2 = 384 wide, inset 30),
    // with the camera over the middle of the picture the user recorded — which
    // is what this test fails with if the frame is ever dropped.
    expect(await transformValue(page, 'Pos X')).toBe('76%')
    expect(await transformValue(page, 'Pos Y')).toBe('75%')
    expect(await transformValue(page, 'Scale')).toBe('40%')
  })
})
