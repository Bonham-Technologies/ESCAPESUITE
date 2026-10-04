import { test, expect } from '@playwright/test'
import { mockStorageQuotaExceeded } from '../../utils/error-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * K-U3 (ESCSUITE-207). `mockStorageQuotaExceeded` used to poison only
 * `IDBObjectStore.prototype.put` (wrapped per-transaction, not at the
 * prototype), and left `.add` and `IDBCursor.prototype.update` free to
 * write. No current app write path used either — the five write call sites
 * in this repo are all `db.put` — so the gap was latent, not a live defect,
 * but a mock that masks a future write path rather than failing it is worse
 * than one that is simply narrow. This probes the shape directly against
 * IndexedDB rather than through the app, because `errors/export.spec.ts`'s
 * one consumer of this mock never exercises `add` or a cursor at all.
 */
test.describe('Storage Quota Exceeded — mock shape', () => {
  test('poisons put, add and cursor update, and leaves delete free to run', async ({ page }) => {
    // Load the app once, unmocked, so `video-editor-db` and its `videos`
    // store exist, then seed a row the later cursor-update/delete probes can
    // target — before the mock is installed, since the mock would poison
    // this seed write too.
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('video-editor-db')
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('videos', 'readwrite')
            tx.objectStore('videos').put({ id: 'escsuite-207-probe', blob: new Blob(['x']), metadata: {} })
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
          req.onerror = () => reject(req.error)
        })
    )

    // Now install the mock and reload, so its init script is in effect for
    // every write this page makes from here on.
    await mockStorageQuotaExceeded(page)
    await page.reload()
    await waitForAppReady(page, 'artist')

    const result = await page.evaluate(() => {
      function withTx(run: (store: IDBObjectStore) => void): Promise<string> {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('video-editor-db')
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('videos', 'readwrite')
            const store = tx.objectStore('videos')
            try {
              run(store)
            } catch (e) {
              db.close()
              resolve(e instanceof DOMException ? e.name : String(e))
              return
            }
            tx.oncomplete = () => {
              db.close()
              resolve('no throw')
            }
            tx.onerror = () => {
              db.close()
              resolve(tx.error ? tx.error.name : 'tx error')
            }
          }
          req.onerror = () => reject(req.error)
        })
      }

      function cursorUpdate(): Promise<string> {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('video-editor-db')
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('videos', 'readwrite')
            const store = tx.objectStore('videos')
            const curReq = store.openCursor()
            curReq.onsuccess = () => {
              const cursor = curReq.result
              if (!cursor) {
                db.close()
                resolve('no cursor')
                return
              }
              try {
                cursor.update({ ...cursor.value })
              } catch (e) {
                db.close()
                resolve(e instanceof DOMException ? e.name : String(e))
                return
              }
              tx.oncomplete = () => {
                db.close()
                resolve('no throw')
              }
              tx.onerror = () => {
                db.close()
                resolve(tx.error ? tx.error.name : 'tx error')
              }
            }
            curReq.onerror = () => reject(curReq.error)
          }
          req.onerror = () => reject(req.error)
        })
      }

      return (async () => {
        const put = await withTx((store) => {
          store.put({ id: 'escsuite-207-probe', blob: new Blob(['y']), metadata: {} })
        })
        const add = await withTx((store) => {
          store.add({ id: 'escsuite-207-probe-2', blob: new Blob(['y']), metadata: {} })
        })
        // Cursor update before delete: it needs the seeded row still there.
        const cursorUpdateResult = await cursorUpdate()
        const del = await withTx((store) => {
          store.delete('escsuite-207-probe')
        })
        return { put, add, cursorUpdate: cursorUpdateResult, delete: del }
      })()
    })

    expect(result).toEqual({
      put: 'QuotaExceededError',
      add: 'QuotaExceededError',
      cursorUpdate: 'QuotaExceededError',
      delete: 'no throw',
    })
  })
})
