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

export async function hasSpaceForRecording(estimatedSize: number): Promise<boolean> {
  const { quota, available } = await getStorageEstimate()
  // A quota of zero means the browser has no Storage API, or declined to
  // answer — "unknown", not "full". Reading it as "full" would refuse every
  // take in any browser without navigator.storage, which is a far worse
  // failure than letting IndexedDB report the quota error itself.
  if (quota === 0) return true
  return available > estimatedSize + RECORDING_SPACE_BUFFER
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
