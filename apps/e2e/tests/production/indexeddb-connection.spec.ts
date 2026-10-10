import { test, expect, type Page } from '@playwright/test'
import { ARTIST_FIXTURE_MP4 } from '../../utils/artist'
import { getRecordCount } from '../../utils/indexeddb'
import { waitForAppReady } from '../../utils/ready'

/**
 * The shared `video-editor-db` connection, in the production bundle
 * (ESCSUITE-226).
 *
 * `getDB()` (packages/shared/src/storage) used to cache the connection only
 * once its open had resolved, so ARTIST's startup — two callers on first use —
 * opened two connections, and once the browser closed the cached one (DevTools
 * "Clear site data", a storage eviction) every later save failed with
 * `InvalidStateError: The database connection is closing` until a reload.
 *
 * Production layout because that is the bundle that ships; ARTIST alone,
 * because the defect is in the one module both apps share.
 */

const DB_NAME = 'video-editor-db'
const ORIGIN = 'http://localhost:5190'
const ARTIST_URL = `${ORIGIN}/artist/?suppressRestore=1`

test.describe('Shared IndexedDB connection', () => {
  test.beforeEach(async ({ page }) => {
    // Count the app's opens of the shared database. Read before the test's own
    // helpers open it, which go through the same `indexedDB.open`.
    await page.addInitScript((dbName) => {
      const w = window as unknown as { __appOpens: number }
      w.__appOpens = 0
      const open = indexedDB.open.bind(indexedDB)
      indexedDB.open = ((name: string, version?: number) => {
        if (name === dbName) w.__appOpens++
        return open(name, version)
      }) as typeof indexedDB.open
    }, DB_NAME)
  })

  const appOpens = (page: Page) =>
    page.evaluate(() => (window as unknown as { __appOpens: number }).__appOpens)

  test('opens one connection for startup and an import', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)
    await expect(page.getByRole('button', { name: 'Add to timeline' })).toHaveCount(1, {
      timeout: 30_000,
    })

    // Startup's callers and the import's writes have all been through
    // `getDB()` by now: one open between them.
    expect(await appOpens(page)).toBe(1)
  })

  test('a save after the browser clears site data reopens the database and lands', async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    const tiles = page.getByRole('button', { name: 'Add to timeline' })
    await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)
    await expect(tiles).toHaveCount(1, { timeout: 30_000 })
    expect(await appOpens(page)).toBe(1)

    // What DevTools' "Clear site data" does to an open tab: the database is
    // deleted and every connection to it closed out from under the page.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' })

    // The second import's writes reopen the database and land. The first
    // tile is still in the in-memory library; the store holds only the second.
    await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)
    await expect(tiles).toHaveCount(2, { timeout: 30_000 })
    expect(await appOpens(page)).toBe(2)
    expect(await getRecordCount(page, DB_NAME, 'videos')).toBe(1)
    expect(pageErrors.filter((message) => message.includes('InvalidStateError'))).toEqual([])
  })
})
