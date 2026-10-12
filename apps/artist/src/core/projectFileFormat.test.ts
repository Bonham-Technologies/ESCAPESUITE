// The .veditor v2 container (ESCSUITE-260), tested directly: no storage, no
// DOM beyond Blob. src/test/setup.ts makes Node's Blob the global one.
import { describe, it, expect } from 'vitest'
import {
  CONTAINER_VERSION,
  HEADER_BYTES,
  MAGIC,
  MAX_INDEX_BYTES,
  ProjectFileError,
  assertRangesTile,
  encodeProjectFile,
  formatSize,
  isV2Header,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
} from './projectFileFormat'
import type { EditorBlock, Project } from '../store/types'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

const project = (name = 'P'): Project => ({
  id: 'p',
  name,
  created: 0,
  modified: 0,
  resolution: { width: 64, height: 48 },
  timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 },
})

/** A Blob that reports `size` and refuses every way of reading it. */
function untouchable(size: number, type: string): Blob {
  const blob = new Blob([], { type })
  Object.defineProperty(blob, 'size', { value: size })
  for (const read of ['arrayBuffer', 'text', 'stream', 'slice', 'bytes']) {
    Object.defineProperty(blob, read, {
      value: () => {
        throw new Error(`${read}() read a source on save`)
      },
    })
  }
  return blob
}

const indexOf = (parts: BlobPart[]): ProjectFileIndex =>
  JSON.parse(new TextDecoder().decode(parts[1] as Uint8Array)) as ProjectFileIndex

const indexLengthIn = (parts: BlobPart[]): number => {
  const header = parts[0] as Uint8Array
  return new DataView(header.buffer, header.byteOffset, HEADER_BYTES).getUint32(12, true)
}

describe('the v2 header', () => {
  it('starts with the 12 bytes the headless kit pins too (services/headless-artist/src/loaders.test.ts)', () => {
    const header = encodeProjectFile(project(), undefined, [])[0] as Uint8Array

    expect(header.length).toBe(16)
    expect(Array.from(header.subarray(0, 12))).toEqual([
      0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00,
    ])
    expect(Array.from(MAGIC)).toEqual([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(CONTAINER_VERSION).toBe(2)
    expect(HEADER_BYTES).toBe(16)
    expect(MAX_INDEX_BYTES).toBe(64 * MiB)
  })

  it('records the index length, little-endian, in bytes 12 to 16', () => {
    const parts = encodeProjectFile(project(), undefined, [])
    expect(indexLengthIn(parts)).toBe((parts[1] as Uint8Array).length)
  })

  // Review Focus 1: N is a byte count. A name outside ASCII makes it longer
  // than the JSON string, and a reader handed the string length would slice
  // the index short.
  it('counts the index in UTF-8 bytes, not characters', () => {
    const parts = encodeProjectFile(project('Café — 日本'), undefined, [])
    const json = JSON.stringify(indexOf(parts))

    expect(indexLengthIn(parts)).toBe(new TextEncoder().encode(json).length)
    expect(indexLengthIn(parts)).toBeGreaterThan(json.length)
  })
})

describe('encodeProjectFile', () => {
  const meta = { duration: 60, width: 1920, height: 1080, frameRate: 30 }

  it('hands the sources over by reference, in index order, without reading a byte of them', () => {
    const a = untouchable(200 * MiB, 'video/mp4')
    const thumbA = untouchable(64 * 1024, 'image/jpeg')
    const b = untouchable(312 * MiB, 'video/webm')

    const parts = encodeProjectFile(project(), undefined, [
      { id: 'a', name: 'a.mp4', mimeType: 'video/mp4', meta, blob: a, thumbnail: thumbA },
      { id: 'b', name: 'b.webm', mimeType: 'video/webm', meta, blob: b },
    ])

    expect(parts).toHaveLength(5)
    expect(parts[2]).toBe(a)
    expect(parts[3]).toBe(thumbA)
    expect(parts[4]).toBe(b)
    const index = indexOf(parts)
    expect(index.videos[0].data).toEqual({ offset: 0, length: 200 * MiB })
    expect(index.videos[0].thumbnail).toEqual({ offset: 200 * MiB, length: 64 * 1024, mimeType: 'image/jpeg' })
    expect(index.videos[1].data).toEqual({ offset: 200 * MiB + 64 * 1024, length: 312 * MiB })
    expect('thumbnail' in index.videos[1]).toBe(false)
  })

  it('writes the version, the project, each source\'s meta and the editor block into the index', () => {
    const editor: EditorBlock = { inPoint: 1, outPoint: 4, markers: [] }
    const parts = encodeProjectFile(project('Named'), editor, [
      { id: 'a', name: 'a.mp4', mimeType: 'video/mp4', meta, blob: new Blob([new Uint8Array([1, 2, 3])]) },
    ])

    const index = indexOf(parts)
    expect(index.version).toBe(2)
    expect(index.project.name).toBe('Named')
    expect(index.editor).toEqual(editor)
    expect(index.videos[0]).toEqual({
      id: 'a',
      name: 'a.mp4',
      mimeType: 'video/mp4',
      meta,
      data: { offset: 0, length: 3 },
    })
  })

  it('leaves the editor key out when there is no block', () => {
    expect('editor' in indexOf(encodeProjectFile(project(), undefined, []))).toBe(false)
  })

  it('writes a header and an index and nothing else for a project with no sources', () => {
    const parts = encodeProjectFile(project(), undefined, [])
    expect(parts).toHaveLength(2)
    expect(indexOf(parts).videos).toEqual([])
  })

  // Review Focus 2.
  it('gives an empty source a zero-length range and starts the next one where it started', () => {
    const parts = encodeProjectFile(project(), undefined, [
      { id: 'empty', name: 'e.mp4', mimeType: 'video/mp4', meta, blob: new Blob([], { type: 'video/mp4' }) },
      { id: 'next', name: 'n.mp4', mimeType: 'video/mp4', meta, blob: new Blob([new Uint8Array([7])]) },
    ])

    expect(indexOf(parts).videos.map((video) => video.data)).toEqual([
      { offset: 0, length: 0 },
      { offset: 0, length: 1 },
    ])
  })

  it('refuses an index over the cap, so it never writes a file its own reader would refuse', () => {
    const exact = (encodeProjectFile(project(), undefined, [])[1] as Uint8Array).length

    expect(() => encodeProjectFile(project(), undefined, [], { maxIndexBytes: exact })).not.toThrow()
    const error = (() => {
      try {
        encodeProjectFile(project(), undefined, [], { maxIndexBytes: exact - 1 })
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).name).toBe('ProjectFileError')
    expect((error as Error).message).toBe(
      `This project's index is ${exact} bytes, over the ${exact - 1}-byte limit a project file can hold.`
    )
  })
})

describe('formatSize', () => {
  it.each([
    [1, '1 MiB'],
    [MiB, '1 MiB'],
    [1.5 * MiB, '2 MiB'],
    [1023 * MiB, '1023 MiB'],
    [GiB, '1.0 GiB'],
    [1.5 * GiB, '1.5 GiB'],
    [1840 * MiB, '1.8 GiB'],
  ])('writes %d bytes as %s', (bytes, words) => {
    expect(formatSize(bytes)).toBe(words)
  })
})

/** Hand-built v2 bytes, for files the writer would never produce. */
function rawV2(
  index: unknown,
  payload: number[] = [],
  header: { version?: number; indexLength?: number } = {}
): Blob {
  const indexBytes = new TextEncoder().encode(typeof index === 'string' ? index : JSON.stringify(index))
  const head = new Uint8Array(HEADER_BYTES)
  head.set([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(head.buffer)
  view.setUint32(8, header.version ?? 2, true)
  view.setUint32(12, header.indexLength ?? indexBytes.length, true)
  return new Blob([head, indexBytes, new Uint8Array(payload)])
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'v',
  name: 'v.mp4',
  mimeType: 'video/mp4',
  data: { offset: 0, length: 3 },
  ...overrides,
})

const indexWith = (videos: unknown[]) => ({ version: 2, project: project(), videos })

async function refusal(blob: Blob): Promise<string> {
  const error = await readProjectFileIndex(blob).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ProjectFileError)
  return (error as Error).message
}

describe('isV2Header', () => {
  const header = () => Uint8Array.of(...MAGIC, 2, 0, 0, 0, 0, 0, 0, 0)

  it('knows a v2 header', () => {
    expect(isV2Header(header())).toBe(true)
  })

  it('refuses fewer than 16 bytes, however they start', () => {
    expect(isV2Header(header().subarray(0, 15))).toBe(false)
  })

  it('refuses a header one magic byte off, as a text-mode transfer leaves it', () => {
    const bytes = header()
    bytes[5] = 0x0d
    expect(isV2Header(bytes)).toBe(false)
  })
})

describe('readProjectFileIndex', () => {
  it('answers null for a v1 JSON file, so the loader takes the v1 path', async () => {
    const v1 = new Blob([JSON.stringify({ version: 1, project: project(), videos: [] })])
    await expect(readProjectFileIndex(v1)).resolves.toBeNull()
  })

  it('answers null for a file shorter than a header', async () => {
    await expect(readProjectFileIndex(new Blob(['{}']))).resolves.toBeNull()
  })

  it('reads back what the writer wrote, the payload starting right after the index', async () => {
    const meta = { duration: 9, width: 64, height: 48, frameRate: 30 }
    const parts = encodeProjectFile(project(), { inPoint: 1, outPoint: 2, markers: [] }, [
      {
        id: 'a',
        name: 'a.mp4',
        mimeType: 'video/mp4',
        meta,
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        thumbnail: new Blob([new Uint8Array([9])], { type: 'image/png' }),
      },
    ])
    const blob = new Blob(parts)

    const read = await readProjectFileIndex(blob)

    expect(read!.payloadStart).toBe(HEADER_BYTES + (parts[1] as Uint8Array).length)
    expect(read!.index.version).toBe(2)
    expect(read!.index.project.name).toBe('P')
    expect(read!.index.editor).toEqual({ inPoint: 1, outPoint: 2, markers: [] })
    expect(read!.index.videos).toEqual([
      {
        id: 'a',
        name: 'a.mp4',
        mimeType: 'video/mp4',
        meta,
        data: { offset: 0, length: 3 },
        thumbnail: { offset: 3, length: 1, mimeType: 'image/png' },
      },
    ])
    expect(() => assertRangesTile(read!.index, read!.payloadStart, blob.size)).not.toThrow()
  })

  it('hands project and editor back as it found them, for parseProject to judge', async () => {
    const read = await readProjectFileIndex(
      rawV2({ version: 2, project: { anything: true }, editor: { inPoint: 5, outPoint: 1 }, videos: [] })
    )
    expect(read!.index.project).toEqual({ anything: true })
    expect(read!.index.editor).toEqual({ inPoint: 5, outPoint: 1 })
  })

  it('refuses a newer container version by name', async () => {
    expect(await refusal(rawV2(indexWith([]), [], { version: 3 }))).toBe(
      'this file was saved by a newer ESCAPEARTIST (format version 3); update ESCAPEARTIST to open it'
    )
  })

  it('refuses a header that names a version no ESCAPEARTIST writes', async () => {
    expect(await refusal(rawV2(indexWith([]), [], { version: 1 }))).toBe(
      'its header names format version 1, which no ESCAPEARTIST writes'
    )
  })

  it('refuses an index longer than the cap before slicing it', async () => {
    expect(await refusal(rawV2('', [], { indexLength: MAX_INDEX_BYTES + 1 }))).toBe(
      `its index claims ${MAX_INDEX_BYTES + 1} bytes, over the ${MAX_INDEX_BYTES}-byte limit`
    )
  })

  it('takes an index exactly at the cap, and then refuses it for running past the end of a short file', async () => {
    expect(await refusal(rawV2('', [], { indexLength: MAX_INDEX_BYTES }))).toBe(
      `the file ends before its index does: it is 16 bytes and its index runs to byte ${16 + MAX_INDEX_BYTES}`
    )
  })

  it('refuses an index that is not JSON', async () => {
    expect(await refusal(rawV2('{oops'))).toBe('its index is not valid JSON')
  })

  // Review Focus 2.
  it('refuses an empty index as not JSON', async () => {
    expect(await refusal(rawV2(''))).toBe('its index is not valid JSON')
  })

  it.each([
    ['a list', []],
    ['an index of another version', { version: 1, project: project(), videos: [] }],
    ['an index whose videos are not a list', { version: 2, project: project(), videos: {} }],
  ])('refuses %s', async (_case, index) => {
    expect(await refusal(rawV2(index))).toBe('its index is not a version 2 project index')
  })

  it.each([
    ['a null entry', null],
    ['an id that is not a string', entry({ id: 7 })],
    ['a missing name', entry({ name: undefined })],
    ['a missing type', entry({ mimeType: undefined })],
  ])('refuses %s', async (_case, video) => {
    expect(await refusal(rawV2(indexWith([video]), [1, 2, 3]))).toBe('video #0 has no id, name or type')
  })

  it('names the entry that is broken when it is not the first', async () => {
    expect(await refusal(rawV2(indexWith([entry(), null]), [1, 2, 3]))).toBe('video #1 has no id, name or type')
  })

  it('refuses a meta that is not an object, and takes an entry with no meta', async () => {
    expect(await refusal(rawV2(indexWith([entry({ meta: 'x' })]), [1, 2, 3]))).toBe(
      "video #0's meta is not an object"
    )
    const read = await readProjectFileIndex(rawV2(indexWith([entry()]), [1, 2, 3]))
    expect(read!.index.videos[0].meta).toBeUndefined()
  })

  it.each([
    ['no data at all', undefined],
    ['a v1 base64 string', 'AAAA'],
    ['an offset that is not whole', { offset: 1.5, length: 3 }],
    ['a negative length', { offset: 0, length: -1 }],
    ['an offset past 2^53', { offset: 2 ** 53, length: 3 }],
  ])('refuses a data range that is %s', async (_case, data) => {
    expect(await refusal(rawV2(indexWith([entry({ data })]), [1, 2, 3]))).toBe("video #0's data is not a byte range")
  })

  it('refuses a thumbnail that is not a byte range', async () => {
    expect(await refusal(rawV2(indexWith([entry({ thumbnail: 'x' })]), [1, 2, 3]))).toBe(
      "video #0's thumbnail is not a byte range"
    )
  })

  it('refuses a thumbnail with no type', async () => {
    expect(
      await refusal(rawV2(indexWith([entry({ thumbnail: { offset: 3, length: 1 } })]), [1, 2, 3, 4]))
    ).toBe("video #0's thumbnail has no type")
  })
})

describe('assertRangesTile', () => {
  const tiled = (videos: ProjectFileIndex['videos']): ProjectFileIndex => ({ version: 2, project: project(), videos })
  const v = (offset: number, length: number, thumbnail?: { offset: number; length: number }) => ({
    id: 'v',
    name: 'v.mp4',
    mimeType: 'video/mp4',
    data: { offset, length },
    ...(thumbnail && { thumbnail: { ...thumbnail, mimeType: 'image/jpeg' } }),
  })
  const tileError = (index: ProjectFileIndex, payloadStart: number, size: number): string => {
    try {
      assertRangesTile(index, payloadStart, size)
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFileError)
      return (error as Error).message
    }
    throw new Error('assertRangesTile accepted it')
  }

  it('accepts ranges that tile the payload exactly, thumbnails included', () => {
    expect(() => assertRangesTile(tiled([v(0, 3, { offset: 3, length: 2 }), v(5, 4)]), 100, 109)).not.toThrow()
  })

  it('accepts no sources and an empty payload', () => {
    expect(() => assertRangesTile(tiled([]), 100, 100)).not.toThrow()
  })

  // Review Focus 2.
  it('accepts a zero-length source', () => {
    expect(() => assertRangesTile(tiled([v(0, 0), v(0, 3)]), 100, 103)).not.toThrow()
  })

  it('refuses a gap before the first source', () => {
    expect(tileError(tiled([v(1, 3)]), 100, 104)).toBe(
      "video #0's data starts at byte 1 of the media, where byte 0 was expected"
    )
  })

  it('refuses an overlap', () => {
    expect(tileError(tiled([v(0, 3), v(2, 3)]), 100, 106)).toBe(
      "video #1's data starts at byte 2 of the media, where byte 3 was expected"
    )
  })

  it('refuses sources out of order', () => {
    expect(tileError(tiled([v(3, 2), v(0, 3)]), 100, 105)).toBe(
      "video #0's data starts at byte 3 of the media, where byte 0 was expected"
    )
  })

  it('refuses a thumbnail out of place', () => {
    expect(tileError(tiled([v(0, 3, { offset: 4, length: 1 })]), 100, 105)).toBe(
      "video #0's thumbnail starts at byte 4 of the media, where byte 3 was expected"
    )
  })

  it('names the shortfall of a truncated file', () => {
    expect(tileError(tiled([v(0, 3 * MiB)]), 100, 100 + 2 * MiB)).toBe(
      'the file is incomplete: it declares 3 MiB of media and holds 2 MiB (2097152 of 3145728 bytes), so it was probably cut off while downloading'
    )
  })

  it('names a gigabyte shortfall in GiB', () => {
    expect(tileError(tiled([v(0, 1840 * MiB)]), 100, 100 + 1203 * MiB)).toMatch(
      /^the file is incomplete: it declares 1\.8 GiB of media and holds 1\.2 GiB /
    )
  })

  it('refuses bytes after the last source', () => {
    expect(tileError(tiled([v(0, 3)]), 100, 105)).toBe('the file has 2 bytes after its last source')
  })
})

describe('sliceRange', () => {
  it('cuts one part out of the payload, in the type it is given', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])

    const part = sliceRange(blob, 4, { offset: 2, length: 3 }, 'image/png')

    expect(part.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual([6, 7, 8])
  })
})
