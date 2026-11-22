/**
 * Unit tests for `utils/webmLayout.ts` (ESCSUITE-494): the e2e WebM reader sees
 * every video frame, whether Mediabunny stored it as a SimpleBlock or, as it
 * does for the last frame of each track in a Cluster, as a Block inside a
 * BlockGroup. The fixture is a small WebM built here, element by element.
 * Node strips the types on import.
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readWebmLayout, videoLayoutProblems } from '../utils/webmLayout.ts'

/** An EBML element: its id's bytes, an 8-byte size, then its payload's bytes. */
function el(id, ...payload) {
  const data = payload.flatMap((p) => (typeof p === 'number' ? [p] : [...p]))
  const size = [0x01, 0, 0, 0, (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff]
  return [...id, ...size, ...data]
}
const uint = (id, value) => el(id, (value >>> 8) & 0xff, value & 0xff)
const signed = (id, value) => el(id, (value >> 8) & 0xff, value & 0xff)
/** A block's head: track 1 or 2 as a one-byte vint, the int16 relative timecode, the flags byte. */
const head = (track, relative, flags) => [0x80 | track, (relative >> 8) & 0xff, relative & 0xff, flags]

const EBML = [0x1a, 0x45, 0xdf, 0xa3]
const SEGMENT = [0x18, 0x53, 0x80, 0x67]
const TRACKS = [0x16, 0x54, 0xae, 0x6b]
const TRACK_ENTRY = [0xae]
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75]
const TIMECODE = [0xe7]
const SIMPLE_BLOCK = [0xa3]
const BLOCK_GROUP = [0xa0]
const BLOCK = [0xa1]
const REFERENCE_BLOCK = [0xfb]
const BLOCK_DURATION = [0x9b]

const KEY = 0x80

/**
 * Two Clusters, as Mediabunny writes them: SimpleBlocks, then each track's
 * last frame in a BlockGroup with its BlockDuration (a delta frame carries a
 * ReferenceBlock, a key frame none). The audio track's blocks are not video.
 */
function fixture() {
  const tracks = el(
    TRACKS,
    el(TRACK_ENTRY, uint([0xd7], 1), uint([0x83], 1), el([0x86], ...new TextEncoder().encode('V_VP9'))),
    el(TRACK_ENTRY, uint([0xd7], 2), uint([0x83], 2), el([0x86], ...new TextEncoder().encode('A_OPUS')))
  )
  const first = el(
    CLUSTER,
    uint(TIMECODE, 0),
    el(SIMPLE_BLOCK, head(1, 0, KEY), 0x10),
    el(SIMPLE_BLOCK, head(2, 0, KEY), 0xa0),
    el(SIMPLE_BLOCK, head(1, 33, 0), 0x11),
    el(BLOCK_GROUP, el(BLOCK, head(2, 20, 0), 0xa1), uint(BLOCK_DURATION, 20)),
    el(BLOCK_GROUP, el(BLOCK, head(1, 67, 0), 0x12, 0x13), signed(REFERENCE_BLOCK, -34), uint(BLOCK_DURATION, 33))
  )
  // A one-frame Cluster: its key frame is also the track's last, so a BlockGroup.
  const second = el(CLUSTER, uint(TIMECODE, 100), el(BLOCK_GROUP, el(BLOCK, head(1, 0, 0), 0x20), uint(BLOCK_DURATION, 33)))
  const cues = el(
    [0x1c, 0x53, 0xbb, 0x6b],
    el([0xbb], uint([0xb3], 0), el([0xb7], uint([0xf7], 1), uint([0xf1], tracks.length))),
    el([0xbb], uint([0xb3], 100), el([0xb7], uint([0xf7], 1), uint([0xf1], tracks.length + first.length)))
  )
  return new Uint8Array([...el(EBML), ...el(SEGMENT, ...tracks, ...first, ...second, ...cues)])
}

test('reads video frames from SimpleBlocks and from Blocks inside BlockGroups', () => {
  const layout = readWebmLayout(fixture())
  assert.equal(layout.videoTrack, 1)
  assert.equal(layout.videoCodec, 'V_VP9')
  assert.deepEqual(
    layout.videoBlocks.map(({ time, key, cluster, firstInCluster, data }) => ({ time, key, cluster, firstInCluster, data: [...data] })),
    [
      { time: 0, key: true, cluster: 0, firstInCluster: true, data: [0x10] },
      { time: 33, key: false, cluster: 0, firstInCluster: false, data: [0x11] },
      { time: 67, key: false, cluster: 0, firstInCluster: false, data: [0x12, 0x13] },
      { time: 100, key: true, cluster: 1, firstInCluster: true, data: [0x20] },
    ]
  )
  assert.equal(layout.clusterPositions.length, 2)
  assert.equal(layout.cues.length, 2)
})

test('a well-formed file with BlockGroups has no layout problems', () => {
  assert.deepEqual(videoLayoutProblems(readWebmLayout(fixture())), [])
})
