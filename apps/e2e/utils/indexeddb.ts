import { Page } from '@playwright/test'

/**
 * Utilities for managing IndexedDB in Playwright tests
 */

/**
 * Clear all IndexedDB databases for the current origin
 */
export async function clearIndexedDB(page: Page) {
  await page.evaluate(async () => {
    const databases = await indexedDB.databases()
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name)
      }
    }
  })
}

/**
 * Get all IndexedDB database names
 */
export async function getIndexedDBDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    return databases.map(db => db.name).filter((name): name is string => name !== undefined)
  })
}

/**
 * Check if a specific database exists
 */
export async function databaseExists(page: Page, dbName: string): Promise<boolean> {
  const databases = await getIndexedDBDatabases(page)
  return databases.includes(dbName)
}

/**
 * Wait for IndexedDB transaction to complete
 */
export async function waitForIndexedDB(page: Page, dbName: string, timeout = 5000) {
  await page.waitForFunction(
    async (name) => {
      const databases = await indexedDB.databases()
      return databases.some(db => db.name === name)
    },
    dbName,
    { timeout }
  )
}

/**
 * Get count of records in an object store
 */
export async function getRecordCount(page: Page, dbName: string, storeName: string): Promise<number> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(new Error('Failed to open database'))
        request.onsuccess = () => {
          const db = request.result
          try {
            const transaction = db.transaction(storeName, 'readonly')
            const store = transaction.objectStore(storeName)
            const countRequest = store.count()
            countRequest.onsuccess = () => resolve(countRequest.result)
            countRequest.onerror = () => reject(new Error('Failed to count records'))
          } catch {
            resolve(0) // Store doesn't exist
          }
        }
      })
    },
    { dbName, storeName }
  )
}
