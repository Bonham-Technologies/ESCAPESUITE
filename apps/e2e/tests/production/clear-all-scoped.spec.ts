import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, Page } from '@playwright/test'
import { getRecordCount, waitForIndexedDB } from '../../utils/indexeddb'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-142: ESCAPEARTIST's media library "Clear All" must not delete
 * ESCAPECRAFT's recordings.
 *
 * The bug this proves fixed only exists on the production single-origin
 * layout — the two apps' dev servers (5174 / 5175) are two origins and never
 * share `video-editor-db` at all, so the regression could not have shown up
 * there. This spec seeds a CRAFT-shaped take directly into the shared
 * database (the same `putRecord` pattern `indexeddb-sharing.spec.ts` in this
 * directory uses, rather than driving a real recording through
 * `mockSyntheticMedia` — the point here is the cross-app guarantee, not the
 * recorder), imports an unrelated file into ARTIST's own library, clicks
 * Clear All there, and reloads CRAFT: its take must still be listed.
 *
 * Before the fix (`clearAllVideos()` doing `db.clear('videos')` across the
 * whole shared database) this reproduced the reported loss exactly — CRAFT's
 * take vanished along with ARTIST's own imported file.
 */

const DB_NAME = 'video-editor-db'
const CRAFT_URL = 'http://localhost:5190/craft/'
const ARTIST_URL = 'http://localhost:5190/artist/'
const FIXTURE_MP4 = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/headless/source.mp4'
)

const CRAFT_TAKE_ID = 'clear-all-e2e-craft-take'
const CRAFT_TAKE_NAME = 'Clear All E2E Take.webm'

/**
 * Put one record into a store of the shared database, with a real Blob of the
 * given size attached — sized deliberately large enough (a couple of MB) that
 * the browser's own `navigator.storage.estimate()` reports well over the 1MB
 * ARTIST's storage bar (and so its Clear All button) gates on, the way an
 * actual recording would.
 */
async function putVideoRecord(
  page: Page,
  record: { id: string; metadata: Record<string, unknown> },
  blobBytes: number
) {
  await page.evaluate(
    ({ dbName, record, blobBytes }) => {
      return new Promise((resolve, reject) => {
        const value = {
          ...record,
          blob: new Blob([new Uint8Array(blobBytes)], { type: 'video/webm' }),
        }
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          try {
            const tx = db.transaction('videos', 'readwrite')
            tx.objectStore('videos').put(value)
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => reject(tx.error)
          } catch (error) {
            reject(error)
          }
        }
      })
    },
    { dbName: DB_NAME, record, blobBytes }
  )
}

/** Open ESCAPECRAFT and wait for it to create/open the shared database. */
async function openCraft(page: Page) {
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  await waitForIndexedDB(page, DB_NAME)
}

test.describe('Clear All in ARTIST is scoped to its own library (ESCSUITE-142)', () => {
  test('leaves a CRAFT recording in the shared database untouched', async ({ browser }) => {
    test.setTimeout(60_000)
    const context = await browser.newContext()

    // Seed a CRAFT-shaped take straight into the shared database — a row
    // ARTIST's own media library never held and has no entry for.
    const craftPage = await context.newPage()
    await openCraft(craftPage)
    await putVideoRecord(
      craftPage,
      {
        id: CRAFT_TAKE_ID,
        metadata: {
          id: CRAFT_TAKE_ID,
          name: CRAFT_TAKE_NAME,
          source: 'recording',
          duration: 5,
          width: 1280,
          height: 720,
          frameRate: 30,
          mimeType: 'video/webm',
          size: 2 * 1024 * 1024,
        },
      },
      2 * 1024 * 1024
    )
    expect(await getRecordCount(craftPage, DB_NAME, 'videos')).toBeGreaterThan(0)

    // ARTIST imports a different file into its own library — the take above
    // is never handed to ARTIST at all, the way it would not be if CRAFT's
    // user never sent it to the editor.
    const artistPage = await context.newPage()
    await artistPage.goto(ARTIST_URL)
    await waitForAppReady(artistPage, 'artist')

    await artistPage.locator('input[type="file"]').setInputFiles(FIXTURE_MP4)
    const addToTimeline = artistPage.getByRole('button', { name: 'Add to timeline' })
    await expect(addToTimeline).toBeVisible({ timeout: 60_000 })

    // Clear All, confirmed.
    artistPage.once('dialog', (dialog) => dialog.accept())
    const clearAll = artistPage.getByRole('button', { name: 'Clear All' })
    await expect(clearAll).toBeVisible({ timeout: 15_000 })
    await expect(clearAll).toBeEnabled()
    await clearAll.click()

    // ARTIST's own import is gone from its library.
    await expect(addToTimeline).not.toBeVisible({ timeout: 15_000 })

    // Reload CRAFT: its take is still there, both in the database and in its
    // own recordings list.
    await craftPage.reload()
    await waitForAppReady(craftPage, 'craft')
    await expect(craftPage.getByText(CRAFT_TAKE_NAME)).toBeVisible({ timeout: 30_000 })
    expect(await getRecordCount(craftPage, DB_NAME, 'videos')).toBeGreaterThan(0)

    await context.close()
  })
})
