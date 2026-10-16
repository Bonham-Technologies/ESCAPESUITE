// Seeded mutation fuzz for the .veditor v2 container (ESCSUITE-294):
// `readProjectFileIndex`, `assertRangesTile` and `sliceRange`, then the whole
// v2 load path through `loadProject`. Every input starts as a real file from
// `encodeProjectFile` and is then truncated, bit-flipped, resized or has its
// ranges duplicated and swapped.
//
// The contract (ESCSUITE-260): a file that does not open with the eight magic
// bytes is not a v2 file, and `readProjectFileIndex` answers `null` (the v1
// hand-off) without throwing. Every v2 file is read or refused with a
// `ProjectFileError`, whose message is shown to the user; nothing else
// escapes. Ranges that tile slice to exactly their declared length. And a
// refused load leaves the shared DB as it found it.
//
// Since ESCSUITE-298 the v1 (JSON) path keeps the same contract: a mutated
// file that loses its magic goes down it and is loaded or refused with a
// `ProjectFileError`, and a third loop mutates a real v1 file.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it. See src/test/fuzz.ts.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import {
  HEADER_BYTES,
  MAGIC,
  ProjectFileError,
  assertRangesTile,
  encodeProjectFile,
  readProjectFileIndex,
  sliceRange,
  type ByteRange,
  type ProjectFileIndex,
} from './projectFileFormat'
import { loadProject } from './projectManager'
import { deleteVideo, getAllVideoMetadata } from './storage'
import type { EditorBlock, Project } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import {
  createRng,
  expectNamedRefusal,
  flipBit,
  fuzzFailure,
  mutateJson,
  resizeDeclared,
  swapRanges,
  truncateAt,
  expectTallyAtLeast,
  type FuzzContext,
  type Mutated,
  type Rng,
} from '../test/fuzz'

const READER_SEED = 0x5eed0260
const READER_ITERATIONS = 500
const LOAD_SEED = 0x5eed0261
const LOAD_ITERATIONS = 150
// Each loop's outcomes on its committed seed, measured 2026-10-15: the reader
// read and tiled 115 files and refused 332 (the other 53 were v1 hand-offs);
// loadProject loaded 39 and refused 100. The floors ARE those counts: the seed
// is fixed, so a reader that turns lenient anywhere (a range check skipped)
// drops `refused` below its floor, and one that turns strict drops `accepted`.
// A change that moves an input across the line on purpose updates the numbers
// here and says why, as a per-frame ceiling does.
//
// Re-measured 2026-10-16 for ESCSUITE-298: the load loop no longer skips the
// 11 of its 150 files whose magic a mutation destroyed. They go down the v1
// path, which refuses each by name as not JSON, so `refused` goes 100 -> 111
// and `accepted` stays 39. The v1 loop, new in that ticket, loaded 67 of its
// 300 files and refused 233.
const READER_FLOORS = { accepted: 115, refused: 332 }
const LOAD_FLOORS = { accepted: 39, refused: 111 }
const V1_SEED = 0x5eed0298
const V1_ITERATIONS = 300
const V1_FLOORS = { accepted: 67, refused: 233 }

/** Where the u32 index length sits in the header. */
const INDEX_LENGTH_OFFSET = 12

const project = (): Project => ({
  id: 'fuzz',
  name: 'Fuzz',
  created: 0,
  modified: 0,
  resolution: { width: 64, height: 48 },
  timeline: {
    tracks: [{ id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }],
    clips: [
      {
        id: 'c1',
        sourceVideoId: 'fz-a',
        name: 'A',
        startTime: 0,
        endTime: 2,
        duration: 2,
        trackId: 't1',
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0.5 },
      },
    ],
    textOverlays: [],
    shapeOverlays: [],
    duration: 2,
  },
})

const editor: EditorBlock = { inPoint: 0.5, outPoint: 1.5, markers: [{ id: 'm', time: 1, label: 'M', color: '#fff' }] }

const bytesOf = (values: number[]) => new Blob([new Uint8Array(values)])

/** The real file the writer produces: two sources, the first with a thumbnail. */
async function baseFile(): Promise<Uint8Array<ArrayBuffer>> {
  const meta = { duration: 2, width: 64, height: 48, frameRate: 30 }
  const parts = encodeProjectFile(project(), editor, [
    {
      id: 'fz-a',
      name: 'a.mp4',
      mimeType: 'video/mp4',
      meta,
      blob: new Blob([bytesOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], { type: 'video/mp4' }),
      thumbnail: new Blob([bytesOf([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }),
    },
    {
      id: 'fz-b',
      name: 'b.webm',
      mimeType: 'video/webm',
      meta,
      blob: new Blob([bytesOf([20, 21, 22, 23, 24, 25])], { type: 'video/webm' }),
    },
  ])
  return new Uint8Array(await new Blob(parts).arrayBuffer())
}

let base: Uint8Array<ArrayBuffer>
let baseIndex: ProjectFileIndex
let indexEnd: number

beforeAll(async () => {
  base = await baseFile()
  const view = new DataView(base.buffer, base.byteOffset, base.byteLength)
  indexEnd = HEADER_BYTES + view.getUint32(INDEX_LENGTH_OFFSET, true)
  baseIndex = JSON.parse(new TextDecoder().decode(base.subarray(HEADER_BYTES, indexEnd)))
})

/** A v2 file around `index` with a correct header and the base file's payload. */
function reassemble(index: unknown): Uint8Array<ArrayBuffer> {
  const indexBytes = new TextEncoder().encode(JSON.stringify(index))
  const payload = base.subarray(indexEnd)
  const out = new Uint8Array(HEADER_BYTES + indexBytes.length + payload.length)
  out.set(MAGIC)
  const view = new DataView(out.buffer)
  view.setUint32(8, 2, true)
  view.setUint32(INDEX_LENGTH_OFFSET, indexBytes.length, true)
  out.set(indexBytes, HEADER_BYTES)
  out.set(payload, HEADER_BYTES + indexBytes.length)
  return out
}

/** Every range the index names, as `[video, part]` pairs, for the range mutations. */
const rangeSlots = (index: ProjectFileIndex) =>
  index.videos.flatMap((video, i) => [
    [i, 'data'] as const,
    ...(video.thumbnail ? [[i, 'thumbnail'] as const] : []),
  ])

/** Grow or shrink one declared range, give one entry another's range, or swap two entries' ranges. */
function mutateRanges(rng: Rng): Mutated<Uint8Array<ArrayBuffer>> {
  const index = structuredClone(baseIndex) as unknown as {
    videos: Array<Record<'data' | 'thumbnail', ByteRange>>
  }
  const slots = rangeSlots(baseIndex)
  const [i, part] = rng.pick(slots)
  const [j, other] = rng.pick(slots)
  switch (rng.int(4)) {
    case 0: {
      const delta = rng.pick([1, -1, 2, -2, 1000, -1000, 2 ** 31])
      index.videos[i][part].length = Math.max(0, index.videos[i][part].length + delta)
      return { value: reassemble(index), description: `resize video #${i}'s ${part} length by ${delta}` }
    }
    case 1: {
      const delta = rng.pick([1, -1, 3, -3, 2 ** 31])
      index.videos[i][part].offset = Math.max(0, index.videos[i][part].offset + delta)
      return { value: reassemble(index), description: `move video #${i}'s ${part} offset by ${delta}` }
    }
    case 2:
      index.videos[i][part] = { ...index.videos[j][other] }
      return { value: reassemble(index), description: `duplicate video #${j}'s ${other} range onto video #${i}'s ${part}` }
    default: {
      const swap = { ...index.videos[i][part] }
      index.videos[i][part] = { ...index.videos[j][other] }
      index.videos[j][other] = swap
      return { value: reassemble(index), description: `swap video #${i}'s ${part} range with video #${j}'s ${other}` }
    }
  }
}

/** One random mutation of the base file. */
function mutateFile(rng: Rng): Mutated<Uint8Array<ArrayBuffer>> {
  const size = base.length
  switch (rng.int(9)) {
    case 0: {
      const at = rng.int(HEADER_BYTES)
      return { value: truncateAt(base, at), description: `truncateAt ${at} (in the header)` }
    }
    case 1: {
      const at = HEADER_BYTES + rng.int(size - HEADER_BYTES)
      return { value: truncateAt(base, at), description: `truncateAt ${at} of ${size} (index ends at ${indexEnd})` }
    }
    case 2: {
      const bit = rng.int(HEADER_BYTES * 8)
      return { value: flipBit(base, bit), description: `flipBit ${bit} (header byte ${bit >> 3})` }
    }
    case 3: {
      const bit = INDEX_LENGTH_OFFSET * 8 + rng.int(32)
      return { value: flipBit(base, bit), description: `flipBit ${bit} (the index length)` }
    }
    case 4: {
      const bit = HEADER_BYTES * 8 + rng.int((indexEnd - HEADER_BYTES) * 8)
      return { value: flipBit(base, bit), description: `flipBit ${bit} (index byte ${bit >> 3})` }
    }
    case 5: {
      const delta = rng.pick([1, -1, 16, -16, size, -size, 2 ** 31, -(2 ** 31), 64 * 1024 * 1024])
      return {
        value: resizeDeclared(base, INDEX_LENGTH_OFFSET, delta),
        description: `resizeDeclared the index length by ${delta}`,
      }
    }
    case 6:
      return mutateRanges(rng)
    case 7: {
      // The two sources' bytes exchanged: the index still tiles, the media is wrong.
      const a = baseIndex.videos[0].data
      const b = baseIndex.videos[1].data
      return {
        value: swapRanges(base, { offset: indexEnd + a.offset, length: a.length }, { offset: indexEnd + b.offset, length: b.length }),
        description: 'swapRanges of the two sources\' payload bytes',
      }
    }
    default: {
      // The index's own structure. `project` is held aside: parseProject has a
      // fuzz file of its own (store/projectMigration.fuzz.test.ts).
      const { project: held, ...rest } = baseIndex
      const { value, description } = mutateJson(rng, rest)
      const index = value && typeof value === 'object' && !Array.isArray(value) ? { ...value, project: held } : value
      return { value: reassemble(index), description: `index ${description}` }
    }
  }
}

const isProjectFileError = (error: unknown) => error instanceof ProjectFileError

const startsWithMagic = (bytes: Uint8Array) => bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b)

/** The reader's half of the contract for one file, and which way it went. */
async function checkReader(
  bytes: Uint8Array<ArrayBuffer>,
  context: FuzzContext
): Promise<'v1' | 'refused' | 'read'> {
  const blob = new Blob([bytes])
  const read = await expectNamedRefusal(() => readProjectFileIndex(blob), isProjectFileError, context)
  if (!startsWithMagic(bytes)) {
    if (!read.ok || read.value !== null) {
      throw fuzzFailure(context, 'a file without the magic was not handed to the v1 path (null)')
    }
    return 'v1'
  }
  if (!read.ok) return 'refused'
  if (read.value === null) throw fuzzFailure(context, 'a file with the magic was handed to the v1 path')
  const { index, payloadStart } = read.value
  const tiled = await expectNamedRefusal(() => assertRangesTile(index, payloadStart, blob.size), isProjectFileError, context)
  if (!tiled.ok) return 'refused'
  for (const video of index.videos) {
    for (const range of video.thumbnail ? [video.data, video.thumbnail] : [video.data]) {
      const slice = sliceRange(blob, payloadStart, range, 'application/octet-stream')
      if (slice.size !== range.length) {
        throw fuzzFailure(context, `a tiled range of ${range.length} bytes sliced to ${slice.size}`)
      }
    }
  }
  return 'read'
}

describe('the v2 reader under seeded mutation (ESCSUITE-294)', () => {
  it('reads the unmutated file, so every mutation starts from a real one', async () => {
    const read = await readProjectFileIndex(new Blob([base]))
    expect(read?.index.videos.map((video) => video.id)).toEqual(['fz-a', 'fz-b'])
    expect(() => assertRangesTile(read!.index, read!.payloadStart, base.length)).not.toThrow()
  })

  it('hands every truncation inside the magic to v1, and refuses every one after it by name', async () => {
    for (let at = 0; at <= HEADER_BYTES; at++) {
      await checkReader(truncateAt(base, at), { seed: READER_SEED, iteration: -1, mutation: `truncateAt ${at}` })
    }
  })

  it(`reads or refuses ${READER_ITERATIONS} mutated files with a ProjectFileError, and nothing else`, async () => {
    const rng = createRng(READER_SEED)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < READER_ITERATIONS; iteration++) {
      const { value, description } = mutateFile(rng)
      const outcome = await checkReader(value, { seed: READER_SEED, iteration, mutation: description })
      if (outcome === 'read') tally.accepted++
      if (outcome === 'refused') tally.refused++
    }
    expectTallyAtLeast(tally, READER_FLOORS, READER_SEED)
  })
})

describe('loadProject, version 2, under seeded mutation (ESCSUITE-294)', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles({ video: { duration: 2, videoWidth: 64, videoHeight: 48 } })
  })

  afterEach(async () => {
    media.uninstall()
    for (const { id } of await getAllVideoMetadata()) await deleteVideo(id)
    vi.restoreAllMocks()
  })

  const fileOf = (bytes: Uint8Array<ArrayBuffer>) =>
    new NodeFile([bytes], 'fuzz.veditor') as unknown as File

  it('loads the unmutated file', async () => {
    const loaded = await loadProject(fileOf(base))
    expect(loaded.sourceVideos.map((video) => video.id)).toEqual(['fz-a', 'fz-b'])
  })

  it(`loads or refuses ${LOAD_ITERATIONS} mutated files with a ProjectFileError, writing nothing on a refusal`, async () => {
    const rng = createRng(LOAD_SEED)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < LOAD_ITERATIONS; iteration++) {
      const { value, description } = mutateFile(rng)
      // A file whose magic is gone goes down the v1 path, which since
      // ESCSUITE-298 refuses it by name too (as not JSON): no skip.
      tally[await checkLoad(fileOf(value), { seed: LOAD_SEED, iteration, mutation: description })]++
    }
    expectTallyAtLeast(tally, LOAD_FLOORS, LOAD_SEED)
  })
})

/** One load's half of the contract: loaded, or refused by name with nothing left in the shared DB. */
async function checkLoad(file: File, context: FuzzContext): Promise<'accepted' | 'refused'> {
  const loaded = await expectNamedRefusal(() => loadProject(file), isProjectFileError, context)
  const stored = (await getAllVideoMetadata()).map(({ id }) => id)
  if (!loaded.ok && stored.length > 0) {
    throw fuzzFailure(context, `a refused load left ${stored.join(', ')} in the shared DB`)
  }
  for (const id of stored) await deleteVideo(id)
  return loaded.ok ? 'accepted' : 'refused'
}

/** A real v1 file's content, as an older ESCAPEARTIST wrote it: two base64 sources, the first with a thumbnail. */
const baseV1 = () => {
  const meta = { duration: 2, width: 64, height: 48, frameRate: 30 }
  return {
    version: 1,
    project: project(),
    editor,
    videos: [
      { id: 'fz-a', name: 'a.mp4', mimeType: 'video/mp4', data: btoa('\x01\x02\x03\x04\x05'), thumbnail: btoa('\xff\xd8\xff'), meta },
      { id: 'fz-b', name: 'b.webm', mimeType: 'video/webm', data: btoa('\x14\x15\x16'), meta },
    ],
  }
}

const v1File = (text: string) => new NodeFile([text], 'old.veditor') as unknown as File

/** One random mutation of the base v1 file: its text cut short or bit-flipped, or its JSON structure. */
function mutateV1(rng: Rng): Mutated<string> {
  const text = JSON.stringify(baseV1())
  switch (rng.int(4)) {
    case 0: {
      const at = rng.int(text.length)
      return { value: text.slice(0, at), description: `truncate the text at ${at} of ${text.length}` }
    }
    case 1: {
      const bytes = new TextEncoder().encode(text)
      const bit = rng.int(bytes.length * 8)
      return { value: new TextDecoder().decode(flipBit(bytes, bit)), description: `flipBit ${bit} of the text` }
    }
    default: {
      // `project` is held aside, as the v2 loop holds it: parseProject has a
      // fuzz file of its own (store/projectMigration.fuzz.test.ts).
      const { project: held, ...rest } = baseV1()
      const { value, description } = mutateJson(rng, rest)
      const content = value && typeof value === 'object' && !Array.isArray(value) ? { ...value, project: held } : value
      // JSON.stringify(undefined) is undefined: the file is then empty.
      return { value: JSON.stringify(content) ?? '', description }
    }
  }
}

describe('loadProject, version 1, under seeded mutation (ESCSUITE-298)', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles({ video: { duration: 2, videoWidth: 64, videoHeight: 48 } })
  })

  afterEach(async () => {
    media.uninstall()
    for (const { id } of await getAllVideoMetadata()) await deleteVideo(id)
    vi.restoreAllMocks()
  })

  it('loads the unmutated v1 file', async () => {
    const loaded = await loadProject(v1File(JSON.stringify(baseV1())))
    expect(loaded.sourceVideos.map((video) => video.id)).toEqual(['fz-a', 'fz-b'])
  })

  it.each([
    ['a file cut short', () => JSON.stringify(baseV1()).slice(0, 60), 'the file is not valid JSON'],
    ['videos: null', () => JSON.stringify({ ...baseV1(), videos: null }), 'videos must be a list'],
    [
      'a source whose data is a number',
      () => JSON.stringify({ ...baseV1(), videos: [{ ...baseV1().videos[1], data: 42 }] }),
      'videos[0].data must be a string',
    ],
  ])('refuses %s with a ProjectFileError, writing nothing', async (_label, text, reason) => {
    const error = await loadProject(v1File(text())).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toBe(reason)
    expect(await getAllVideoMetadata()).toEqual([])
  })

  it(`loads or refuses ${V1_ITERATIONS} mutated v1 files with a ProjectFileError, writing nothing on a refusal`, async () => {
    const rng = createRng(V1_SEED)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < V1_ITERATIONS; iteration++) {
      const { value, description } = mutateV1(rng)
      tally[await checkLoad(v1File(value), { seed: V1_SEED, iteration, mutation: description })]++
    }
    expectTallyAtLeast(tally, V1_FLOORS, V1_SEED)
  }, 15_000)
})
