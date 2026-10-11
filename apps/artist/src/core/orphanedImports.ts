import type { SourceVideo } from '@escapesuite/shared/types'

/**
 * The stored rows the media library may offer to remove as "files from
 * earlier sessions" (ESCSUITE-268): imports ESCSUITE-244 stopped orphaning, but
 * which an undo followed by another edit had already stranded in the shared
 * `video-editor-db` before it — listed by neither app's library, and otherwise
 * freed only by clearing site data, which takes every ESCAPECRAFT recording too.
 *
 * A row is offered when nothing here claims it:
 * - its id is not in `projectIds` (the editor's own sources — see
 *   `editorSourceIds`);
 * - it is not an ESCAPECRAFT recording (`source === 'recording'`), whatever its
 *   age — those are ESCAPECRAFT's to list and delete;
 * - its `takeId` names no recording's take — neither a recording's own id nor
 *   a recording's `takeId` — so a take's companion part is ESCAPECRAFT's too,
 *   even one whose primary has already gone.
 *
 * "Not referenced by this editor" is still not "unreferenced": another open
 * editor tab may hold a project whose sources are exactly these rows, which is
 * why the caller asks before deleting and says so.
 */
export function orphanedImports(
  rows: readonly SourceVideo[],
  projectIds: ReadonlySet<string>
): SourceVideo[] {
  const recordingTakes = new Set<string>()
  for (const row of rows) {
    if (row.source !== 'recording') continue
    recordingTakes.add(row.id)
    if (row.takeId) recordingTakes.add(row.takeId)
  }
  return rows.filter((row) =>
    row.source !== 'recording' &&
    !projectIds.has(row.id) &&
    !(row.takeId !== undefined && recordingTakes.has(row.takeId))
  )
}

/**
 * Every source id this editor can still reach: the live library and every
 * undo/redo snapshot's. A snapshot counts because undo hands its library back
 * wholesale — New Project is undoable, so the project it replaced still owns
 * its bytes while that entry is on the stack.
 */
export function editorSourceIds(
  sourceVideos: readonly SourceVideo[],
  snapshots: ReadonlyArray<{ sourceVideos: readonly SourceVideo[] }>
): Set<string> {
  const ids = new Set(sourceVideos.map((v) => v.id))
  for (const snapshot of snapshots) {
    for (const v of snapshot.sourceVideos) ids.add(v.id)
  }
  return ids
}

/**
 * The bytes these rows hold: each row's `size`, which every ESCAPEARTIST writer
 * sets to the byte length of the blob stored beside it (`processMediaFile`'s
 * `file.size`, a project file's own sources) — the same figure Clear Unused and
 * the library tiles show.
 */
export function totalBytes(rows: readonly SourceVideo[]): number {
  return rows.reduce((sum, row) => sum + row.size, 0)
}
