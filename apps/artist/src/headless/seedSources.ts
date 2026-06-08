// apps/artist/src/headless/seedSources.ts
import { storeVideo } from '@escapesuite/shared/storage'
import type { SourceVideo } from '../store/types'

/**
 * Seed injected source bytes into IndexedDB (video-editor-db) so the export
 * engine's getVideoBlob(id) resolves them unchanged. Keeps the engine untouched.
 */
export async function seedSources(
  sourceVideos: SourceVideo[],
  sourceBlobs: Record<string, ArrayBuffer>,
): Promise<void> {
  for (const meta of sourceVideos) {
    const buf = sourceBlobs[meta.id]
    if (!buf) throw new Error(`Missing source bytes for id "${meta.id}"`)
    const blob = new Blob([buf], { type: meta.mimeType })
    await storeVideo(meta.id, blob, meta)
  }
}
