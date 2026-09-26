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

/**
 * Write a saved session into ESCAPEARTIST's storage: one project, one track,
 * one clip on it.
 *
 * The shape is `seedArtistSession`'s (tests/integration/host-embedding.spec.ts)
 * with a clip added and, unlike it, an explicit `resolution` — the restored
 * project is what the take's overlay geometry is measured against, so leaving
 * it to `ensureTimelineHasTracks`'s migration default would make this test's
 * arithmetic depend on that migration. The prompt only appears for a session
 * that holds source videos, which is what `seeded-video` is for.
 */
async function seedSession(page: Page) {
  await page.evaluate(
    ({ dbName, dbVersion }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
        }
        request.onerror = () => reject(new Error(`session open failed: ${String(request.error)}`))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('settings', 'readwrite')
          tx.objectStore('settings').put(
            {
              project: {
                id: 'seeded-project',
                name: 'Seeded Session',
                created: 1_700_000_000_000,
                modified: 1_700_000_000_000,
                resolution: { width: 1920, height: 1080 },
                timeline: {
                  tracks: [
                    {
                      id: 'seeded-track',
                      name: 'Track 1',
                      index: 0,
                      visible: true,
                      locked: false,
                      muted: false,
                      volume: 1,
                      height: 60,
                    },
                  ],
                  clips: [
                    {
                      id: 'seeded-clip',
                      sourceVideoId: 'seeded-video',
                      name: 'Restored clip',
                      startTime: 0,
                      endTime: 5,
                      duration: 5,
                      trackId: 'seeded-track',
                      timelinePosition: 0,
                      blendMode: 'normal',
                      transform: {
                        x: 0.5,
                        y: 0.5,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        opacity: 1,
                        scaleLocked: true,
                      },
                      effects: { blur: 0 },
                      transition: { type: 'none', duration: 0.5 },
                    },
                  ],
                  textOverlays: [],
                  shapeOverlays: [],
                  duration: 5,
                },
              },
              sourceVideos: [
                {
                  id: 'seeded-video',
                  name: 'seeded.webm',
                  duration: 5,
                  width: 1920,
                  height: 1080,
                  frameRate: 30,
                  mimeType: 'video/webm',
                  size: 1024,
                },
              ],
              currentTime: 0,
              selectedClipId: null,
              zoom: 1,
              timestamp: 1_700_000_000_000,
            },
            'current-session'
          )
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error(`session write failed: ${String(tx.error)}`))
        }
      }),
    { dbName: DB_NAME, dbVersion: DB_VERSION }
  )
}

/** The clip element's box on the timeline, which is where its position shows. */
async function clipBox(page: Page, name: string | RegExp) {
  const box = await page.locator('[data-clip-id]').filter({ hasText: name }).boundingBox()
  if (!box) throw new Error(`clip ${String(name)} has no box`)
  return box
}

/** The value beside one of the inspector's transform sliders, e.g. "88%". */
async function transformValue(page: Page, label: string): Promise<string> {
  const row = page
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
  return (await row.locator('span').last().innerText()).trim()
}

/** Open one of the inspector's collapsed sections by its title. */
async function openSection(page: Page, title: string) {
  await page.getByRole('button', { name: title }).click()
}

/**
 * The Mask & Stroke section's kind dropdown.
 *
 * Found by the options it holds rather than by position: the inspector renders
 * several `<select>`s for a media clip (transition, blend mode, the two animation
 * groups) and only this one offers a rounded rectangle.
 */
function maskKindSelect(page: Page) {
  return page.locator('select').filter({ has: page.locator('option[value="rounded"]') })
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

  test('the webcam clip arrives with the circle it was recorded in (ESCSUITE-65)', async ({
    page,
  }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()
    // Collapsed by default (`MaskSection` passes `defaultOpen={false}`), exactly
    // as Blend Mode is.
    await openSection(page, 'Mask & Stroke')

    // The take was recorded with `shape: 'circle'`, and `maskForPlacement` maps
    // that to `{ kind: 'circle' }` with no radius at all — `core/clipMask.ts`
    // inscribes the circle at min(w, h) / 2, which is precisely the circle
    // ESCAPECRAFT drew. jsdom cannot see any of this: the inspector is the only
    // place the handed-over mask is visible as a user sees it.
    await expect(maskKindSelect(page)).toHaveValue('circle')
    expect(await maskKindSelect(page).locator('option:checked').innerText()).toBe('Circle')

    // And the border, in the pixels the user reads rather than the fraction that
    // is stored. This take's screen half is 1920x1080 and the project is
    // ARTIST's own 1920x1080 default, so the camera sat in a 1920-wide frame:
    // craft draws 3 px of a canvas it caps at 1280, which is 1920/1280 x 3 =
    // 4.5 px of that frame, stored as 4.5/1920 and printed back against the
    // project's width by `MaskSection`'s strokePixels.
    expect(await transformValue(page, 'Stroke Width')).toBe('4.5px')
  })

  test('the border is the recording’s 3 px, not the project’s (ESCSUITE-65)', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${SMALL_TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()
    await openSection(page, 'Mask & Stroke')

    // The same circle — the shape does not depend on the capture's size...
    await expect(maskKindSelect(page)).toHaveValue('circle')

    // ...but the border's weight does. This take's screen half is 1280x720, at
    // the compositor's cap, where craft's border is a flat 3 px. Stored as
    // 3/1920 — the *project's* width is what the renderer multiplies back — and
    // printed as 3px. A stroke stored as the flat 3/1280 fraction reads 4.5px
    // here, which is the regression this pins: the two widths coincide on the
    // commonest take (1920 in 1920) and differ the moment they do not, and this
    // is where a user would have seen a border half again as heavy as the
    // recording's.
    expect(await transformValue(page, 'Stroke Width')).toBe('3px')
  })

  test('appends the take after a restored session, and one undo takes it off again', async ({
    page,
  }) => {
    await seedSession(page)

    // No ?suppressRestore=1: this is what ESCAPECRAFT's standalone "Send to
    // Editor" opens, so a user with a saved session meets the prompt while the
    // handoff is still arriving.
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}`)

    await expect(page.getByRole('heading', { name: 'Resume Previous Session?' })).toBeVisible({
      timeout: 15_000,
    })
    // The take is *held* while the question is open. Placing it now would be
    // replaced by the Restore below — setProject plus clearHistory — with no
    // undo step back to it, so the timeline is still the empty default's.
    await expect(page.getByText(/^0 clips · 1 track$/)).toBeVisible()

    await page.getByRole('button', { name: 'Restore Session' }).click()

    // The restored clip, then the take's two parts: the session's one track is
    // occupied, so neither part can reuse it and each lands on a new one.
    await expect(page.getByText(/^3 clips · 3 tracks$/)).toBeVisible({ timeout: 15_000 })

    const restored = await clipBox(page, 'Restored clip')
    const screen = await clipBox(page, /^Handoff take[^—]*$/)
    const webcam = await clipBox(page, '— webcam')
    // Append at the end: the take starts at `calculateTimelineDuration` over
    // the clips already there, which is the restored clip's 5s — so its left
    // edge is that clip's right edge, to within a subpixel of layout. The
    // webcam's own 0.5s startOffset puts it later again.
    expect(Math.abs(screen.x - (restored.x + restored.width))).toBeLessThan(2)
    expect(webcam.x).toBeGreaterThan(screen.x)

    await page.keyboard.press('Control+z')

    // One step, not two or three: `placeTakeOnTimeline` writes both clips and
    // both tracks in a single `set` with a single `pushToHistory`, and the
    // restore's own clearHistory() ran before it, so this is the only step
    // there is to take.
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
    await expect(page.locator('[data-clip-id]')).toHaveCount(1)
    await expect(page.locator('[data-clip-id]')).toContainText('Restored clip')
  })
})
