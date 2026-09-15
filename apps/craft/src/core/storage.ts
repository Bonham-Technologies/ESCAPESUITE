// ESCAPECRAFT storage layer - extends shared storage with recording-specific operations

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

import { getAllVideoMetadata, getDB, getStorageEstimate } from '@escapesuite/shared/storage'

// Recording-specific operations

export async function getRecordingsMetadata() {
  const all = await getAllVideoMetadata()
  return all.filter(v => v.source === 'recording')
}

/** Headroom kept free on top of whatever the take itself is expected to need. */
export const RECORDING_SPACE_BUFFER = 50 * 1024 * 1024

/** The share of a small quota a single take may need before we refuse it. */
export const RECORDING_SPACE_QUOTA_SHARE = 0.25

/**
 * Whether there is room to record, as far as the browser will say.
 *
 * **This check errs toward letting you record.** Both directions are wrong in
 * some way and only one of them is recoverable: a missed warning ends with
 * IndexedDB reporting its own quota error at save time, which the save path
 * already surfaces; a false "no space" refuses the take outright, with advice
 * ("delete a recording") the user may have nothing to act on. So:
 *
 * - **Unknown is not full.** A quota of zero means the browser has no Storage
 *   API, or declined to answer. Reading that as "full" refused every take in
 *   any browser without `navigator.storage` — jsdom included, which is why
 *   nothing could call this helper before.
 * - **The bar is relative on a small quota.** A flat `estimate + buffer` is
 *   ~100MB, which a private or ephemeral profile may never have; it would
 *   refuse a 1MB webcam clip in a fresh window with nothing stored. The
 *   requirement is the *lower* of that flat figure and a quarter of whatever
 *   quota the browser reports, so a roomy profile keeps the full 100MB margin
 *   and a constrained one is asked only for a quarter of what it has.
 */
export async function hasSpaceForRecording(estimatedSize: number): Promise<boolean> {
  const { quota, available } = await getStorageEstimate()
  if (quota === 0) return true
  const required = Math.min(
    estimatedSize + RECORDING_SPACE_BUFFER,
    quota * RECORDING_SPACE_QUOTA_SHARE
  )
  return available > required
}

export async function getTotalRecordingsSize(): Promise<number> {
  const db = await getDB()
  const records = await db.getAll('videos')
  return records
    .filter(r => r.metadata.source === 'recording')
    .reduce((total, record) => total + (record.blob?.size || 0), 0)
}

export async function clearAllRecordings(): Promise<void> {
  const db = await getDB()
  const records = await db.getAll('videos')

  for (const record of records) {
    if (record.metadata.source === 'recording') {
      await db.delete('videos', record.id)
      await db.delete('thumbnails', record.id)
    }
  }
}
