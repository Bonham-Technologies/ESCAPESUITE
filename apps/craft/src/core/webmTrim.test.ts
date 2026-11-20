// `trimToWholeBlocks` (ESCSUITE-466) over hand-built containers: every shape a
// take kept on disk can be cut into. The same pass over real Mediabunny and
// MediaRecorder-shaped output, followed by the real repair, is in
// `takeRepair.test.ts`.
import { describe, expect, it } from 'vitest'
import { trimToWholeBlocks } from './webmTrim'
import { el, type Bytes } from '../test/webmFixture'

const EBML = [0x1a, 0x45, 0xdf, 0xa3]
const SEGMENT = [0x18, 0x53, 0x80, 0x67]
const INFO = [0x15, 0x49, 0xa9, 0x66]
const TIMECODE_SCALE = [0x2a, 0xd7, 0xb1]
const TRACKS = [0x16, 0x54, 0xae, 0x6b]
const CUES = [0x1c, 0x53, 0xbb, 0x6b]
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75]
const TIMECODE = [0xe7]
const SIMPLE_BLOCK = [0xa3]
const BLOCK_GROUP = [0xa0]
const BLOCK = [0xa1]
const REFERENCE_BLOCK = [0xfb]
const VOID = [0xec]

const UNKNOWN_SEGMENT = [...SEGMENT, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

const ebml = el(EBML, el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d]))
const info = (scale = 1_000_000) => el(INFO, el(TIMECODE_SCALE, [(scale >> 16) & 0xff, (scale >> 8) & 0xff, scale & 0xff]))
const tracks = el(TRACKS, el([0xae], el([0xd7], [1])))
const body = (rel: number, track = 0x81) => [track, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0, 0, 0, 0]
const simple = (rel: number) => el(SIMPLE_BLOCK, body(rel))
const group = (rel: number) => el(BLOCK_GROUP, [...el(BLOCK, body(rel)), ...el(REFERENCE_BLOCK, [0xff, 0xdf])])
const cluster = (timecode: number, children: Bytes[], unknown = false) =>
  el(CLUSTER, [...el(TIMECODE, [(timecode >> 8) & 0xff, timecode & 0xff]), ...children.flat()], unknown)

/** A file whose Segment says `knownSize` (Mediabunny before finalize) or unknown. */
function webm(children: Bytes[], segment: 'unknown' | 'known' = 'unknown'): Uint8Array<ArrayBuffer> {
  const payload = children.flat()
  const header = segment === 'unknown' ? UNKNOWN_SEGMENT : [...SEGMENT, 0x81]
  return new Uint8Array([...ebml, ...header, ...payload])
}

const blob = (bytes: Uint8Array<ArrayBuffer>, type = 'video/webm') => new Blob([bytes], { type })
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

/** What a trimmed file should be: the header, an unknown Segment, then `payload`. */
const expected = (payload: Bytes) => [...ebml, ...UNKNOWN_SEGMENT, ...payload]

describe('trimToWholeBlocks', () => {
  it('passes a whole live stream through, and reports its blocks and length', async () => {
    const children = [info(), tracks, cluster(0, [simple(0), group(33)], true), cluster(1000, [simple(500)], true)]
    const trimmed = await trimToWholeBlocks(blob(webm(children)))
    expect(trimmed!.blocks).toBe(3)
    expect(trimmed!.lastBlockSeconds).toBe(1.5)
    expect(trimmed!.blob.type).toBe('video/webm')
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(children.flat()))
  })

  it('rewrites a known-size Segment to unknown, as the repair expects', async () => {
    const children = [info(), cluster(0, [simple(0)])]
    const trimmed = await trimToWholeBlocks(blob(webm(children, 'known')))
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(children.flat()))
  })

  it('reads the TimecodeScale from Info', async () => {
    const trimmed = await trimToWholeBlocks(blob(webm([info(500_000), cluster(0, [simple(2000)])])))
    expect(trimmed!.lastBlockSeconds).toBe(1)
  })

  it('keeps reading Info past a field it cannot read', async () => {
    const torn = el(INFO, [0x00, 0x00])
    const trimmed = await trimToWholeBlocks(blob(webm([torn, cluster(0, [simple(1000)])])))
    expect(trimmed!.lastBlockSeconds).toBe(1)
  })

  it('cuts an unknown-size Cluster at its last whole block', async () => {
    const whole = [info(), cluster(0, [simple(0), simple(20)], true)]
    const bytes = webm([...whole, simple(40).slice(0, 5)])
    const trimmed = await trimToWholeBlocks(blob(bytes))
    expect(trimmed!.blocks).toBe(2)
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(whole.flat()))
  })

  it('cuts a known-size Cluster and marks its size unknown at the same width', async () => {
    const first = cluster(0, [simple(0)])
    const timecode = el(TIMECODE, [0x03, 0xe8])
    const kept = [...timecode, ...simple(0)]
    const cut = el(CLUSTER, [...kept, ...simple(20)])
    // One byte of size: the cut Cluster's size becomes 0xff.
    const bytes = webm([info(), first, cut.slice(0, cut.length - 3)])
    const trimmed = await trimToWholeBlocks(blob(bytes))
    expect(trimmed!.blocks).toBe(2)
    expect(trimmed!.lastBlockSeconds).toBe(1)
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected([...info(), ...first, ...CLUSTER, 0xff, ...kept]))
  })

  it('cuts a Cluster whose size is eight bytes wide', async () => {
    const children = Array.from({ length: 20 }, (_, i) => simple(i * 10))
    const big = cluster(0, children)
    expect(big[4]).toBe(0x01)
    const bytes = webm([big.slice(0, big.length - 2)])
    const trimmed = await trimToWholeBlocks(blob(bytes))
    expect(trimmed!.blocks).toBe(19)
    const out = await bytesOf(trimmed!.blob)
    const at = ebml.length + UNKNOWN_SEGMENT.length
    expect([...out.subarray(at, at + 12)]).toEqual([...CLUSTER, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  })

  it('drops a Cluster cut before its first whole block', async () => {
    const first = cluster(0, [simple(0)])
    const second = cluster(1000, [simple(0)])
    const trimmed = await trimToWholeBlocks(blob(webm([first, second.slice(0, 8)])))
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(first))
  })

  it('stops a known-size Cluster at a malformed child', async () => {
    const kept = [...el(TIMECODE, [0, 0]), ...simple(0)]
    const bad = el(CLUSTER, [...kept, 0x00, 0x00, 0x00])
    const trimmed = await trimToWholeBlocks(blob(webm([bad])))
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected([...CLUSTER, 0xff, ...kept]))
    // A size field wider than eight bytes is malformed too.
    const wide = el(CLUSTER, [...kept, 0xa3, 0x00, 0x00])
    expect((await trimToWholeBlocks(blob(webm([wide]))))!.blocks).toBe(1)
  })

  it('stops a known-size Cluster at a child that runs past it', async () => {
    const kept = [...el(TIMECODE, [0, 0]), ...simple(0)]
    const payload = [...kept, ...SIMPLE_BLOCK, 0x88, 0x81, 0, 0, 0x80]
    const runs = [...CLUSTER, 0x80 | (payload.length - 1), ...payload.slice(0, -1)]
    const trimmed = await trimToWholeBlocks(blob(webm([runs, cluster(1000, [simple(0)])])))
    expect(trimmed!.blocks).toBe(1)
  })

  it('stops a known-size Cluster at a level-1 element inside it', async () => {
    const kept = [...el(TIMECODE, [0, 0]), ...simple(0)]
    const odd = el(CLUSTER, [...kept, ...el(CUES, [])])
    const trimmed = await trimToWholeBlocks(blob(webm([odd])))
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected([...CLUSTER, 0xff, ...kept]))
  })

  it('ends an unknown-size Cluster at the next Cluster, and drops what follows the media', async () => {
    const media = [cluster(0, [simple(0)], true), cluster(1000, [group(0)], true)]
    const finalized = [info(), ...media, el(CUES, [0xbb, 0x80])]
    const trimmed = await trimToWholeBlocks(blob(webm(finalized)))
    expect(trimmed!.blocks).toBe(2)
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected([...info(), ...media.flat()]))
  })

  it('drops what follows a known-size Cluster too', async () => {
    const media = cluster(0, [simple(0), el(VOID, [0, 0])])
    const trimmed = await trimToWholeBlocks(blob(webm([media, el(CUES, [])])))
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(media))
  })

  it('counts every Block in a BlockGroup, past a part it cannot read', async () => {
    const odd = el(BLOCK_GROUP, [...el(BLOCK, body(10)), 0x00])
    const trimmed = await trimToWholeBlocks(blob(webm([cluster(0, [group(0), odd])])))
    expect(trimmed!.blocks).toBe(2)
    expect(trimmed!.lastBlockSeconds).toBe(0.01)
  })

  it('reads a block on a two-byte track number', async () => {
    const block = el(SIMPLE_BLOCK, [0x40, 0x80, 0x00, 0x64, 0x80, 0, 0, 0, 0])
    const trimmed = await trimToWholeBlocks(blob(webm([cluster(0, [block])])))
    expect(trimmed!.lastBlockSeconds).toBe(0.1)
  })

  it('reads a negative block timecode as negative', async () => {
    const trimmed = await trimToWholeBlocks(blob(webm([cluster(1000, [simple(-200)])])))
    expect(trimmed!.lastBlockSeconds).toBe(0.8)
  })

  it('reads through a window much smaller than the file', async () => {
    const children = [info(), tracks, cluster(0, [simple(0), group(33)], true), cluster(1000, [simple(5)], true)]
    const trimmed = await trimToWholeBlocks(blob(webm(children)), 3)
    expect(trimmed!.blocks).toBe(3)
    expect([...(await bytesOf(trimmed!.blob))]).toEqual(expected(children.flat()))
  })

  it('types an untyped file as WebM', async () => {
    const trimmed = await trimToWholeBlocks(blob(webm([cluster(0, [simple(0)])]), ''))
    expect(trimmed!.blob.type).toBe('video/webm')
  })

  it('has nothing to keep without a whole block', async () => {
    // Empty, not EBML, a torn EBML header, no Segment, a header torn before
    // the media, no Cluster at all, a Cluster with no block.
    const cases: Uint8Array<ArrayBuffer>[] = [
      new Uint8Array(0),
      new Uint8Array([0x00, 0x01, 0x02]),
      new Uint8Array([0x1a]),
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x88, 0x42]),
      new Uint8Array([...ebml]),
      new Uint8Array([...ebml, ...el(VOID, [0])]),
      webm([info(), tracks.slice(0, tracks.length - 1)]),
      webm([info(), tracks]),
      webm([cluster(0, [el(VOID, [0])])]),
    ]
    for (const bytes of cases) expect(await trimToWholeBlocks(blob(bytes))).toBeNull()
  })
})
