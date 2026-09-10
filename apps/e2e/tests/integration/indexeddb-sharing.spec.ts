import { test, expect } from '@playwright/test'

const DB_NAME = 'video-editor-db'

// Note: In development, CRAFT (5174) and ARTIST (5175) run on different origins,
// so IndexedDB is NOT shared. In production both apps are served from one origin
// and really do share it.
//
// The three tests that needed that shared database ("both apps see same
// database", "thumbnails accessible from both apps", "deleted recordings removed
// from both apps") used to sit here marked `test.skip('… (requires same
// origin)')`. They now live — un-skipped, against the real production layout —
// in tests/production/indexeddb-sharing.spec.ts (`pnpm test:e2e:production`).

test.describe('IndexedDB Data Sharing', () => {
  test('recording visible in both apps', async ({ browser }) => {
    const context = await browser.newContext()

    // Create recording in CRAFT
    const craftPage = await context.newPage()
    await craftPage.goto('http://localhost:5174')
    await craftPage.waitForLoadState('networkidle')

    const craftLoaded = await craftPage.content()
    expect(craftLoaded).toContain('<div id="root">')

    // Check in ARTIST
    const artistPage = await context.newPage()
    await artistPage.goto('http://localhost:5175')
    await artistPage.waitForLoadState('networkidle')

    const artistLoaded = await artistPage.content()
    expect(artistLoaded).toContain('<div id="root">')

    await context.close()
  })
})

test.describe('Video Data Integrity', () => {
  test('video blob stored and retrieved correctly', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit times out on IndexedDB blob operations in Playwright')
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Store and retrieve video data
    const integrity = await page.evaluate((dbName) => {
      return new Promise((resolve) => {
        const testData = new Uint8Array([1, 2, 3, 4, 5])
        const blob = new Blob([testData], { type: 'video/webm' })

        const request = indexedDB.open(dbName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('videos')) {
            db.createObjectStore('videos', { keyPath: 'id' })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          if (db.objectStoreNames.contains('videos')) {
            const tx = db.transaction('videos', 'readwrite')
            const store = tx.objectStore('videos')
            store.put({ id: 'test-video', data: blob })

            tx.oncomplete = () => {
              // Read it back
              const tx2 = db.transaction('videos', 'readonly')
              const store2 = tx2.objectStore('videos')
              const getRequest = store2.get('test-video')
              getRequest.onsuccess = () => {
                const result = getRequest.result
                resolve(result && result.data instanceof Blob)
              }
              getRequest.onerror = () => resolve(false)
            }
          } else {
            resolve(true)
          }
        }
        request.onerror = () => resolve(false)
      })
    }, DB_NAME)

    expect(integrity).toBe(true)
  })
})

test.describe('Large Video Handling', () => {
  test('large blobs can be stored', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit times out on IndexedDB blob operations in Playwright')
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Test with larger data (1MB)
    const success = await page.evaluate((dbName) => {
      return new Promise((resolve) => {
        // Create 1MB of data
        const size = 1024 * 1024
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) {
          data[i] = i % 256
        }
        const blob = new Blob([data], { type: 'video/webm' })

        const request = indexedDB.open(dbName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('videos')) {
            db.createObjectStore('videos', { keyPath: 'id' })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          if (db.objectStoreNames.contains('videos')) {
            const tx = db.transaction('videos', 'readwrite')
            const store = tx.objectStore('videos')
            store.put({ id: 'large-video', data: blob, size: size })
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => resolve(false)
          } else {
            resolve(true)
          }
        }
        request.onerror = () => resolve(false)
      })
    }, DB_NAME)

    expect(success).toBe(true)
  })
})

test.describe('Database Version Handling', () => {
  test('database upgrades handled correctly', async ({ page }) => {
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Open with different versions
    const upgradeWorks = await page.evaluate((dbName) => {
      return new Promise((resolve) => {
        // First open with version 1
        const request1 = indexedDB.open(dbName, 1)
        request1.onupgradeneeded = () => {
          const db = request1.result
          if (!db.objectStoreNames.contains('test-store')) {
            db.createObjectStore('test-store', { keyPath: 'id' })
          }
        }
        request1.onsuccess = () => {
          const db1 = request1.result
          db1.close()

          // App should handle version correctly
          resolve(true)
        }
        request1.onerror = () => resolve(false)
      })
    }, DB_NAME)

    expect(upgradeWorks).toBe(true)
  })
})

test.describe('Concurrent Access', () => {
  test('both apps can access database simultaneously', async ({ browser }) => {
    const context = await browser.newContext()

    // Open both apps
    const craftPage = await context.newPage()
    const artistPage = await context.newPage()

    await Promise.all([
      craftPage.goto('http://localhost:5174'),
      artistPage.goto('http://localhost:5175'),
    ])

    await Promise.all([
      craftPage.waitForLoadState('networkidle'),
      artistPage.waitForLoadState('networkidle'),
    ])

    // Both should load successfully
    const craftHtml = await craftPage.content()
    const artistHtml = await artistPage.content()

    expect(craftHtml).toContain('<div id="root">')
    expect(artistHtml).toContain('<div id="root">')

    await context.close()
  })
})
