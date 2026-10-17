/**
 * Hand-built WebM containers for the keyframe-Cues repair (ESCSUITE-322), and a
 * reader for the Cues it writes.
 *
 * The builder writes the shape `webm-duration-fix` hands back for a Chrome
 * MediaRecorder take — EBML header, an unknown-size Segment, SeekHead, Info,
 * Tracks, a Cues element, then Clusters — with every knob the repair's walk
 * branches on: unknown- or known-size Clusters, video frames as SimpleBlocks or
 * as BlockGroups (with alpha BlockAdditions and with or without a
 * ReferenceBlock), audio as SimpleBlocks or BlockGroups, Void elements, and a
 * Cues element that is empty, stale or missing.
 *
 * The reader deliberately shares no code with `core/webmCues.ts`: it walks a
 * Uint8Array synchronously, so a bug in the module's walk cannot hide behind the
 * same bug in the oracle.
 */

import { expect } from 'vitest'

export type Bytes = number[]

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  SEGMENT: [0x18, 0x53, 0x80, 0x67],
  SEEK_HEAD: [0x11, 0x4d, 0x9b, 0x74],
  SEEK: [0x4d, 0xbb],
  SEEK_ID: [0x53, 0xab],
  SEEK_POSITION: [0x53, 0xac],
  INFO: [0x15, 0x49, 0xa9, 0x66],
  TIMECODE_SCALE: [0x2a, 0xd7, 0xb1],
  DURATION: [0x44, 0x89],
  TRACKS: [0x16, 0x54, 0xae, 0x6b],
  TRACK_ENTRY: [0xae],
  TRACK_NUMBER: [0xd7],
  TRACK_TYPE: [0x83],
  CODEC_ID: [0x86],
  CUES: [0x1c, 0x53, 0xbb, 0x6b],
  CUE_POINT: [0xbb],
  CUE_TIME: [0xb3],
  CUE_TRACK_POSITIONS: [0xb7],
  CUE_TRACK: [0xf7],
  CUE_CLUSTER_POSITION: [0xf1],
  CLUSTER: [0x1f, 0x43, 0xb6, 0x75],
  TIMECODE: [0xe7],
  SIMPLE_BLOCK: [0xa3],
  BLOCK_GROUP: [0xa0],
  BLOCK: [0xa1],
  REFERENCE_BLOCK: [0xfb],
  BLOCK_ADDITIONS: [0x75, 0xa1],
  BLOCK_MORE: [0xa6],
  BLOCK_ADD_ID: [0xee],
  BLOCK_ADDITIONAL: [0xa5],
  DISCARD_PADDING: [0x75, 0xa2],
  VOID: [0xec],
} as const

const UNKNOWN_SIZE: Bytes = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

function bigEndian(value: number, width: number): Bytes {
  const out: Bytes = []
  let v = value
  for (let i = 0; i < width; i++) {
    out.unshift(v % 256)
    v = Math.floor(v / 256)
  }
  return out
}

function sizeVint(n: number): Bytes {
  return n < 0x7f ? [0x80 | n] : [0x01, ...bigEndian(n, 7)]
}

export function el(id: readonly number[], payload: Bytes, unknownSize = false): Bytes {
  return [...id, ...(unknownSize ? UNKNOWN_SIZE : sizeVint(payload.length)), ...payload]
}

function uintEl(id: readonly number[], value: number, width = 1): Bytes {
  return el(id, bigEndian(value, width))
}

function blockBody(track: number, rel: number, flags: number): Bytes {
  // Track number as a one-byte vint, a signed 16-bit relative timecode, the
  // flags byte, then four bytes of "frame" that can never spell an element ID.
  return [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, flags, 0x00, 0x00, 0x00, 0x00]
}

export type ClusterChild =
  | { kind: 'simple'; track: number; rel: number; key: boolean }
  | {
      kind: 'group'
      track: number
      rel: number
      /** A ReferenceBlock, which makes the frame a delta frame. */
      reference?: number
      /** VP9 alpha, as Chrome writes it for the compositor's canvas stream. */
      alpha?: boolean
      /** Opus discard padding, the one audio BlockGroup MediaRecorder writes. */
      discardPadding?: boolean
    }
  | { kind: 'void'; length: number }

export interface FixtureCluster {
  timecode: number
  unknownSize: boolean
  children: ClusterChild[]
}

export interface FixtureSpec {
  tracks: Array<{ number: number; type: 1 | 2; codec: string }>
  /** What sits where `webm-duration-fix` writes its Cues element. */
  cues: 'empty' | 'stale' | 'none'
  clusters: FixtureCluster[]
}

export interface Fixture {
  bytes: Uint8Array
  blob: Blob
  segmentDataStart: number
  cuesStart: number
  cuesEnd: number
  /** Absolute offset of each Cluster element. */
  clusterStarts: number[]
  /** Absolute offset of each child element, per cluster. */
  childStarts: number[][]
}

function childBytes(child: ClusterChild): Bytes {
  if (child.kind === 'simple') {
    return el(ID.SIMPLE_BLOCK, blockBody(child.track, child.rel, child.key ? 0x80 : 0x00))
  }
  if (child.kind === 'void') return el(ID.VOID, new Array<number>(child.length).fill(0))
  const parts: Bytes = [...el(ID.BLOCK, blockBody(child.track, child.rel, 0x00))]
  if (child.alpha) {
    parts.push(
      ...el(
        ID.BLOCK_ADDITIONS,
        el(ID.BLOCK_MORE, [...uintEl(ID.BLOCK_ADD_ID, 1), ...el(ID.BLOCK_ADDITIONAL, [0, 0, 0, 0])])
      )
    )
  }
  if (child.reference !== undefined) {
    parts.push(...el(ID.REFERENCE_BLOCK, bigEndian(child.reference & 0xffff, 2)))
  }
  if (child.discardPadding) parts.push(...uintEl(ID.DISCARD_PADDING, 1000, 2))
  return el(ID.BLOCK_GROUP, parts)
}

function cuesBytes(kind: FixtureSpec['cues']): Bytes {
  if (kind === 'none') return []
  if (kind === 'empty') return el(ID.CUES, [])
  // What the library writes for a SimpleBlock take: a CuePoint at the first
  // video block of each cluster, keyframe or not. Positions are junk on
  // purpose — the repair must replace them, not adjust them.
  const point = (time: number) =>
    el(ID.CUE_POINT, [
      ...uintEl(ID.CUE_TIME, time, 2),
      ...el(ID.CUE_TRACK_POSITIONS, [
        ...uintEl(ID.CUE_TRACK, 1),
        ...uintEl(ID.CUE_CLUSTER_POSITION, 0x1234, 2),
      ]),
    ])
  return el(ID.CUES, [...point(0), ...point(1000)])
}

export function buildWebM(spec: FixtureSpec): Fixture {
  const ebml = el(ID.EBML, [...el([0x42, 0x82], [...'webm'].map((c) => c.charCodeAt(0)))])
  const segmentHeader = [...ID.SEGMENT, ...UNKNOWN_SIZE]
  const info = el(ID.INFO, [
    ...uintEl(ID.TIMECODE_SCALE, 1_000_000, 3),
    ...el(ID.DURATION, [0x40, 0xa7, 0x70, 0x00, 0x00, 0x00, 0x00, 0x00]), // 3000.0
  ])
  const tracks = el(
    ID.TRACKS,
    spec.tracks.flatMap((t) =>
      el(ID.TRACK_ENTRY, [
        ...uintEl(ID.TRACK_NUMBER, t.number),
        ...uintEl(ID.TRACK_TYPE, t.type),
        ...el(ID.CODEC_ID, [...t.codec].map((c) => c.charCodeAt(0))),
      ])
    )
  )
  // The SeekHead's Cues entry: a fixed-width position so its length does not
  // depend on its value, the way the library writes room for growth.
  const seekHead = (cuesPosition: number) =>
    el(ID.SEEK_HEAD, el(ID.SEEK, [...el(ID.SEEK_ID, [...ID.CUES]), ...uintEl(ID.SEEK_POSITION, cuesPosition, 4)]))
  const cues = cuesBytes(spec.cues)
  const segmentDataStart = ebml.length + segmentHeader.length
  const cuesRelative = seekHead(0).length + info.length + tracks.length

  const out: Bytes = [...ebml, ...segmentHeader, ...seekHead(cuesRelative), ...info, ...tracks]
  const cuesStart = out.length
  out.push(...cues)
  const cuesEnd = out.length

  const clusterStarts: number[] = []
  const childStarts: number[][] = []
  for (const cluster of spec.clusters) {
    const timecode = uintEl(ID.TIMECODE, cluster.timecode, 2)
    const children = cluster.children.map(childBytes)
    const payload = [...timecode, ...children.flat()]
    const element = el(ID.CLUSTER, payload, cluster.unknownSize)
    const start = out.length
    const dataStart = start + element.length - payload.length
    clusterStarts.push(start)
    let at = dataStart + timecode.length
    childStarts.push(
      children.map((c) => {
        const here = at
        at += c.length
        return here
      })
    )
    out.push(...element)
  }

  const bytes = new Uint8Array(out)
  return {
    bytes,
    blob: new Blob([bytes], { type: 'video/webm' }),
    segmentDataStart,
    cuesStart,
    cuesEnd,
    clusterStarts,
    childStarts,
  }
}

// --- reading -----------------------------------------------------------------

interface Element {
  id: number
  start: number
  dataStart: number
  end: number
}

function vintLength(byte: number): number {
  let length = 1
  for (let mask = 0x80; length <= 8 && (byte & mask) === 0; mask >>= 1) length++
  return length
}

function readElement(bytes: Uint8Array, start: number): Element {
  const idLength = vintLength(bytes[start])
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + bytes[start + k]
  const sizeAt = start + idLength
  const sizeLength = vintLength(bytes[sizeAt])
  let size = bytes[sizeAt] & (0xff >> sizeLength)
  let allOnes = size === 0xff >> sizeLength
  for (let k = 1; k < sizeLength; k++) {
    size = size * 256 + bytes[sizeAt + k]
    allOnes = allOnes && bytes[sizeAt + k] === 0xff
  }
  const dataStart = sizeAt + sizeLength
  return { id, start, dataStart, end: allOnes ? Number.POSITIVE_INFINITY : dataStart + size }
}

function readUint(bytes: Uint8Array, e: Element): number {
  let v = 0
  for (let k = e.dataStart; k < e.end; k++) v = v * 256 + bytes[k]
  return v
}

function children(bytes: Uint8Array, parent: Element): Element[] {
  const out: Element[] = []
  for (let at = parent.dataStart; at < Math.min(parent.end, bytes.length); ) {
    const child = readElement(bytes, at)
    out.push(child)
    at = child.end
  }
  return out
}

export interface CuePointRead {
  time: number
  track: number
  /** CueClusterPosition, relative to the Segment's data start. */
  clusterPosition: number
  /** CueRelativePosition, relative to the Cluster's data start, if written. */
  relativePosition?: number
}

export interface CuesRead {
  segmentDataStart: number
  /** Absolute offset and payload length of the Cues element, if there is one. */
  cuesStart?: number
  cuesPayloadBytes?: number
  /** SeekPosition of the SeekHead's Cues entry, relative to the Segment data. */
  seekHeadCuesPosition?: number
  hasDuration: boolean
  points: CuePointRead[]
}

const CUES_ID = 0x1c53bb6b
const CLUSTER_ID = 0x1f43b675

/** Walk a WebM's top level up to the first Cluster and read its Cues. */
export function readCues(bytes: Uint8Array): CuesRead {
  const ebml = readElement(bytes, 0)
  const segment = readElement(bytes, ebml.end)
  const result: CuesRead = { segmentDataStart: segment.dataStart, hasDuration: false, points: [] }
  for (let at = segment.dataStart; at < bytes.length; ) {
    const e = readElement(bytes, at)
    if (e.id === CLUSTER_ID) break
    if (e.id === 0x1549a966) {
      result.hasDuration = children(bytes, e).some((c) => c.id === 0x4489)
    }
    if (e.id === 0x114d9b74) {
      for (const seek of children(bytes, e)) {
        const fields = children(bytes, seek)
        const seekId = fields.find((f) => f.id === 0x53ab)!
        const target = bytes.slice(seekId.dataStart, seekId.end)
        if (target.length === 4 && readUint(bytes, seekId) === CUES_ID) {
          result.seekHeadCuesPosition = readUint(bytes, fields.find((f) => f.id === 0x53ac)!)
        }
      }
    }
    if (e.id === CUES_ID) {
      result.cuesStart = e.start
      result.cuesPayloadBytes = e.end - e.dataStart
      for (const point of children(bytes, e)) {
        const fields = children(bytes, point)
        const time = readUint(bytes, fields.find((f) => f.id === 0xb3)!)
        const positions = children(bytes, fields.find((f) => f.id === 0xb7)!)
        const field = (id: number) => {
          const found = positions.find((f) => f.id === id)
          return found ? readUint(bytes, found) : undefined
        }
        result.points.push({
          time,
          track: field(0xf7)!,
          clusterPosition: field(0xf1)!,
          relativePosition: field(0xf0),
        })
      }
    }
    at = e.end
  }
  return result
}

/** The element ID at an absolute offset, for "this cue lands on a Cluster". */
export function elementIdAt(bytes: Uint8Array, offset: number): number {
  return readElement(bytes, offset).id
}

/** The data start of the element at an absolute offset. */
export function elementDataStartAt(bytes: Uint8Array, offset: number): number {
  return readElement(bytes, offset).dataStart
}

// --- the shared fixtures and the contract ----------------------------------

const AV_TRACKS: FixtureSpec['tracks'] = [
  { number: 1, type: 1, codec: 'V_VP9' },
  { number: 2, type: 2, codec: 'A_OPUS' },
]

/**
 * A composited-PiP take as Chrome's MediaRecorder writes it and
 * `webm-duration-fix` hands it back: unknown-size Clusters about a second
 * apart regardless of keyframes, every video frame a BlockGroup carrying alpha
 * BlockAdditions (delta frames with a ReferenceBlock), Opus as SimpleBlocks
 * plus one BlockGroup with discard padding, and an empty Cues element.
 */
export const PIP_SPEC: FixtureSpec = {
  tracks: AV_TRACKS,
  cues: 'empty',
  clusters: [
    {
      timecode: 0,
      unknownSize: true,
      children: [
        { kind: 'group', track: 1, rel: 0, alpha: true },
        { kind: 'simple', track: 2, rel: 5, key: true },
        { kind: 'group', track: 1, rel: 33, alpha: true, reference: -33 },
        { kind: 'group', track: 2, rel: 20, discardPadding: true },
        { kind: 'group', track: 1, rel: 66, alpha: true, reference: -33 },
      ],
    },
    {
      timecode: 1000,
      unknownSize: true,
      children: [
        { kind: 'simple', track: 2, rel: 0, key: true },
        { kind: 'group', track: 1, rel: 10, alpha: true, reference: -10 },
        { kind: 'group', track: 1, rel: 40, alpha: true },
        { kind: 'void', length: 3 },
      ],
    },
    {
      // A cluster with no video block in it at all.
      timecode: 2000,
      unknownSize: true,
      children: [
        { kind: 'simple', track: 2, rel: 0, key: true },
        { kind: 'simple', track: 2, rel: 20, key: true },
      ],
    },
    {
      timecode: 3000,
      unknownSize: true,
      children: [{ kind: 'group', track: 1, rel: 0, alpha: true }],
    },
  ],
}
/** Keyframes of PIP_SPEC: [cluster, child, CueTime]. */
export const PIP_KEYFRAMES: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 2, 1040],
  [3, 0, 3000],
]

/**
 * A SimpleBlock take with known-size Clusters and the CuePoints the library
 * writes for one — the first video block of each cluster, keyframe or not.
 */
export const SIMPLE_SPEC: FixtureSpec = {
  tracks: AV_TRACKS,
  cues: 'stale',
  clusters: [
    {
      timecode: 0,
      unknownSize: false,
      children: [
        { kind: 'simple', track: 1, rel: 0, key: true },
        { kind: 'simple', track: 2, rel: 0, key: true },
        { kind: 'simple', track: 1, rel: 33, key: false },
      ],
    },
    {
      timecode: 1000,
      unknownSize: false,
      children: [
        { kind: 'simple', track: 1, rel: 0, key: false },
        { kind: 'simple', track: 1, rel: 33, key: true },
        { kind: 'void', length: 2 },
      ],
    },
  ],
}
export const SIMPLE_KEYFRAMES: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 1, 1033],
]

/** A microphone-only MediaRecorder take: one Opus track, no picture. */
export const AUDIO_SPEC: FixtureSpec = {
  tracks: [{ number: 1, type: 2, codec: 'A_OPUS' }],
  cues: 'stale',
  clusters: [
    {
      timecode: 0,
      unknownSize: true,
      children: [
        { kind: 'simple', track: 1, rel: 0, key: true },
        { kind: 'simple', track: 1, rel: 20, key: true },
      ],
    },
  ],
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * The whole contract for one repaired file: its Cues index exactly the
 * keyframes, each CuePoint lands on the right Cluster (relative to the Segment
 * data start, in the OUTPUT file) and on the right block within it, and every
 * byte outside the Cues element is the input's.
 */
export function expectIndexesKeyframes(
  fixture: Fixture,
  out: Uint8Array,
  keyframes: Array<[number, number, number]>
): void {
  const read = readCues(out)
  expect(read.points.map((p) => p.time)).toEqual(keyframes.map(([, , time]) => time))
  expect(read.cuesPayloadBytes).toBeGreaterThan(0)
  expect(read.hasDuration).toBe(true)

  const grown = out.length - fixture.bytes.length
  read.points.forEach((point, i) => {
    const [cluster, child] = keyframes[i]
    const clusterAt = read.segmentDataStart + point.clusterPosition
    expect(point.track).toBe(1)
    expect(elementIdAt(out, clusterAt)).toBe(CLUSTER_ID)
    expect(clusterAt).toBe(fixture.clusterStarts[cluster] + grown)
    const clusterData = elementDataStartAt(fixture.bytes, fixture.clusterStarts[cluster])
    expect(point.relativePosition).toBe(fixture.childStarts[cluster][child] - clusterData)
  })

  // Nothing but the Cues element moved: the head up to it, and everything
  // after it — the clusters, alpha and all — are the input's own bytes.
  const newCuesEnd = fixture.cuesEnd + grown
  expect(out.slice(0, fixture.cuesStart)).toEqual(fixture.bytes.slice(0, fixture.cuesStart))
  expect(out.slice(newCuesEnd)).toEqual(fixture.bytes.slice(fixture.cuesEnd))
  // The SeekHead's Cues entry still points at the Cues element.
  expect(read.segmentDataStart + read.seekHeadCuesPosition!).toBe(read.cuesStart)
}

