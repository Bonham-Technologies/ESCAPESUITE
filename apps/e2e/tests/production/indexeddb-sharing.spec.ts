import { test, expect, Page } from '@playwright/test'
import { databaseExists, getRecordCount } from '../../utils/indexeddb'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'

/**
 * Cross-app IndexedDB sharing, on the production single-origin layout.
 *
 * These three tests used to live in `tests/integration/indexeddb-sharing.spec.ts`
 * marked `test.skip('… (requires same origin)')`: the dev servers put CRAFT on
 * :5174 and ARTIST on :5175, two origins, so they never share storage. Here both
 * apps are served from the combined production build on ONE port, so
 * `video-editor-db` really is one database — which is what ships.
 *
 * The stores are the real ones the apps create (`videos`, `thumbnails`,
 * `projects`, `settings` — see packages/shared/src/storage), so the database is
 * opened without a version: whichever app loaded first already created it.
 */

const DB_NAME = 'video-editor-db'
const CRAFT_URL = 'http://localhost:5190/craft/'
const ARTIST_URL = 'http://localhost:5190/artist/'

/**
 * Put one record into a store of the shared database. With `attachBlob` the
 * record gets a real video Blob, the way a recording is actually stored.
 */
async function putRecord(
  page: Page,
  storeName: string,
  record: Record<string, unknown>,
  attachBlob = false
) {
  await page.evaluate(
    ({ dbName, storeName, record, attachBlob }) => {
      return new Promise((resolve, reject) => {
        const value: Record<string, unknown> = { ...record }
        if (attachBlob) {
          value.blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/webm' })
        }
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(value)
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { dbName: DB_NAME, storeName, record, attachBlob }
  )
}

/** Delete one record from a store of the shared database. */
async function deleteRecord(page: Page, storeName: string, id: string) {
  await page.evaluate(
    ({ dbName, storeName, id }) => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).delete(id)
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { dbName: DB_NAME, storeName, id }
  )
}

/** Does a record with this id exist in the store, seen from this page? */
async function hasRecord(page: Page, storeName: string, id: string): Promise<boolean> {
  return page.evaluate(
    ({ dbName, storeName, id }) => {
      return new Promise<boolean>((resolve) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(false)
            return
          }
          const getRequest = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
          getRequest.onsuccess = () => resolve(!!getRequest.result)
          getRequest.onerror = () => resolve(false)
        }
      })
    },
    { dbName: DB_NAME, storeName, id }
  )
}

/** Size of a stored video blob as seen from this page, or -1 if it isn't one. */
async function readBlobSize(page: Page, storeName: string, id: string): Promise<number> {
  return page.evaluate(
    ({ dbName, storeName, id }) => {
      return new Promise<number>((resolve) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => resolve(-1)
        request.onsuccess = () => {
          const getRequest = request.result
            .transaction(storeName, 'readonly')
            .objectStore(storeName)
            .get(id)
          getRequest.onsuccess = () => {
            const blob = (getRequest.result as { blob?: unknown } | undefined)?.blob
            resolve(blob instanceof Blob ? blob.size : -1)
          }
          getRequest.onerror = () => resolve(-1)
        }
      })
    },
    { dbName: DB_NAME, storeName, id }
  )
}

/** Open ESCAPECRAFT and wait for it to create/open the shared database. */
async function openCraft(page: Page) {
  await page.goto(CRAFT_URL)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  expect(await databaseExists(page, DB_NAME)).toBe(true)
}

/** Open ESCAPEARTIST (optionally with a `?loadVideo=` handoff). */
async function openArtist(page: Page, search = '') {
  await page.goto(`${ARTIST_URL}${search}`)
  await page.waitForLoadState('networkidle')
}

test.describe('IndexedDB Data Sharing', () => {
  test('both apps see same database', async ({ browser }) => {
    const context = await browser.newContext()

    // Write data in CRAFT
    const craftPage = await context.newPage()
    await openCraft(craftPage)

    await putRecord(
      craftPage,
      'videos',
      {
        id: 'shared-video',
        metadata: { id: 'shared-video', name: 'Test Recording', timestamp: Date.now() },
      },
      true
    )

    // Check in ARTIST
    const artistPage = await context.newPage()
    await openArtist(artistPage)

    const hasData = await hasRecord(artistPage, 'videos', 'shared-video')

    expect(hasData).toBe(true)
    expect(await getRecordCount(artistPage, DB_NAME, 'videos')).toBeGreaterThan(0)
    // The blob itself crosses, not just the key
    expect(await readBlobSize(artistPage, 'videos', 'shared-video')).toBe(5)

    await context.close()
  })

  test('a recording made in CRAFT opens in ARTIST', async ({ browser }) => {
    // A real recording plus the editor picking it back up
    test.setTimeout(120_000)

    const context = await browser.newContext()
    const craftPage = await context.newPage()

    await mockSyntheticMedia(craftPage)
    await grantMediaPermissions(craftPage)
    await openCraft(craftPage)

    // Capability detection is async; the source toggles stay disabled until it
    // finishes and starting before then acquires no stream.
    const screenSource = craftPage
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await craftPage.getByRole('button', { name: 'Start recording' }).click()
    await expect(craftPage.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await craftPage.waitForTimeout(2500)
    await craftPage.getByRole('button', { name: 'Stop recording' }).click()

    const openInEditor = craftPage.getByRole('button', { name: /Open .+ in Editor/ })
    await expect(openInEditor).toBeVisible({ timeout: 30_000 })
    expect(await getRecordCount(craftPage, DB_NAME, 'videos')).toBeGreaterThan(0)

    // "Open in Editor" addresses the recording by id — ARTIST reads the blob out
    // of the database CRAFT just wrote to, which only works on one origin.
    const artistPromise = context.waitForEvent('page')
    await openInEditor.click()
    const artistPage = await artistPromise
    await artistPage.waitForLoadState('networkidle')

    expect(artistPage.url()).toMatch(/\/artist\/\?loadVideo=[0-9a-f-]+$/)
    await expect(artistPage.getByText(/Loaded recording:/)).toBeVisible({ timeout: 30_000 })
    await expect(artistPage.getByRole('button', { name: 'Add to timeline' })).toBeVisible({
      timeout: 30_000,
    })

    await context.close()
  })
})

test.describe('Thumbnails Shared Correctly', () => {
  test('thumbnails accessible from both apps', async ({ browser }) => {
    const context = await browser.newContext()

    // Store thumbnail in CRAFT
    const craftPage = await context.newPage()
    await openCraft(craftPage)

    await putRecord(craftPage, 'thumbnails', { id: 'thumb-1', videoId: 'video-1' })

    // Verify accessible from ARTIST
    const artistPage = await context.newPage()
    await openArtist(artistPage)

    const hasThumbnail = await hasRecord(artistPage, 'thumbnails', 'thumb-1')

    expect(hasThumbnail).toBe(true)

    await context.close()
  })
})

test.describe('Storage Cleanup Propagates', () => {
  test('deleted recordings removed from both apps', async ({ browser }) => {
    const context = await browser.newContext()

    // Create in CRAFT
    const craftPage = await context.newPage()
    await openCraft(craftPage)

    await putRecord(
      craftPage,
      'videos',
      { id: 'to-delete', metadata: { id: 'to-delete', name: 'Delete Me' } },
      true
    )
    expect(await hasRecord(craftPage, 'videos', 'to-delete')).toBe(true)

    await deleteRecord(craftPage, 'videos', 'to-delete')

    // Verify deleted in ARTIST
    const artistPage = await context.newPage()
    await openArtist(artistPage)

    const stillExists = await hasRecord(artistPage, 'videos', 'to-delete')

    expect(stillExists).toBe(false)

    await context.close()
  })
})
