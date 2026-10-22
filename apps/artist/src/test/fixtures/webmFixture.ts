// Hand-built WebM files for the seek-index probe and remux (ESCSUITE-305).
//
// Built byte by byte rather than through mediabunny's muxer, because the files
// this module has to recognise are the ones mediabunny never writes: a Segment
// whose Cues element is empty (`1c53bb6b 80`, what `webm-duration-fix` leaves
// on every ESCAPECRAFT composited-PiP take), one with no Cues at all (raw
// MediaRecorder output), and a VP9 track with `AlphaMode` 1 whose frames are
// BlockGroups carrying the alpha plane in BlockAdditions — the layout Chrome's
// MediaRecorder writes for the compositor's canvas stream.
//
// The VP9 payloads are a real uncompressed-header prefix (frame marker, profile
// 0, key or inter frame, the key frame's sync code) followed by filler: enough
// for a demuxer that peeks at a key frame's header, never decoded.

/** EBML element ids used here, as their byte strings. */
const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  SeekHead: [0x11, 0x4d, 0x9b, 0x74],
  Seek: [0x4d, 0xbb],
  SeekID: [0x53, 0xab],
  SeekPosition: [0x53, 0xac],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  Duration: [0x44, 0x89],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  CodecID: [0x86],
  CodecPrivate: [0x63, 0xa2],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  AlphaMode: [0x53, 0xc0],
  Audio: [0xe1],
  SamplingFrequency: [0xb5],
  Channels: [0x9f],
  Cues: [0x1c, 0x53, 0xbb, 0x6b],
  CuePoint: [0xbb],
  CueTime: [0xb3],
  CueTrackPositions: [0xb7],
  CueTrack: [0xf7],
  CueClusterPosition: [0xf1],
  CueRelativePosition: [0xf0],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timecode: [0xe7],
  SimpleBlock: [0xa3],
  BlockGroup: [0xa0],
  Block: [0xa1],
  ReferenceBlock: [0xfb],
  BlockAdditions: [0x75, 0xa1],
  BlockMore: [0xa6],
  BlockAddID: [0xee],
  BlockAdditional: [0xa5],
  Void: [0xec],
} as const

/** The four Cues id bytes, for a test that looks for them in an output. */
export const CUES_ID_BYTES = ID.Cues

/** An EBML size vint in the fewest bytes that hold `n` (never the all-ones "unknown" pattern). */
function sizeVint(n: number): number[] {
  for (let length = 1; length <= 8; length++) {
    if (n < 2 ** (7 * length) - 1) {
      const out: number[] = []
      let rest = n
      for (let i = length - 1; i >= 0; i--) {
        out[i] = rest & 0xff
        rest = Math.floor(rest / 256)
      }
      out[0] |= 0x80 >> (length - 1)
      return out
    }
  }
  throw new Error(`size ${n} too large`)
}

/** The eight-byte "unknown size" a live MediaRecorder writes for the Segment and each Cluster. */
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

type Bytes = number[]

function el(id: readonly number[], data: Bytes): Bytes {
  return [...id, ...sizeVint(data.length), ...data]
}

function uint(id: readonly number[], value: number): Bytes {
  const bytes: number[] = []
  let rest = value
  do {
    bytes.unshift(rest & 0xff)
    rest = Math.floor(rest / 256)
  } while (rest > 0)
  return el(id, bytes)
}

function float64(id: readonly number[], value: number): Bytes {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return el(id, [...new Uint8Array(view.buffer)])
}

function str(id: readonly number[], value: string): Bytes {
  return el(id, [...new TextEncoder().encode(value)])
}

/** A VP9 frame: a real uncompressed-header prefix, then `fill` repeated. */
function vp9Frame(key: boolean, fill: number): Bytes {
  // frame_marker 0b10, profile 0, show_existing_frame 0, frame_type, show_frame 1, error_resilient 0.
  const first = key ? 0x82 : 0x86
  const header = key ? [first, 0x49, 0x83, 0x42, 0x00, 0x00, 0x0f, 0x00, 0x0f] : [first, 0x00]
  return [...header, ...new Array<number>(8).fill(fill)]
}

/** A 20 ms CELT fullband Opus packet (TOC 0xFC, stereo, one frame) plus filler. */
function opusPacket(fill: number): Bytes {
  return [0xfc, ...new Array<number>(6).fill(fill)]
}

/** The bytes after a Block / SimpleBlock id and size: track, relative timecode, flags, payload. */
function blockBody(track: number, relativeMs: number, flags: number, payload: Bytes): Bytes {
  const rel = relativeMs & 0xffff
  return [0x80 | track, rel >> 8, rel & 0xff, flags, ...payload]
}

export interface WebmVideoFrame {
  /** Milliseconds from the start of the file. */
  timeMs: number
  key: boolean
  /** The alpha plane, written as BlockAdditions (BlockAddID 1). Omit for a frame with none. */
  alpha?: Uint8Array
}

export interface WebmFixtureOptions {
  /** What sits where the index belongs. Default `'none'`. */
  cues?: 'none' | 'empty' | 'indexed'
  /** Point a SeekHead entry at the Cues element (when there is one). Default true. */
  seekHeadToCues?: boolean
  /** Write the Segment and every Cluster with the unknown size a live recorder writes. Default false. */
  unknownSizes?: boolean
  /** Video frames, in order. Default: 10 frames at 30 fps, key at 0 and 5, no alpha. */
  frames?: WebmVideoFrame[]
  /** Write the video track with `AlphaMode` 1 and every frame as a BlockGroup. Default false. */
  alphaMode?: boolean
  /** Add an Opus track with one 20 ms packet per 20 ms of the video's length. Default false. */
  audio?: boolean
  /** Start a new Cluster every this many milliseconds. Default 1000. */
  clusterMs?: number
  /** Put a Void element inside the SeekHead, after its entries, as a muxer reserving room does. */
  seekHeadVoid?: boolean
  /** Write this as the SeekHead's Cues position instead of the true one. */
  cuesSeekPosition?: number
  /** The video track's CodecID. Default `V_VP9`. */
  videoCodecId?: string
  /** With `cues: 'indexed'` and `audio`, give each CuePoint a second CueTrackPositions, for the audio track. Default false. */
  cueAudio?: boolean
  /** With `cues: 'indexed'`, give each CueTrackPositions a CueRelativePosition, as ESCAPECRAFT's `writeKeyframeCues` and ffmpeg do. Default false. */
  cueRelativePosition?: boolean
}

/** Ten frames at 30 fps, key frames at frame 0 and frame 5. */
export function defaultFrames(): WebmVideoFrame[] {
  return Array.from({ length: 10 }, (_, i) => ({ timeMs: Math.round((i * 1000) / 30), key: i % 5 === 0 }))
}

/** A frame list with alpha on every frame: `alpha[i]` is filled with `i + 1`. */
export function alphaFrames(count = 10, keyEvery = 5): WebmVideoFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    timeMs: Math.round((i * 1000) / 30),
    key: i % keyEvery === 0,
    alpha: new Uint8Array(6).fill(i + 1),
  }))
}

interface MediaBlock {
  timeMs: number
  bytes: (clusterMs: number) => Bytes
}

/**
 * Build a WebM file. Every option defaults to the smallest file that still has
 * a picture: one 16x16 VP9 track, ten frames, one cluster, no Cues.
 */
export function buildWebm(options: WebmFixtureOptions = {}): Uint8Array {
  const {
    cues = 'none',
    seekHeadToCues = true,
    unknownSizes = false,
    frames = defaultFrames(),
    alphaMode = false,
    audio = false,
    clusterMs = 1000,
    seekHeadVoid = false,
    cuesSeekPosition,
    videoCodecId = 'V_VP9',
    cueAudio = false,
    cueRelativePosition = false,
  } = options

  const header = el(ID.EBML, [
    ...uint(ID.EBMLVersion, 1),
    ...uint(ID.EBMLReadVersion, 1),
    ...uint(ID.EBMLMaxIDLength, 4),
    ...uint(ID.EBMLMaxSizeLength, 8),
    ...str(ID.DocType, 'webm'),
    ...uint(ID.DocTypeVersion, 4),
    ...uint(ID.DocTypeReadVersion, 2),
  ])

  const lastMs = frames[frames.length - 1].timeMs + 33
  const info = el(ID.Info, [
    ...uint(ID.TimecodeScale, 1_000_000),
    ...str(ID.MuxingApp, 'fixture'),
    ...str(ID.WritingApp, 'fixture'),
    ...float64(ID.Duration, lastMs),
  ])

  const videoEntry = el(ID.TrackEntry, [
    ...uint(ID.TrackNumber, 1),
    ...uint(ID.TrackUID, 1),
    ...uint(ID.TrackType, 1),
    ...str(ID.CodecID, videoCodecId),
    ...el(ID.Video, [
      ...uint(ID.PixelWidth, 16),
      ...uint(ID.PixelHeight, 16),
      ...(alphaMode ? uint(ID.AlphaMode, 1) : []),
    ]),
  ])
  const opusHead = [...new TextEncoder().encode('OpusHead'), 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]
  const audioEntry = el(ID.TrackEntry, [
    ...uint(ID.TrackNumber, 2),
    ...uint(ID.TrackUID, 2),
    ...uint(ID.TrackType, 2),
    ...str(ID.CodecID, 'A_OPUS'),
    ...el(ID.CodecPrivate, opusHead),
    ...el(ID.Audio, [...float64(ID.SamplingFrequency, 48000), ...uint(ID.Channels, 2)]),
  ])
  const tracks = el(ID.Tracks, [...videoEntry, ...(audio ? audioEntry : [])])

  // Every media block, video and audio interleaved by time.
  const blocks: MediaBlock[] = frames.map((frame, index) => ({
    timeMs: frame.timeMs,
    bytes: (clusterStart: number) => {
      const payload = vp9Frame(frame.key, index & 0xff)
      const rel = frame.timeMs - clusterStart
      if (!alphaMode) return el(ID.SimpleBlock, blockBody(1, rel, frame.key ? 0x80 : 0x00, payload))
      return el(ID.BlockGroup, [
        ...el(ID.Block, blockBody(1, rel, 0x00, payload)),
        ...(frame.key ? [] : el(ID.ReferenceBlock, [0xdf])),
        ...(frame.alpha
          ? el(ID.BlockAdditions, el(ID.BlockMore, [...uint(ID.BlockAddID, 1), ...el(ID.BlockAdditional, [...frame.alpha])]))
          : []),
      ])
    },
  }))
  if (audio) {
    for (let t = 0, i = 0; t < lastMs; t += 20, i++) {
      blocks.push({
        timeMs: t,
        bytes: (clusterStart: number) => el(ID.SimpleBlock, blockBody(2, t - clusterStart, 0x80, opusPacket(i & 0xff))),
      })
    }
  }
  blocks.sort((a, b) => a.timeMs - b.timeMs)

  // Group into clusters every `clusterMs`, whatever the key frames are — the
  // way Chrome's MediaRecorder does, and the layout Firefox cannot seek without Cues.
  const clusters: { startMs: number; bytes: Bytes }[] = []
  for (const block of blocks) {
    const startMs = Math.floor(block.timeMs / clusterMs) * clusterMs
    let cluster = clusters[clusters.length - 1]
    if (!cluster || cluster.startMs !== startMs) {
      cluster = { startMs, bytes: uint(ID.Timecode, startMs) }
      clusters.push(cluster)
    }
    cluster.bytes.push(...block.bytes(startMs))
  }
  const clusterElements = clusters.map((c) =>
    unknownSizes ? [...ID.Cluster, ...UNKNOWN_SIZE, ...c.bytes] : el(ID.Cluster, c.bytes)
  )

  // The Cues, placed before the clusters as `webm-duration-fix` places them.
  // Its positions are filled in once the layout before the clusters is known,
  // so they are computed in a second pass over fixed-width position fields.
  const buildCues = (firstClusterOffset: number): Bytes => {
    if (cues === 'empty') return [...ID.Cues, 0x80]
    if (cues === 'none') return []
    const points: Bytes = []
    let offset = firstClusterOffset
    clusters.forEach((cluster, index) => {
      points.push(
        ...el(ID.CuePoint, [
          ...uint(ID.CueTime, cluster.startMs),
          ...[1, ...(audio && cueAudio ? [2] : [])].flatMap((track) =>
            el(ID.CueTrackPositions, [
              ...uint(ID.CueTrack, track),
              // Four bytes always, so the Cues element's length does not depend on the positions.
              ...el(ID.CueClusterPosition, [offset >>> 24, (offset >>> 16) & 0xff, (offset >>> 8) & 0xff, offset & 0xff]),
              ...(cueRelativePosition ? uint(ID.CueRelativePosition, 0) : []),
            ])
          ),
        ])
      )
      offset += clusterElements[index].length
    })
    return el(ID.Cues, points)
  }

  const seekEntries = (trueCuesOffset: number): Bytes => {
    const cuesOffset = cuesSeekPosition ?? trueCuesOffset
    const entries: Bytes = []
    if (cues !== 'none' && seekHeadToCues) {
      entries.push(
        ...el(ID.Seek, [
          ...el(ID.SeekID, [...ID.Cues]),
          ...el(ID.SeekPosition, [cuesOffset >>> 24, (cuesOffset >>> 16) & 0xff, (cuesOffset >>> 8) & 0xff, cuesOffset & 0xff]),
        ])
      )
    }
    entries.push(...el(ID.Seek, [...el(ID.SeekID, [...ID.Info]), ...el(ID.SeekPosition, [0, 0, 0, 0])]))
    if (seekHeadVoid) entries.push(...el(ID.Void, [0, 0, 0, 0]))
    return el(ID.SeekHead, entries)
  }

  // Positions are relative to the Segment's data start.
  const seekHeadLength = seekEntries(0).length
  const cuesOffset = seekHeadLength + info.length + tracks.length
  const cuesLength = buildCues(0).length
  const firstClusterOffset = cuesOffset + cuesLength
  const segmentBody = [
    ...seekEntries(cuesOffset),
    ...info,
    ...tracks,
    ...buildCues(firstClusterOffset),
    ...clusterElements.flat(),
  ]
  const segment = unknownSizes ? [...ID.Segment, ...UNKNOWN_SIZE, ...segmentBody] : el(ID.Segment, segmentBody)

  return new Uint8Array([...header, ...segment])
}

/** `buildWebm` as a Blob of the given type. */
export function webmBlob(options: WebmFixtureOptions = {}, type = 'video/webm'): Blob {
  return new Blob([buildWebm(options) as BlobPart], { type })
}

/**
 * Whether `bytes` holds a Cues element with something in it: the Cues id
 * followed by a non-zero size, skipping the id where it is a SeekHead entry's
 * SeekID payload (`53 ab 84` before it).
 */
export function hasNonEmptyCues(bytes: Uint8Array): boolean {
  for (let i = 3; i + 4 < bytes.length; i++) {
    const isId = bytes[i] === 0x1c && bytes[i + 1] === 0x53 && bytes[i + 2] === 0xbb && bytes[i + 3] === 0x6b
    const isSeekId = bytes[i - 3] === 0x53 && bytes[i - 2] === 0xab && bytes[i - 1] === 0x84
    if (isId && !isSeekId) return bytes[i + 4] !== 0x80
  }
  return false
}
