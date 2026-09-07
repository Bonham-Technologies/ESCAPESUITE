// apps/artist/src/headless/seedSources.ts
import { storeVideo } from '@escapesuite/shared/storage'
import { extractMetadataFromBlob } from '../core/projectManager'
import type { SourceVideoInput } from './types'
import type { SourceVideo } from '../store/types'

/** Fields the export engine needs but a streaming caller may not know up front. */
const PROBED_FIELDS = ['width', 'height', 'duration'] as const

/**
 * mediaType the mime type already settles, so it costs no probe. Only `video/*` qualifies:
 * `extractMetadataFromBlob` is the only thing that tells an image apart from an audio file
 * with cover art, and it never sets mediaType for video at all — which is why treating
 * mediaType as a probed field made EVERY video source pay for a probe it did not need.
 */
function impliedMediaType(mimeType: string): SourceVideo['mediaType'] | undefined {
  return mimeType.startsWith('video/') ? 'video' : undefined
}

function needsProbe(meta: SourceVideoInput): boolean {
  if (PROBED_FIELDS.some((field) => meta[field] == null)) return true
  return meta.mediaType == null && impliedMediaType(meta.mimeType) == null
}

/** Drop undefined-valued keys so a partial caller value never overwrites a probed one. */
function definedFields(meta: SourceVideoInput): Partial<SourceVideo> {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Partial<SourceVideo>
}

/**
 * Seed injected source bytes into IndexedDB (video-editor-db) so the export
 * engine's getVideoBlob(id) resolves them unchanged. Keeps the engine untouched.
 *
 * Returns the COMPLETED metadata: a caller may supply only id/name/mimeType (the
 * streaming path does), and the engine's frame sizing needs width/height, so any
 * missing dimension/duration/mediaType is probed from the bytes here. Callers
 * must render with the returned list, not the one they passed in.
 */
export async function seedSources(
  sourceVideos: SourceVideoInput[],
  sourceBlobs: Record<string, ArrayBuffer | Blob>,
): Promise<SourceVideo[]> {
  const completed: SourceVideo[] = []
  for (const meta of sourceVideos) {
    const bytes = sourceBlobs[meta.id]
    if (!bytes) throw new Error(`Missing source bytes for id "${meta.id}"`)
    // A Blob (e.g. a File streamed in through the file input) is stored as-is;
    // only raw bytes need wrapping, which is where the mime type comes from.
    const blob = bytes instanceof ArrayBuffer ? new Blob([bytes], { type: meta.mimeType }) : bytes

    const full = needsProbe(meta)
      ? {
          ...await extractMetadataFromBlob(blob, { id: meta.id, name: meta.name, mimeType: meta.mimeType }),
          ...definedFields(meta),
        }
      : { mediaType: impliedMediaType(meta.mimeType), ...definedFields(meta) } as SourceVideo

    await storeVideo(meta.id, blob, full)
    completed.push(full)
  }
  return completed
}
