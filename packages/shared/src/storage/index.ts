// Shared IndexedDB storage operations
// Used by both ESCAPECRAFT and ESCAPEARTIST

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SourceVideo } from '../types'

// Shared database configuration
export const DB_NAME = 'video-editor-db'
export const DB_VERSION = 1

// Database schema - common between apps
export interface VideoEditorDB extends DBSchema {
  videos: {
    key: string
    value: {
      id: string
      blob: Blob
      metadata: SourceVideo
    }
  }
  thumbnails: {
    key: string
    value: {
      id: string
      blob: Blob
    }
  }
  projects: {
    key: string
    value: unknown
  }
  settings: {
    key: string
    value: unknown
  }
}

// The one opening of the shared database, cached as a promise so callers
// racing on first use share it rather than each opening a connection.
let dbPromise: Promise<IDBPDatabase<VideoEditorDB>> | null = null

/**
 * Get the shared database connection.
 *
 * Both apps and the headless kit call this per operation and never hold the
 * result, so the connection lives here and nowhere else (ESCSUITE-226):
 *
 * - **One open, shared.** The *promise* of the open is cached, not its result,
 *   so two callers on first use get the same connection instead of opening
 *   two. An open that rejects is dropped from the cache, so the next call
 *   tries again rather than failing forever.
 * - **`terminated`** — the browser closed the connection abnormally (DevTools
 *   "Clear site data", `Storage.clearDataForOrigin`, a storage eviction).
 *   The cache is dropped, so the next call reopens and `upgrade` recreates the
 *   stores; without this every later call failed with `InvalidStateError`
 *   until the page was reloaded.
 * - **`blocking`** — another connection asked for a version change or a delete
 *   (`versionchange` on this one). This connection closes itself and drops
 *   the cache, so a `deleteDatabase` or a future `DB_VERSION` bump is never
 *   blocked by an open tab. After a delete the next call here recreates the
 *   database; after an upgrade by a newer tab, calls here reject with
 *   `VersionError` (reportably, each one) until the page is reloaded.
 * - **`blocked`** — this open is waiting on another tab's older connection.
 *   One `console.warn` names the database, so a stuck upgrade is diagnosable.
 *
 * `terminated` and `blocking` drop the cache only while it still holds *their*
 * open: `close()` lets running transactions finish, so a connection `blocking`
 * already let go of can still be force-closed (and fire `terminated`) after a
 * newer open has replaced it, and must not drop the newer one.
 *
 * Never `close()` the returned connection: it is shared, and a regular close
 * is not reported back here, so the cache would keep handing it out.
 */
export async function getDB(): Promise<IDBPDatabase<VideoEditorDB>> {
  if (dbPromise) return dbPromise

  const opening = openDB<VideoEditorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Videos store - holds the actual video blobs
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' })
      }

      // Thumbnails store
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: 'id' })
      }

      // Projects store
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
    },
    blocked() {
      console.warn(
        `[storage] Opening ${DB_NAME} is waiting for another tab to close its connection.`,
      )
    },
    blocking() {
      if (dbPromise === opening) dbPromise = null
      // `opening` has resolved: idb attaches this hook only to an open that did.
      void opening.then((db) => db.close())
    },
    terminated() {
      if (dbPromise === opening) dbPromise = null
    },
  })
  dbPromise = opening
  // The caller sees the rejection through `opening`; this only forgets it.
  opening.catch(() => {
    dbPromise = null
  })

  return opening
}

// Video operations

export async function storeVideo(id: string, blob: Blob, metadata: SourceVideo): Promise<void> {
  const db = await getDB()
  await db.put('videos', { id, blob, metadata })
}

export async function getVideo(id: string): Promise<{ blob: Blob; metadata: SourceVideo } | undefined> {
  const db = await getDB()
  const record = await db.get('videos', id)
  if (record) {
    return { blob: record.blob, metadata: record.metadata }
  }
  return undefined
}

export async function getVideoBlob(id: string): Promise<Blob | undefined> {
  const record = await getVideo(id)
  return record?.blob
}

export async function getAllVideoMetadata(): Promise<SourceVideo[]> {
  const db = await getDB()
  const records = await db.getAll('videos')
  return records.map(r => r.metadata)
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('videos', id)
  await db.delete('thumbnails', id)
}

// Thumbnail operations

export async function storeThumbnail(id: string, blob: Blob): Promise<void> {
  const db = await getDB()
  await db.put('thumbnails', { id, blob })
}

export async function getThumbnail(id: string): Promise<Blob | undefined> {
  const db = await getDB()
  const record = await db.get('thumbnails', id)
  return record?.blob
}

// Settings operations

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('settings', value, key)
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return db.get('settings', key) as Promise<T | undefined>
}

// Storage utilities

export async function getStorageEstimate(): Promise<{ used: number; quota: number; available: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate()
    const used = estimate.usage || 0
    const quota = estimate.quota || 0
    return {
      used,
      quota,
      available: quota - used,
    }
  }
  return { used: 0, quota: 0, available: 0 }
}

// Blob URL utilities

export function createBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export function revokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url)
}
