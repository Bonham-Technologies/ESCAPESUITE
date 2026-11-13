// ESCSUITE-439: dropDeltaFrameCues on files built byte by byte, for the shapes
// the muxer-made fixtures in webmDeltaFrameCues.test.ts never produce: other
// elements between the ones it looks for, blocks in an unusual order, and
// files damaged or cut short. Its rule holds throughout: a cue is dropped only
// when the block it names is read and proven to be a delta frame; anything it
// cannot read leaves the file as it is (null).
import { describe, expect, it } from 'vitest'
import { dropDeltaFrameCues } from './webmDeltaFrameCues'

type Bytes = number[]

/** An EBML size field for `n`, in the fewest bytes (never the all-ones "unknown"). */
function size(n: number): Bytes {
  if (n < 0x7f) return [0x80 | n]
  if (n < 0x3fff) return [0x40 | (n >> 8), n & 0xff]
  return [0x10, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

const el = (id: Bytes, ...content: Bytes[]): Bytes => {
  const data = content.flat()
  return [...id, ...size(data.length), ...data]
}
/** An element whose size field claims `claimed` bytes, whatever follows. */
const lying = (id: Bytes, claimed: number, ...content: Bytes[]): Bytes => [...id, ...size(claimed), ...content.flat()]
const uint = (id: Bytes, value: number, length = 1): Bytes => {
  const out: Bytes = []
  for (let i = length - 1; i >= 0; i--) out.push(Math.floor(value / 256 ** i) & 0xff)
  return el(id, out)
}

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  docType: [0x42, 0x82],
  segment: [0x18, 0x53, 0x80, 0x67],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackType: [0x83],
  cues: [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint: [0xbb],
  cueTime: [0xb3],
  cueTrackPositions: [0xb7],
  cueTrack: [0xf7],
  cueClusterPosition: [0xf1],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  clusterTimestamp: [0xe7],
  simpleBlock: [0xa3],
  blockGroup: [0xa0],
  block: [0xa1],
  referenceBlock: [0xfb],
  void: [0xec],
}

const VIDEO = 1
const AUDIO = 2
const KEY = 0x80
const DELTA = 0x00

/** A block's data: track, int16 timecode relative to its Cluster, flags, one byte of payload. */
const blockData = (track: number, rel: number, flags: number): Bytes => [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, flags, 0x00]
const simpleBlock = (track: number, rel: number, flags: number) => el(ID.simpleBlock, blockData(track, rel, flags))
/** A BlockGroup; a delta frame carries a ReferenceBlock. */
const blockGroup = (track: number, rel: number, key: boolean) =>
  el(ID.blockGroup, el(ID.block, blockData(track, rel, 0)), key ? [] : uint(ID.referenceBlock, 0))
const timestamp = (ms: number) => uint(ID.clusterTimestamp, ms, 2)

const videoEntry = el(ID.trackEntry, uint(ID.trackNumber, VIDEO), uint(ID.trackType, 1))
const audioEntry = el(ID.trackEntry, uint(ID.trackNumber, AUDIO), uint(ID.trackType, 2))
const standardTracks = el(ID.tracks, videoEntry, audioEntry)

/** One video cue at `time` on the Cluster at `clusterOffset` (from the Segment's data). */
const cuePoint = (time: number, clusterOffset: number, track = VIDEO) =>
  el(ID.cuePoint, uint(ID.cueTime, time, 2), el(ID.cueTrackPositions, uint(ID.cueTrack, track), uint(ID.cueClusterPosition, clusterOffset, 4)))
/** The size of one `cuePoint`: fixed, since every field has a fixed width. */
const CUE_POINT_BYTES = cuePoint(0, 0).length

interface FileOptions {
  /** Defaults to a video and an audio track. */
  tracks?: Bytes
  /** Children of the Cluster the cue names (its ClusterTimestamp included). */
  cluster: Bytes[]
  /** The cue's time; 0 by default. */
  cueTime?: number
  /** Elements written into the Cues before the one real CuePoint. */
  cuesBefore?: Bytes[]
  /** Replaces the Cues element whole. */
  cues?: Bytes
  /** Bytes written after the Cluster (inside the Segment's size). */
  after?: Bytes
  /** Cut the file to this many bytes. */
  cutTo?: number
}

/** A WebM: EBML header, then a Segment of Tracks, Cues and the one Cluster the cue names. */
function webm(options: FileOptions): Blob {
  const tracks = options.tracks ?? standardTracks
  const cuesBefore = (options.cuesBefore ?? []).flat()
  // The Cues' length does not depend on the cluster position it holds.
  const cuesContentLength = cuesBefore.length + CUE_POINT_BYTES
  const cuesLength = ID.cues.length + size(cuesContentLength).length + cuesContentLength
  const clusterOffset = tracks.length + (options.cues?.length ?? cuesLength)
  const cues = options.cues ?? el(ID.cues, cuesBefore, cuePoint(options.cueTime ?? 0, clusterOffset))
  const cluster = el(ID.cluster, ...options.cluster)
  const segment = el(ID.segment, tracks, cues, cluster, options.after ?? [])
  const bytes = new Uint8Array([...el(ID.ebml, el(ID.docType, [0x77, 0x65, 0x62, 0x6d])), ...segment])
  return new Blob([bytes.subarray(0, options.cutTo ?? bytes.length) as BlobPart], { type: 'video/webm' })
}

/** The Cues element's direct children, by id, in a repaired file. */
async function cueChildrenOf(blob: Blob): Promise<number[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const at = bytes.findIndex((b, i) => b === 0x1c && bytes[i + 1] === 0x53 && bytes[i + 2] === 0xbb && bytes[i + 3] === 0x6b)
  const sizeLength = Math.clz32(bytes[at + 4]) - 23
  let length = bytes[at + 4] & (0xff >> sizeLength)
  for (let i = 1; i < sizeLength; i++) length = length * 256 + bytes[at + 4 + i]
  const ids: number[] = []
  for (let pos = at + 4 + sizeLength; pos < at + 4 + sizeLength + length; ) {
    const id = bytes[pos]
    const len = bytes[pos + 1] & 0x7f
    ids.push(id)
    pos += 2 + len
  }
  return ids
}

describe('dropDeltaFrameCues on hand-built files (ESCSUITE-439)', () => {
  it('drops the cue of a Cluster that opens on a video delta frame (the builder is sound)', async () => {
    const repaired = await dropDeltaFrameCues(webm({ cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))

    expect(repaired).not.toBeNull()
    expect(await cueChildrenOf(repaired!)).toEqual([])
  })

  it('leaves the cue of a Cluster that opens on a video key frame', async () => {
    expect(await dropDeltaFrameCues(webm({ cluster: [timestamp(0), simpleBlock(VIDEO, 0, KEY)] }))).toBeNull()
  })

  describe('the Segment and its Tracks', () => {
    it('answers null when the element after the EBML header is not a Segment', async () => {
      const bytes = new Uint8Array(await webm({ cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }).arrayBuffer())
      // The Segment id becomes a Void's.
      const segmentAt = bytes.findIndex((b, i) => b === 0x18 && bytes[i + 1] === 0x53 && bytes[i + 2] === 0x80 && bytes[i + 3] === 0x67)
      bytes.set([0xec], segmentAt)

      expect(await dropDeltaFrameCues(new Blob([bytes as BlobPart]))).toBeNull()
    })

    it('answers null when the Tracks element runs past the end of the file', async () => {
      const tracks = lying(ID.tracks, 4000, videoEntry)

      expect(await dropDeltaFrameCues(webm({ tracks, cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))).toBeNull()
    })

    it('answers null when a TrackEntry runs past its Tracks', async () => {
      const tracks = el(ID.tracks, lying(ID.trackEntry, 40, uint(ID.trackNumber, VIDEO), uint(ID.trackType, 1)))

      expect(await dropDeltaFrameCues(webm({ tracks, cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))).toBeNull()
    })

    it("answers null when a TrackEntry's own fields cannot be read", async () => {
      const tracks = el(ID.tracks, el(ID.trackEntry, uint(ID.trackNumber, VIDEO), lying(ID.trackType, 9, [1])))

      expect(await dropDeltaFrameCues(webm({ tracks, cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))).toBeNull()
    })

    it('reads past a Tracks child that is not a TrackEntry', async () => {
      const tracks = el(ID.tracks, el(ID.void, [0, 0]), videoEntry)

      expect(await dropDeltaFrameCues(webm({ tracks, cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))).not.toBeNull()
    })
  })

  describe('the Cues', () => {
    it('answers null when a CuePoint runs past its Cues', async () => {
      const cues = el(ID.cues, lying(ID.cuePoint, 30, uint(ID.cueTime, 0, 2)))

      expect(await dropDeltaFrameCues(webm({ cues, cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))).toBeNull()
    })

    it('keeps a Void and a CuePoint with no CueTime where they are, and drops only the wrong cue', async () => {
      const timeless = el(ID.cuePoint, el(ID.cueTrackPositions, uint(ID.cueTrack, VIDEO), uint(ID.cueClusterPosition, 0, 4)))
      const blob = webm({ cuesBefore: [el(ID.void, [0, 0]), timeless], cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] })

      const repaired = await dropDeltaFrameCues(blob)

      expect(repaired).not.toBeNull()
      expect(await cueChildrenOf(repaired!)).toEqual([0xec, 0xbb])
      expect(repaired!.size).toBe(blob.size)
    })

    it('keeps a CuePoint whose fields cannot be read', async () => {
      const unreadable = el(ID.cuePoint, lying(ID.cueTime, 9, [0, 0]))
      const repaired = await dropDeltaFrameCues(webm({ cuesBefore: [unreadable], cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] }))

      expect(await cueChildrenOf(repaired!)).toEqual([0xbb])
    })
  })

  describe("the Cluster's first video block", () => {
    it("reads past another track's SimpleBlock and a Void to the video track's", async () => {
      const cluster = [timestamp(0), simpleBlock(AUDIO, 0, KEY), el(ID.void, [0]), simpleBlock(VIDEO, 0, DELTA)]

      expect(await dropDeltaFrameCues(webm({ cluster }))).not.toBeNull()
    })

    it("reads past another track's BlockGroup to the video track's", async () => {
      const cluster = [timestamp(0), blockGroup(AUDIO, 0, true), blockGroup(VIDEO, 0, false)]

      expect(await dropDeltaFrameCues(webm({ cluster }))).not.toBeNull()
    })

    it('times a block with a negative timecode from its Cluster', async () => {
      // Cluster at 1 s, block at -1 s from it: the block is at 0, where the cue is.
      const cluster = [timestamp(1000), simpleBlock(VIDEO, -1000, DELTA)]

      expect(await dropDeltaFrameCues(webm({ cluster, cueTime: 0 }))).not.toBeNull()
      // And not where its timecode alone would put it.
      expect(await dropDeltaFrameCues(webm({ cluster, cueTime: 1000 }))).toBeNull()
    })

    it('keeps the cue when a SimpleBlock comes before the ClusterTimestamp', async () => {
      expect(await dropDeltaFrameCues(webm({ cluster: [simpleBlock(VIDEO, 0, DELTA), timestamp(0)] }))).toBeNull()
    })

    it('keeps the cue when a BlockGroup comes before the ClusterTimestamp', async () => {
      expect(await dropDeltaFrameCues(webm({ cluster: [blockGroup(VIDEO, 0, false), timestamp(0)] }))).toBeNull()
    })

    it('keeps the cue when a BlockGroup holds no Block', async () => {
      const cluster = [timestamp(0), el(ID.blockGroup, uint(ID.referenceBlock, 0))]

      expect(await dropDeltaFrameCues(webm({ cluster }))).toBeNull()
    })

    it('keeps the cue when an element inside a BlockGroup cannot be read', async () => {
      // A zero byte where an element id should be.
      const cluster = [timestamp(0), el(ID.blockGroup, [0x00, 0x80], el(ID.block, blockData(VIDEO, 0, 0)))]

      expect(await dropDeltaFrameCues(webm({ cluster }))).toBeNull()
    })

    it('keeps the cue when a BlockGroup holds more elements than are read', async () => {
      const voids = Array.from({ length: 1100 }, () => el(ID.void, []))
      const cluster = [timestamp(0), el(ID.blockGroup, ...voids, el(ID.block, blockData(VIDEO, 0, 0)), uint(ID.referenceBlock, 0))]

      expect(await dropDeltaFrameCues(webm({ cluster }))).toBeNull()
    })

    it('keeps the cue when a SimpleBlock is cut off before its flags', async () => {
      const blob = webm({ cluster: [timestamp(0), simpleBlock(VIDEO, 0, DELTA)] })

      expect(await dropDeltaFrameCues(new Blob([(await blob.arrayBuffer()).slice(0, blob.size - 3)]))).toBeNull()
    })

    it('keeps the cue when a Block is cut off before its flags', async () => {
      const blob = webm({ cluster: [timestamp(0), blockGroup(VIDEO, 0, true)] })

      expect(await dropDeltaFrameCues(new Blob([(await blob.arrayBuffer()).slice(0, blob.size - 3)]))).toBeNull()
    })

    it('keeps the cue when a Cluster holds another Cluster before any video block', async () => {
      const cluster = [timestamp(0), el(ID.cluster, timestamp(0)), simpleBlock(VIDEO, 0, DELTA)]

      expect(await dropDeltaFrameCues(webm({ cluster }))).toBeNull()
    })
  })
})
