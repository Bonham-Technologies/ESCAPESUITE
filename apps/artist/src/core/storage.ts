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

import { getDB, getStorageEstimate, getThumbnail, createBlobUrl, revokeBlobUrl, type VideoEditorDB } from '@escapesuite/shared/storage'
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

/**
 * Turn a source video's *stored* thumbnail into a fresh object URL, or
 * `undefined` when none is stored. `thumbnailUrl` is only ever an
 * `URL.createObjectURL` handle, and those die with the document — so this is
 * the one mechanism both `projectManager.loadProject` and
 * `useSessionRestore.handleRestoreSession` use to give a restored source video
 * a live URL, rather than trusting one that came from disk (ESCSUITE-96).
 */
export async function resolveThumbnailUrl(id: string): Promise<string | undefined> {
  const thumbnail = await getThumbnail(id)
  return thumbnail ? createBlobUrl(thumbnail) : undefined
}

/**
 * The other half of `resolveThumbnailUrl`: revoke every source's live
 * `thumbnailUrl`, freeing the `URL.createObjectURL` handle it minted. Nothing
 * does this on its own — a blob URL lives for the life of the document, not
 * for the life of the record it points at — so every path that drops a
 * source's `thumbnailUrl` on the floor without freeing it first leaked one:
 * `store/projectSlice.ts`'s `removeSourceVideo` (the one leaving) and
 * `resetProject` (all of them, on teardown); that same file's `addSourceVideo`,
 * in its replace-in-place branch, for the *previous* entry's handle when a
 * re-add under an id already held carries a different `thumbnailUrl` — the one
 * place a source's thumbnail changes without the source itself ever leaving
 * the library, which is how a session restore landing on a library the CRAFT
 * handoff already filled frees only the id it actually replaces; and
 * `useProjectActions.ts`'s `loadProjectFile`, over a REFUSED load's *incoming*
 * sources (`loadProject` mints their thumbnails before validation ever runs) —
 * a *successful* load's outgoing library is `resetProject`'s to free, not this
 * callback's. The media library's Clear All / Clear Unused reach this only
 * indirectly, through `removeSourceVideo` (ESCSUITE-113). A handle that never
 * reached the library at all — `setSourceThumbnail`'s, when the lazy rebuild it
 * carries lost a race with a real load and the source already has a live
 * thumbnail — goes through `revokeThumbnailUrl` directly (ESCSUITE-117). A source with no
 * thumbnail, or a `thumbnailUrl` that is not a `blob:` handle (there is no
 * such source today; the guard is defensive against a future non-blob
 * source), is left alone.
 */
export function revokeSourceThumbnails(sources: SourceVideo[]): void {
  for (const source of sources) revokeThumbnailUrl(source.thumbnailUrl)
}

/**
 * The same revoke for one URL that is not (yet) a source's, so a caller holding
 * a single handle does not have to invent a `SourceVideo` to get it through the
 * guard above. The two share this, so there is still exactly one place a
 * thumbnail handle is freed and one `blob:` check to read.
 *
 * `store/projectSlice.ts`'s `setSourceThumbnail` is the caller: a rebuilt
 * thumbnail that lost its race with a real load never reaches the library, and
 * is freed here instead (ESCSUITE-117).
 */
export function revokeThumbnailUrl(url: string | undefined): void {
  if (url?.startsWith('blob:')) {
    revokeBlobUrl(url)
  }
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
