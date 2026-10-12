// Builds `.veditor` v2 bundles for the kit's tests (ESCSUITE-260), laid out
// the way ESCAPEARTIST's writer lays them out
// (apps/artist/src/core/projectFileFormat.ts). Test-only: the kit never
// writes a bundle.

/**
 * The first 12 bytes of every v2 header: the magic, then version 2 as a
 * little-endian u32. Spelled out, not imported.
 * apps/artist/src/core/projectFileFormat.test.ts pins the same literal against
 * the editor's writer, so neither side can drift alone.
 */
export const V2_HEADER_PREFIX = [0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00] as const

export interface V2Source {
  id: string
  name: string
  mimeType: string
  bytes: Buffer
  meta?: Record<string, unknown>
  thumbnail?: { bytes: Buffer; mimeType: string }
}

/** The index and payload ESCAPEARTIST's writer would produce for these sources, in this order. */
export function v2IndexAndPayload(
  project: unknown,
  sources: V2Source[],
): { index: Record<string, unknown>; payload: Buffer } {
  const chunks: Buffer[] = []
  let offset = 0
  const videos = sources.map((source) => {
    const entry: Record<string, unknown> = {
      id: source.id,
      name: source.name,
      mimeType: source.mimeType,
      data: { offset, length: source.bytes.length },
    }
    if (source.meta) entry.meta = source.meta
    chunks.push(source.bytes)
    offset += source.bytes.length
    if (source.thumbnail) {
      entry.thumbnail = { offset, length: source.thumbnail.bytes.length, mimeType: source.thumbnail.mimeType }
      chunks.push(source.thumbnail.bytes)
      offset += source.thumbnail.bytes.length
    }
    return entry
  })
  return { index: { version: 2, project, videos }, payload: Buffer.concat(chunks) }
}

/** Header + index + payload. `header` overrides the version or the declared index length. */
export function assembleV2(
  index: unknown,
  payload: Buffer,
  header: { version?: number; indexLength?: number } = {},
): Buffer {
  const indexBytes = Buffer.from(typeof index === 'string' ? index : JSON.stringify(index), 'utf8')
  const head = Buffer.alloc(16)
  Buffer.from(V2_HEADER_PREFIX).copy(head, 0)
  if (header.version !== undefined) head.writeUInt32LE(header.version, 8)
  head.writeUInt32LE(header.indexLength ?? indexBytes.length, 12)
  return Buffer.concat([head, indexBytes, payload])
}
