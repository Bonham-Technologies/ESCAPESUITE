// Seeded mutation fuzz for the kit's input loaders (ESCSUITE-294):
// `loadManifest`, and `loadBundle` for both `.veditor` versions -- the v1 JSON
// document and the v2 container (test/veditorV2.ts builds it the way
// ESCAPEARTIST's writer does).
//
// The contract: every input either loads, or is refused with the kit's own
// validation error -- a plain `Error` whose message names the bundle or
// manifest path or the field, which the job runner reports and the CLI exits
// on -- never a bare TypeError, RangeError or SyntaxError, and never an
// unhandled rejection. What loads has a string id, name and MIME type for
// every source and a file for each. A refused bundle leaves no temp directory
// behind.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it. See test/fuzz.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundle, loadManifest, type LoadedJob } from './loaders'
import { assembleV2, v2IndexAndPayload } from '../test/veditorV2'
import {
  createRng,
  expectNamedRefusal,
  flipBit,
  fuzzFailure,
  mutateJson,
  resizeDeclared,
  swapRanges,
  truncateAt,
  type FuzzContext,
  type Mutated,
  type Rng,
} from '../test/fuzz'

const MANIFEST_SEED = 0x5eed0158
const V1_SEED = 0x5eed0150
const V2_SEED = 0x5eed0260
const ITERATIONS = 400

const HEADER_BYTES = 16
const INDEX_LENGTH_OFFSET = 12

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureDir = path.join(here, '..', 'test', 'fixtures', 'manifest')

let workDir: string
let project: Record<string, unknown>

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-fuzz-'))
  await fs.copyFile(path.join(fixtureDir, 'src-0.mp4'), path.join(workDir, 'src-0.mp4'))
  project = JSON.parse(await fs.readFile(path.join(fixtureDir, 'project.json'), 'utf8')).project
})

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
})

/**
 * The kit's validation error: exactly `Error`, not a subclass, so a TypeError
 * from a property read cannot pass for one.
 */
const isValidationError = (error: unknown) =>
  error instanceof Error && Object.getPrototypeOf(error) === Error.prototype

/** Every refusal names the file, a source, a clip or the field. */
const NAMES_WHAT = /bundle|manifest|source|clip|project|file|meta|MIME/

/** What loaded is a job the render driver can take; what was refused said what. */
async function checkLoaded(
  outcome: { ok: true; value: LoadedJob } | { ok: false; error: Error },
  context: FuzzContext,
): Promise<void> {
  if (!outcome.ok) {
    if (!NAMES_WHAT.test(outcome.error.message)) {
      throw fuzzFailure(context, `refused without naming what: ${outcome.error.message}`)
    }
    return
  }
  const job = outcome.value
  try {
    if (!Array.isArray(job.project?.timeline?.clips)) {
      throw fuzzFailure(context, 'loaded a project with no clips list')
    }
    for (const source of job.sourceVideos) {
      for (const field of ['id', 'name', 'mimeType'] as const) {
        if (typeof source[field] !== 'string') {
          throw fuzzFailure(context, `loaded a source whose ${field} is ${JSON.stringify(source[field])}`)
        }
      }
      if (typeof job.sourceFiles[source.id] !== 'string') {
        throw fuzzFailure(context, `loaded source "${source.id}" with no file`)
      }
    }
  } finally {
    await job.cleanup()
  }
}

/** A refused bundle must have removed its temp directory; a loaded one was cleaned by its job. */
async function expectTmpRootEmpty(tmpRoot: string, context: FuzzContext): Promise<void> {
  const left = await fs.readdir(tmpRoot)
  if (left.length > 0) throw fuzzFailure(context, `left ${left.join(', ')} in the temp root`)
}

/** JSON.stringify answers `undefined` for a root swapped to `undefined`: write an empty file instead. */
const asJson = (value: unknown) => JSON.stringify(value) ?? ''

describe('loadManifest under seeded mutation (ESCSUITE-294)', () => {
  const baseManifest = () => ({
    project,
    sources: [
      {
        id: 'src-0',
        file: 'src-0.mp4',
        mimeType: 'video/mp4',
        name: 'clip.mp4',
        width: 64,
        height: 48,
        duration: 1,
        meta: { mediaType: 'video', width: 64, height: 48, duration: 1 },
      },
    ],
  })

  it('loads the unmutated manifest', async () => {
    const manifestPath = path.join(workDir, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(baseManifest()))
    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos.map((source) => source.id)).toEqual(['src-0'])
  })

  it(`loads or refuses ${ITERATIONS} mutated manifests with a named validation error`, async () => {
    const rng = createRng(MANIFEST_SEED)
    const manifestPath = path.join(workDir, 'manifest.json')
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { value, description } = mutateJson(rng, baseManifest())
      const context = { seed: MANIFEST_SEED, iteration, mutation: description }
      await fs.writeFile(manifestPath, asJson(value))
      await checkLoaded(await expectNamedRefusal(() => loadManifest(manifestPath), isValidationError, context), context)
    }
  })
})

describe('loadBundle, version 1, under seeded mutation (ESCSUITE-294)', () => {
  const baseBundle = async () => ({
    version: 1,
    project,
    videos: [
      {
        id: 'src-0',
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        data: (await fs.readFile(path.join(workDir, 'src-0.mp4'))).toString('base64'),
        meta: { mediaType: 'video', width: 64, height: 48, duration: 1 },
      },
    ],
  })

  it(`loads or refuses ${ITERATIONS} mutated v1 bundles with a named validation error, leaving no temp files`, async () => {
    const base = await baseBundle()
    const bundlePath = path.join(workDir, 'v1.veditor')
    const tmpRoot = await fs.mkdtemp(path.join(workDir, 'tmp-'))
    await fs.writeFile(bundlePath, JSON.stringify(base))
    await (await loadBundle(bundlePath, tmpRoot)).cleanup()

    const rng = createRng(V1_SEED)
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { value, description } = mutateJson(rng, base)
      const context = { seed: V1_SEED, iteration, mutation: description }
      await fs.writeFile(bundlePath, asJson(value))
      await checkLoaded(await expectNamedRefusal(() => loadBundle(bundlePath, tmpRoot), isValidationError, context), context)
      await expectTmpRootEmpty(tmpRoot, context)
    }
  })
})

describe('loadBundle, version 2, under seeded mutation (ESCSUITE-294)', () => {
  let base: Buffer
  let index: Record<string, unknown>
  let payload: Buffer

  beforeAll(async () => {
    const meta = { mediaType: 'video', width: 64, height: 48, duration: 1 }
    ;({ index, payload } = v2IndexAndPayload(project, [
      {
        id: 'src-0',
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        bytes: await fs.readFile(path.join(workDir, 'src-0.mp4')),
        meta,
        thumbnail: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mimeType: 'image/jpeg' },
      },
      { id: 'src-1', name: 'b.webm', mimeType: 'video/webm', bytes: Buffer.from([1, 2, 3, 4, 5, 6]), meta },
    ]))
    base = assembleV2(index, payload)
  })

  type Range = { offset: number; length: number }
  type Entry = { data: Range; thumbnail?: Range }

  /** Grow or shrink a declared range, give one entry another's range, or swap two entries' ranges. */
  function mutateRanges(rng: Rng): Mutated<Uint8Array> {
    const next = structuredClone(index) as { videos: Entry[] }
    const slots = next.videos.flatMap((video, i) => [
      [i, 'data'] as const,
      ...(video.thumbnail ? [[i, 'thumbnail'] as const] : []),
    ])
    const [i, part] = rng.pick(slots)
    const [j, other] = rng.pick(slots)
    const at = (k: number, p: 'data' | 'thumbnail') => next.videos[k][p] as Range
    switch (rng.int(3)) {
      case 0: {
        const delta = rng.pick([1, -1, 2, -2, 1000, -1000, 2 ** 31])
        at(i, part).length = Math.max(0, at(i, part).length + delta)
        return { value: assembleV2(next, payload), description: `resize video #${i}'s ${part} length by ${delta}` }
      }
      case 1:
        next.videos[i][part] = { ...at(j, other) }
        return { value: assembleV2(next, payload), description: `duplicate video #${j}'s ${other} range onto video #${i}'s ${part}` }
      default: {
        const swap = { ...at(i, part) }
        next.videos[i][part] = { ...at(j, other) }
        next.videos[j][other] = swap
        return { value: assembleV2(next, payload), description: `swap video #${i}'s ${part} range with video #${j}'s ${other}` }
      }
    }
  }

  /** The same mutations ESCAPEARTIST's reader is fuzzed with (apps/artist/src/core/projectFileFormat.fuzz.test.ts). */
  function mutateFile(rng: Rng): Mutated<Uint8Array> {
    const size = base.length
    const indexEnd = HEADER_BYTES + base.readUInt32LE(INDEX_LENGTH_OFFSET)
    switch (rng.int(9)) {
      case 0: {
        const at = rng.int(HEADER_BYTES + 1)
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
        const [a, b] = (index.videos as Entry[]).map((video) => video.data)
        return {
          value: swapRanges(base, { offset: indexEnd + a.offset, length: a.length }, { offset: indexEnd + b.offset, length: b.length }),
          description: "swapRanges of the two sources' payload bytes",
        }
      }
      default: {
        const { value, description } = mutateJson(rng, index)
        return { value: assembleV2(asJson(value), payload), description: `index ${description}` }
      }
    }
  }

  it(`loads or refuses ${ITERATIONS} mutated v2 bundles with a named validation error, leaving no temp files`, async () => {
    const bundlePath = path.join(workDir, 'v2.veditor')
    const tmpRoot = await fs.mkdtemp(path.join(workDir, 'tmp-'))
    await fs.writeFile(bundlePath, base)
    await (await loadBundle(bundlePath, tmpRoot)).cleanup()

    const rng = createRng(V2_SEED)
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { value, description } = mutateFile(rng)
      const context = { seed: V2_SEED, iteration, mutation: description }
      await fs.writeFile(bundlePath, value)
      await checkLoaded(await expectNamedRefusal(() => loadBundle(bundlePath, tmpRoot), isValidationError, context), context)
      await expectTmpRootEmpty(tmpRoot, context)
    }
  })
})

// The defects this fuzzer found, each one input pinned on its own so it reads
// without the loop. Fixed in the same ticket (ESCSUITE-294) and kept as
// regression tests. Each asserts exactly the fuzz contract above.
describe('defects the loader fuzz found (ESCSUITE-294)', () => {
  it('a manifest source whose "name" is not a string is refused, not loaded with that name (seed 0x5eed0158, iteration 117)', async () => {
    const context = { seed: MANIFEST_SEED, iteration: 117, mutation: 'swapType sources[0].name -> []' }
    const manifestPath = path.join(workDir, 'manifest-name.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ project, sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4', name: [] }] }),
    )
    await checkLoaded(await expectNamedRefusal(() => loadManifest(manifestPath), isValidationError, context), context)
  })

  it('a version 1 bundle whose clip is null is refused by name, not with a TypeError (seed 0x5eed0150, iteration 366)', async () => {
    const context = { seed: V1_SEED, iteration: 366, mutation: 'swapType project.timeline.clips[0] -> null' }
    const bundlePath = path.join(workDir, 'v1-null-clip.veditor')
    const tmpRoot = await fs.mkdtemp(path.join(workDir, 'tmp-'))
    const nullClip = { ...project, timeline: { ...(project.timeline as object), clips: [null] } }
    await fs.writeFile(bundlePath, JSON.stringify({ version: 1, project: nullClip, videos: [] }))
    await checkLoaded(await expectNamedRefusal(() => loadBundle(bundlePath, tmpRoot), isValidationError, context), context)
  })

  it('a manifest whose clip is null is refused by name, not with a TypeError (seed 0x5eed0158, iteration 188)', async () => {
    const context = { seed: MANIFEST_SEED, iteration: 188, mutation: 'injectNumber project.timeline.clips[0] -> NaN (null in JSON)' }
    const manifestPath = path.join(workDir, 'manifest-null-clip.json')
    const nullClip = { ...project, timeline: { ...(project.timeline as object), clips: [null] } }
    await fs.writeFile(manifestPath, JSON.stringify({ project: nullClip, sources: [] }))
    await checkLoaded(await expectNamedRefusal(() => loadManifest(manifestPath), isValidationError, context), context)
  })
})
