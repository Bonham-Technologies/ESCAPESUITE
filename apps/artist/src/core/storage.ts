// ESCAPEARTIST storage layer - extends shared storage with project-specific operations

import type { Project, EditorBlock } from '../store/types'

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
  listSettings,
  getStorageEstimate,
  createBlobUrl,
  revokeBlobUrl,
  type VideoEditorDB,
} from '@escapesuite/shared/storage'

// Re-export SourceVideo type for convenience
export type { SourceVideo } from '@escapesuite/shared/types'

import {
  getDB,
  getSetting,
  getStorageEstimate,
  getThumbnail,
  listSettings,
  setSetting,
  createBlobUrl,
  revokeBlobUrl,
  type VideoEditorDB,
} from '@escapesuite/shared/storage'
import type { IDBPDatabase } from 'idb'
import type { SourceVideo } from '@escapesuite/shared/types'

// Session state for auto-save/restore
export interface SessionState {
  /**
   * The tab whose slot this is (ESCSUITE-274): its row is `session:<tabId>`.
   * A row written before that ticket — the one slot every tab shared — has no
   * `tabId` at runtime; `listSessionStates` hands it back as a slot with no
   * owner rather than trusting this field.
   */
  tabId: string
  project: Project
  sourceVideos: SourceVideo[]
  currentTime: number
  selectedClipId: string | null
  zoom: number
  /** In/out points and markers (ESCSUITE-245). Absent on a session saved before it. */
  editor?: EditorBlock
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
 * `store/projectSlice.ts`'s `removeSourceVideosPermanently` (every one in the
 * batch) and `resetProject` (all of them, on teardown); that same file's
 * `addSourceVideo`, in its replace-in-place branch, for the *previous*
 * entry's handle when a re-add under an id already held carries a different
 * `thumbnailUrl` — the one place a source's thumbnail changes without the
 * source itself ever leaving the library, which is how a session restore
 * landing on a library the CRAFT handoff already filled frees only the id it
 * actually replaces; and `useProjectActions.ts`'s `loadProjectFile`, over a
 * REFUSED load's *incoming* sources (`loadProject` mints their thumbnails
 * before validation ever runs) — a *successful* load's outgoing library is
 * `resetProject`'s to free, not this callback's. The media library's
 * per-item Remove, Clear All and Clear Unused (ESCSUITE-149, ESCSUITE-154)
 * reach this only indirectly, through `removeSourceVideosPermanently`
 * (ESCSUITE-113). A handle that never reached the library at all —
 * `setSourceThumbnail`'s, when the lazy rebuild it
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

// Session state operations (auto-save/restore)
//
// One slot per tab (ESCSUITE-274): each tab autosaves to its own `settings`
// row, `session:<tabId>`, so a tab that crashed keeps its session however long
// another tab goes on editing. Before that ticket every tab shared the one row
// `current-session`; a row still there from an older build is read as a slot
// with no owner (`tabId: null`) and deleted once it is restored, declined or
// pruned — nothing writes it any more.
export const SESSION_KEY_PREFIX = 'session:'
export const LEGACY_SESSION_KEY = 'current-session'

/** A saved session and the tab whose slot it is — `null` for the legacy shared row. */
export interface SessionSlot {
  tabId: string | null
  session: SessionState
}

const sessionKey = (tabId: string | null): string =>
  tabId === null ? LEGACY_SESSION_KEY : `${SESSION_KEY_PREFIX}${tabId}`

/** Write `session` into its own tab's slot, `session:<session.tabId>`. */
export async function saveSessionState(session: SessionState): Promise<void> {
  await setSetting(sessionKey(session.tabId), session)
}

/** Every saved session: each tab's slot, then the legacy shared row if one is left. */
export async function listSessionStates(): Promise<SessionSlot[]> {
  const [rows, legacy] = await Promise.all([
    listSettings<SessionState>(SESSION_KEY_PREFIX),
    getSetting<SessionState>(LEGACY_SESSION_KEY),
  ])
  const slots: SessionSlot[] = rows.map(({ key, value }) => ({
    tabId: key.slice(SESSION_KEY_PREFIX.length),
    session: value,
  }))
  if (legacy) slots.push({ tabId: null, session: legacy })
  return slots
}

/** Remove one tab's slot — or, given `null`, the legacy shared row. */
export async function clearSessionState(tabId: string | null): Promise<void> {
  const db = await getDB()
  await db.delete('settings', sessionKey(tabId))
}
