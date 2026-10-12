// The .veditor v2 container (ESCSUITE-260), tested directly: no storage, no
// DOM beyond Blob. src/test/setup.ts makes Node's Blob the global one.
import { describe, it, expect } from 'vitest'
import {
  CONTAINER_VERSION,
  HEADER_BYTES,
  MAGIC,
  MAX_INDEX_BYTES,
  ProjectFileError,
  encodeProjectFile,
  formatSize,
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
