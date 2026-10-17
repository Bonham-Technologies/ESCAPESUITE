import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { fixWebMMetadata } from './converter'
import {
  buildWebM,
  readCues,
  bytesOf,
  PIP_SPEC,
  PIP_KEYFRAMES,
  SIMPLE_SPEC,
  SIMPLE_KEYFRAMES,
  AUDIO_SPEC,
  type Fixture,
} from '../test/webmFixture'

/**
 * The whole repair a stored MediaRecorder WebM goes through — the REAL
 * `webm-duration-fix`, then the keyframe Cues step — over hand-built takes
 * (ESCSUITE-322). No `vi.mock` here, like `converterInterop.test.ts`.
 *
 * The library alone writes a CuePoint only at the first video SimpleBlock of a
 * cluster, so the composited-PiP take, whose video is all BlockGroups, came out
 * of it with an empty Cues element: what Firefox could not seek (ESCSUITE-305).
 */

/**
 * jsdom is not enough for the real library, in two ways a browser does not
 * share. jsdom's Blob has no `stream()`, which the library reads the container
 * through. And the library hands back its rewritten head as the `.buffer` of a
 * `Buffer.concat` result: the browser's `buffer` polyfill allocates a fresh
 * ArrayBuffer for every Buffer, but Node's own carves small ones out of an
 * 8 KiB pool, so under Node `.buffer` is the whole pool and the "repaired" head
 * is whatever else lives in it. So this file runs on Node's Blob, which streams
 * the way a browser's does, with the pool switched off for its duration; both
 * are put back afterwards, by value rather than `vi.unstubAllGlobals()`, which
 * would also drop the stubs `src/test/setup.ts` installs.
 */
const jsdomBlob = globalThis.Blob
const poolSize = Buffer.poolSize
beforeAll(() => {
  globalThis.Blob = NodeBlob as unknown as typeof Blob
  Buffer.poolSize = 0
})
afterAll(() => {
  globalThis.Blob = jsdomBlob
  Buffer.poolSize = poolSize
})

function webm(fixture: Fixture): Blob {
  return new Blob([fixture.bytes], { type: 'video/webm' })
}

describe('fixWebMMetadata over real containers', () => {
  it('stores a BlockGroup (composited PiP) take with a Cues element indexing every keyframe', async () => {
    const fixture = buildWebM(PIP_SPEC)

    const out = await bytesOf(await fixWebMMetadata(webm(fixture)))

    const read = readCues(out)
    expect(read.hasDuration).toBe(true)
    expect(read.points.map((p) => p.time)).toEqual(PIP_KEYFRAMES.map(([, , t]) => t))
  })

  it('stores a SimpleBlock take with keyframe cues, not the per-cluster ones the library writes', async () => {
    const fixture = buildWebM({ ...SIMPLE_SPEC, cues: 'empty' })

    const out = await bytesOf(await fixWebMMetadata(webm(fixture)))

    expect(readCues(out).points.map((p) => p.time)).toEqual(SIMPLE_KEYFRAMES.map(([, , t]) => t))
  })

  it('positions every cue on its cluster in the file the library wrote', async () => {
    // The library rewrites the head (Duration, SeekHead), so the clusters move
    // by its change as well as ours: every cue must still land on a Cluster.
    const fixture = buildWebM(PIP_SPEC)
    const repaired = await bytesOf(await fixWebMMetadata(webm(fixture)))
    const read = readCues(repaired)
    expect(read.points).toHaveLength(PIP_KEYFRAMES.length)
    for (const point of read.points) {
      const at = read.segmentDataStart + point.clusterPosition
      expect(repaired.slice(at, at + 4)).toEqual(new Uint8Array([0x1f, 0x43, 0xb6, 0x75]))
    }
  })

  it('stores an audio-only take repaired, with no video cues, and does not refuse it', async () => {
    const fixture = buildWebM({ ...AUDIO_SPEC, cues: 'empty' })

    const out = await bytesOf(await fixWebMMetadata(webm(fixture)))

    const read = readCues(out)
    expect(read.hasDuration).toBe(true)
    // Track 1 is the Opus track here; whatever the library indexes is audio.
    expect(read.points.every((p) => p.track === 1)).toBe(true)
  })
})

