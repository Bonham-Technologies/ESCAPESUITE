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

// Singleton database instance
let dbInstance: IDBPDatabase<VideoEditorDB> | null = null

/**
 * Get the shared database instance
 */
export async function getDB(): Promise<IDBPDatabase<VideoEditorDB>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<VideoEditorDB>(DB_NAME, DB_VERSION, {
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
  })

  return dbInstance
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
