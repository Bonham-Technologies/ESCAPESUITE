// Test fixture: empty the recordings out of the shared IndexedDB between tests.
//
// This used to live in `core/storage.ts`, but nothing in the app ever called
// it — the recorder deletes one recording at a time, from the library panel.
// Its only callers were the `beforeEach` of four suites that need a clean
// database, which is what it is: a fixture, not part of the storage API. It
// lives under `src/test/` so it is neither shipped nor counted as app code.

import { getDB } from '@escapesuite/shared/storage'

/** Delete every recording-sourced video and its thumbnail. Imports are left alone. */
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
