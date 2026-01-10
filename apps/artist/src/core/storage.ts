// ESCAPEARTIST storage layer - extends shared storage with project-specific operations

import type { Project } from '../store/types'

// Re-export all shared storage functions
export {
  DB_NAME,
  DB_VERSION,
  getDB,
  storeVideo,
  getVideo,
  getVideoBlob,
  getAllVideoMetadata,
  deleteVideo,
  storeThumbnail,
  getThumbnail,
  setSetting,
  getSetting,
  getStorageEstimate,
  createBlobUrl,
  revokeBlobUrl,
  type VideoEditorDB,
} from '@escapesuite/shared/storage'

// Re-export SourceVideo type for convenience
export type { SourceVideo } from '@escapesuite/shared/types'

import { getDB, getStorageEstimate, type VideoEditorDB } from '@escapesuite/shared/storage'
import type { IDBPDatabase } from 'idb'
import type { SourceVideo } from '@escapesuite/shared/types'

// Session state for auto-save/restore
export interface SessionState {
  project: Project
  sourceVideos: SourceVideo[]
  currentTime: number
  selectedClipId: string | null
  zoom: number
  timestamp: number
}

// Project operations

export async function storeProject(project: Project): Promise<void> {
  const db = await getDB() as IDBPDatabase<VideoEditorDB & { projects: { key: string; value: Project } }>
  await db.put('projects', project)
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB() as IDBPDatabase<VideoEditorDB & { projects: { key: string; value: Project } }>
  return db.get('projects', id)
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB() as IDBPDatabase<VideoEditorDB & { projects: { key: string; value: Project } }>
  return db.getAll('projects')
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('projects', id)
}

// Storage utilities

export async function clearAllData(): Promise<void> {
  const db = await getDB()
  await db.clear('videos')
  await db.clear('thumbnails')
  await db.clear('projects')
  await db.clear('settings')
}

export async function hasSpaceForFile(fileSize: number): Promise<boolean> {
  const { available } = await getStorageEstimate()
  // Leave 10MB buffer
  return available > fileSize + 10 * 1024 * 1024
}

export async function getTotalVideoSize(): Promise<number> {
  const db = await getDB()
  const records = await db.getAll('videos')
  return records.reduce((total, record) => total + (record.blob?.size || 0), 0)
}

export async function clearAllVideos(): Promise<void> {
  const db = await getDB()
  await db.clear('videos')
  await db.clear('thumbnails')
}

// Session state operations (auto-save/restore)
const SESSION_KEY = 'current-session'

export async function saveSessionState(session: SessionState): Promise<void> {
  const db = await getDB()
  await db.put('settings', session, SESSION_KEY)
}

export async function getSessionState(): Promise<SessionState | undefined> {
  const db = await getDB()
  return db.get('settings', SESSION_KEY) as Promise<SessionState | undefined>
}

export async function clearSessionState(): Promise<void> {
  const db = await getDB()
  await db.delete('settings', SESSION_KEY)
}
