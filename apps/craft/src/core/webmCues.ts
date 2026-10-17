/**
 * Give a repaired MediaRecorder WebM a Cues element that indexes every video
 * keyframe (ESCSUITE-322).
 *
 * `webm-duration-fix` writes the Duration and a Cues element, but it records a
 * CuePoint only at the first video **SimpleBlock** of a cluster. Chrome's
 * MediaRecorder writes every frame of the compositor's alpha-VP9 canvas stream
 * as a **BlockGroup** (the alpha plane rides in BlockAdditions), so a
 * composited-PiP take came out of the library with an empty Cues element.
 * Chromium's `<video>` scans such a file and seeks it anyway; Firefox's seek
 * into a cluster that does not open on a keyframe never fires `seeked`, so an
 * ESCAPEARTIST export of the take on Firefox drew black frames (ESCSUITE-305).
 * The same file with a real keyframe index seeks on Firefox every time.
 *
 * This step is pure bytes and runs once per save. It walks the Segment once,
 * reading the file in windows of `CUES_READ_WINDOW_BYTES`. Frame payloads are
 * not parsed, only the element and block headers, but they are still read: the
 * pass costs about one 1 MiB `slice()` per MiB of file (a 56 MB take is about
 * 56 reads), rather than one per block. It notes each video keyframe (a
 * SimpleBlock with the keyframe flag, or a BlockGroup with no ReferenceBlock)
 * and replaces the Cues element where the library left it with one CuePoint per
 * keyframe. Nothing else is re-encoded or rewritten: the clusters, alpha
 * included, are the input's own bytes, handed on as a `slice()` of it.
 *
 * What it relies on, all of it `makeMetadataSeekable`'s fixed output shape:
 * the Segment is written with unknown size (so growing the Cues element needs
 * no Segment size rewritten), the Cues element sits ahead of the first Cluster
 * (so every Cluster moves by exactly the change in its size), and every SeekHead
 * entry points at or ahead of the Cues element (so none of them moves — the
 * Cues entry itself still points at its start). Each of the three is checked,
 * and a file that breaks one is refused rather than given positions that are
 * silently wrong; so is a video file in which no keyframe is found, which would
 * otherwise be stored with the empty index this step exists to replace.
 */

const ID = {
  SEEK_HEAD: 0x114d9b74,
  SEEK_POSITION: 0x53ac,
  TRACKS: 0x1654ae6b,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  CUES: 0x1c53bb6b,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  REFERENCE_BLOCK: 0xfb,
} as const

/** Matroska TrackType for video. */
const VIDEO_TRACK_TYPE = 1
/** The SimpleBlock flags bit that marks a keyframe. */
const KEYFRAME_FLAG = 0x80

/** How much of the file one read brings in. A frame payload is skipped, not read. */
export const CUES_READ_WINDOW_BYTES = 1 << 20

/** Longest element header: a 4-byte ID and an 8-byte size. */
const HEADER_BYTES = 12
/** Longest block header the walk reads: an 8-byte track vint, timecode, flags. */
const BLOCK_HEADER_BYTES = 11

interface EbmlElement {
  id: number
  dataStart: number
  /** `Infinity` for an element written with unknown size. */
  end: number
}

interface Keyframe {
  time: number
  track: number
  /** Absolute offset of the Cluster holding it, in the input. */
  clusterStart: number
  /** Offset of its block element from the Cluster's data start. */
  relativePosition: number
}

interface Block {
  track: number
  rel: number
  flags: number
}

/** A BlockGroup's stand-in until its Block is read: track 0 is never a track. */
const NO_BLOCK: Block = { track: 0, rel: 0, flags: 0 }

/**
 * Reads ranges of a Blob through one sliding window. The walk only ever moves
 * forward — each read starts at or after the one before it — so a read that
 * runs past the window's end is the only one that needs a new window.
 */
class ByteWindow {
  private start = 0
  private data = new Uint8Array(0)
  private readonly blob: Blob
  private readonly windowBytes: number

  constructor(blob: Blob, windowBytes: number) {
    this.blob = blob
    this.windowBytes = windowBytes
  }

  async at(position: number, length: number): Promise<Uint8Array> {
    if (position + length > this.start + this.data.length) {
      this.start = position
      const end = position + Math.max(length, this.windowBytes)
      this.data = new Uint8Array(await this.blob.slice(position, end).arrayBuffer())
    }
    return this.data.subarray(position - this.start, position - this.start + length)
  }
}

/**
 * The smallest four-byte (level-1) element ID — Cluster, Cues, Tags and the
 * rest of a Segment's children. Every element a Cluster can contain has an ID
 * of two bytes or fewer, so a four-byte one ends an unknown-size Cluster.
 */
const LEVEL_ONE_ID_MIN = 0x10000000

/** Length of an EBML vint from its first byte. */
function vintLength(firstByte: number): number {
  return Math.clz32(firstByte) - 23
}

async function readElement(reader: ByteWindow, position: number): Promise<EbmlElement> {
  const b = await reader.at(position, HEADER_BYTES)
  const idLength = vintLength(b[0])
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + b[k]
  const sizeLength = vintLength(b[idLength])
  if (idLength > 4 || sizeLength > 8) {
    throw new Error(`The WebM has an invalid EBML element header at byte ${position}`)
  }
  const mask = 0xff >> sizeLength
  let size = b[idLength] & mask
  // Every value bit set is the reserved "unknown size" Chrome writes for the
  // Segment and for each Cluster.
  let unknown = size === mask
  for (let k = 1; k < sizeLength; k++) {
    size = size * 256 + b[idLength + k]
    unknown = unknown && b[idLength + k] === 0xff
  }
  const dataStart = position + idLength + sizeLength
  return { id, dataStart, end: unknown ? Infinity : dataStart + size }
}

async function readUint(reader: ByteWindow, element: EbmlElement): Promise<number> {
  let value = 0
  for (const byte of await reader.at(element.dataStart, element.end - element.dataStart)) {
    value = value * 256 + byte
  }
  return value
}

async function readBlock(reader: ByteWindow, position: number): Promise<Block> {
  const b = await reader.at(position, BLOCK_HEADER_BYTES)
  const length = vintLength(b[0])
  let track = b[0] & (0xff >> length)
  for (let k = 1; k < length; k++) track = track * 256 + b[k]
  const rel = (((b[length] << 8) | b[length + 1]) << 16) >> 16
  return { track, rel, flags: b[length + 2] }
}

async function readVideoTracks(reader: ByteWindow, tracks: EbmlElement, into: Set<number>): Promise<void> {
  for (let i = tracks.dataStart; i < tracks.end; ) {
    const entry = await readElement(reader, i)
    let number = 0
    let type = 0
    for (let j = entry.dataStart; j < entry.end; ) {
      const field = await readElement(reader, j)
      if (field.id === ID.TRACK_NUMBER) number = await readUint(reader, field)
      else if (field.id === ID.TRACK_TYPE) type = await readUint(reader, field)
      j = field.end
    }
    if (type === VIDEO_TRACK_TYPE) into.add(number)
    i = entry.end
  }
}

/** The furthest SeekPosition a SeekHead names, relative to the Segment data. */
async function readFurthestSeek(reader: ByteWindow, seekHead: EbmlElement): Promise<number> {
  let furthest = 0
  for (let i = seekHead.dataStart; i < seekHead.end; ) {
    const seek = await readElement(reader, i)
    for (let j = seek.dataStart; j < seek.end; ) {
      const field = await readElement(reader, j)
      if (field.id === ID.SEEK_POSITION) furthest = Math.max(furthest, await readUint(reader, field))
      j = field.end
    }
    i = seek.end
  }
  return furthest
}

/** Walk one Cluster, noting its video keyframes; returns where it ends. */
async function readCluster(
  reader: ByteWindow,
  clusterStart: number,
  cluster: EbmlElement,
  fileEnd: number,
  videoTracks: Set<number>,
  keyframes: Keyframe[]
): Promise<number> {
  let timecode = 0
  let i = cluster.dataStart
  const note = (block: Block, at: number) =>
    keyframes.push({
      time: timecode + block.rel,
      track: block.track,
      clusterStart,
      relativePosition: at - cluster.dataStart,
    })
  while (i < Math.min(cluster.end, fileEnd)) {
    const child = await readElement(reader, i)
    // An unknown-size Cluster ends where the next Segment child begins.
    if (child.id >= LEVEL_ONE_ID_MIN) break
    switch (child.id) {
      case ID.TIMECODE:
        timecode = await readUint(reader, child)
        break
      case ID.SIMPLE_BLOCK: {
        const block = await readBlock(reader, child.dataStart)
        if (videoTracks.has(block.track) && (block.flags & KEYFRAME_FLAG) !== 0) note(block, i)
        break
      }
      case ID.BLOCK_GROUP: {
        let block = NO_BLOCK
        let referenced = false
        for (let j = child.dataStart; j < child.end; ) {
          const part = await readElement(reader, j)
          if (part.id === ID.BLOCK) block = await readBlock(reader, part.dataStart)
          else if (part.id === ID.REFERENCE_BLOCK) referenced = true
          j = part.end
        }
        // A BlockGroup is a keyframe exactly when it references nothing.
        if (!referenced && videoTracks.has(block.track)) note(block, i)
        break
      }
    }
    i = child.end
  }
  return i
}

// --- writing -------------------------------------------------------------------

/** Every field is written at a fixed width, so the element's size is known up front. */
const CUE_POINT_BYTES = 44
const CUES_HEADER_BYTES = 12

function putUintField(out: Uint8Array, at: number, id: number, value: number): void {
  out[at] = id
  out[at + 1] = 0x88 // an 8-byte payload
  new DataView(out.buffer).setBigUint64(at + 2, BigInt(value))
}

function encodeCues(
  keyframes: Keyframe[],
  clusterPosition: (k: Keyframe) => number
): Uint8Array<ArrayBuffer> {
  const payloadBytes = keyframes.length * CUE_POINT_BYTES
  const out = new Uint8Array(CUES_HEADER_BYTES + payloadBytes)
  const view = new DataView(out.buffer)
  view.setUint32(0, ID.CUES)
  // An 8-byte size vint: the 0x01 length marker, then the size in 7 bytes.
  view.setBigUint64(4, (1n << 56n) | BigInt(payloadBytes))
  keyframes.forEach((k, n) => {
    const at = CUES_HEADER_BYTES + n * CUE_POINT_BYTES
    out[at] = 0xbb // CuePoint
    out[at + 1] = 0x80 | (CUE_POINT_BYTES - 2)
    putUintField(out, at + 2, 0xb3, k.time) // CueTime
    out[at + 12] = 0xb7 // CueTrackPositions
    out[at + 13] = 0x80 | 30
    putUintField(out, at + 14, 0xf7, k.track) // CueTrack
    putUintField(out, at + 24, 0xf1, clusterPosition(k)) // CueClusterPosition
    putUintField(out, at + 34, 0xf0, k.relativePosition) // CueRelativePosition
  })
  return out
}

/**
 * Replace the Cues element of a `webm-duration-fix`-repaired WebM with one that
 * indexes every video keyframe. A file with no video track — an audio-only
 * MediaRecorder take — is handed back as it came: the library's own audio cues
 * are left alone. Throws when a video file has no Cues element to replace,
 * which the library never writes; the save reports that as `NOT_SEEKABLE`.
 */
export async function writeKeyframeCues(
  blob: Blob,
  windowBytes: number = CUES_READ_WINDOW_BYTES
): Promise<Blob> {
  const reader = new ByteWindow(blob, windowBytes)
  const ebmlHeader = await readElement(reader, 0)
  const segment = await readElement(reader, ebmlHeader.end)
  const videoTracks = new Set<number>()
  const keyframes: Keyframe[] = []
  let cues: { start: number; end: number } | undefined
  let firstCluster = Infinity
  let furthestSeek = 0

  let position = segment.dataStart
  while (position < blob.size) {
    const element = await readElement(reader, position)
    switch (element.id) {
      case ID.SEEK_HEAD:
        furthestSeek = Math.max(furthestSeek, await readFurthestSeek(reader, element))
        break
      case ID.TRACKS:
        await readVideoTracks(reader, element, videoTracks)
        break
      case ID.CUES:
        cues = { start: position, end: element.end }
        break
      case ID.CLUSTER:
        firstCluster = Math.min(firstCluster, position)
        position = await readCluster(reader, position, element, blob.size, videoTracks, keyframes)
        continue
    }
    position = element.end
  }

  if (videoTracks.size === 0) return blob
  if (!cues) throw new Error('The repaired WebM has no Cues element to index its keyframes into')
  // The layout the positions below are computed for (see the header comment).
  if (segment.end !== Infinity) {
    throw new Error('The repaired WebM\'s Segment has a known size, which this repair does not rewrite')
  }
  if (firstCluster < cues.start) {
    throw new Error('The repaired WebM has a Cluster ahead of its Cues element')
  }
  if (segment.dataStart + furthestSeek > cues.start) {
    throw new Error('The repaired WebM has a SeekHead entry past its Cues element')
  }
  if (keyframes.length === 0) {
    throw new Error('The repaired WebM has a video track but no video keyframe to index')
  }

  const { start, end } = cues
  const grownBy = CUES_HEADER_BYTES + keyframes.length * CUE_POINT_BYTES - (end - start)
  const encoded = encodeCues(keyframes, (k) => k.clusterStart - segment.dataStart + grownBy)
  return new Blob([blob.slice(0, start), encoded, blob.slice(end)], { type: blob.type })
}
