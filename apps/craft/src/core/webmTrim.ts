/**
 * Cut a WebM that stopped mid-write back to its last whole block
 * (ESCSUITE-466).
 *
 * A take kept on disk while it records (`takeStore.ts`) can end anywhere: a
 * tab that crashed leaves every byte that reached the worker, a power cut
 * leaves what was last flushed, and either can stop inside a block. The two
 * recorders also leave different headers behind:
 *
 * - **MediaRecorder** writes a live stream: an unknown-size Segment and
 *   unknown-size Clusters. Cut anywhere, it only needs its torn tail dropped.
 * - **Mediabunny** (the WebCodecs recorder) writes a file meant to be
 *   finalized: the Segment's size field holds the size of the header alone
 *   until `finalize()` patches it, the Duration is 0, the SeekHead points
 *   nowhere and there are no Cues. Each Cluster is written whole with a known
 *   size, but a flush can still stop inside one.
 *
 * This pass turns both into the shape `fixWebMMetadata()` already repairs
 * every MediaRecorder take from: the EBML header, a Segment of **unknown
 * size** (written with the 8-byte width `webm-duration-fix` assumes), the
 * Segment's header elements as they were, and every Cluster up to the last
 * whole block. A Cluster that was cut short keeps the blocks that are whole
 * and has its size field rewritten, at its own width, to "unknown". Anything
 * after the Clusters (a finalized file's Cues, Tags) is dropped: the repair
 * writes its own. Bytes are handed on as `slice()`s of the input; only the
 * Segment header and a cut Cluster's size field are new.
 *
 * It walks every element header once, reading the file through one forward
 * window as `webmCues.ts` does, and also reports the last block's timestamp,
 * which is the length of what was recorded.
 */

const ID = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
} as const

/** Every element a Cluster holds has an ID of two bytes or fewer. */
const LEVEL_ONE_ID_MIN = 0x10000000
/** Matroska's default TimecodeScale: one tick is a millisecond. */
const DEFAULT_TIMECODE_SCALE_NS = 1_000_000
/** The Segment header the repair expects: its ID and an 8-byte unknown size. */
const UNKNOWN_SIZE_SEGMENT = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

export const TRIM_READ_WINDOW_BYTES = 1 << 20

export interface TrimmedWebM {
  /** The file, cut to its last whole block, with an unknown-size Segment. */
  blob: Blob
  /** Whole blocks kept, on every track. */
  blocks: number
  /** The latest block timestamp kept, in seconds: what was recorded. */
  lastBlockSeconds: number
}

interface Element {
  id: number
  start: number
  dataStart: number
  /** `Infinity` when the size is the reserved "unknown". */
  end: number
  sizeLength: number
}

/** A forward-only window over a Blob that knows where the file ends. */
class Window {
  private start = 0
  private data = new Uint8Array(0)
  private readonly blob: Blob
  private readonly windowBytes: number

  constructor(blob: Blob, windowBytes: number) {
    this.blob = blob
    this.windowBytes = windowBytes
  }

  get size(): number {
    return this.blob.size
  }

  /** `length` bytes at `position`, or null when the file ends first. */
  async at(position: number, length: number): Promise<Uint8Array | null> {
    if (position + length > this.blob.size) return null
    if (position < this.start || position + length > this.start + this.data.length) {
      this.start = position
      const end = Math.min(this.blob.size, position + Math.max(length, this.windowBytes))
      this.data = new Uint8Array(await this.blob.slice(position, end).arrayBuffer())
    }
    return this.data.subarray(position - this.start, position - this.start + length)
  }
}

function vintLength(firstByte: number): number {
  return Math.clz32(firstByte) - 23
}

/** The element header at `position`, or null when it is torn or not a header. */
async function readElement(window: Window, position: number): Promise<Element | null> {
  const first = await window.at(position, 1)
  if (!first) return null
  const idLength = vintLength(first[0])
  if (idLength > 4) return null
  const idBytes = await window.at(position, idLength + 1)
  if (!idBytes) return null
  const sizeLength = vintLength(idBytes[idLength])
  if (sizeLength > 8) return null
  const header = await window.at(position, idLength + sizeLength)
  if (!header) return null
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + header[k]
  const mask = 0xff >> sizeLength
  let size = header[idLength] & mask
  let unknown = size === mask
  for (let k = 1; k < sizeLength; k++) {
    size = size * 256 + header[idLength + k]
    unknown = unknown && header[idLength + k] === 0xff
  }
  const dataStart = position + idLength + sizeLength
  return { id, start: position, dataStart, end: unknown ? Infinity : dataStart + size, sizeLength }
}

async function readUint(window: Window, element: Element): Promise<number> {
  const bytes = (await window.at(element.dataStart, element.end - element.dataStart))!
  let value = 0
  for (const byte of bytes) value = value * 256 + byte
  return value
}

/** A block's timecode, relative to its Cluster. `position` is the block's data. */
async function blockTimecode(window: Window, position: number): Promise<number> {
  const first = (await window.at(position, 1))!
  const trackLength = vintLength(first[0])
  const b = (await window.at(position + trackLength, 2))!
  return (((b[0] << 8) | b[1]) << 16) >> 16
}

/** The unknown-size marker at a given width: every value bit set. */
function unknownSize(width: number): Uint8Array {
  const bytes = new Uint8Array(width).fill(0xff)
  bytes[0] = 0xff >> (width - 1)
  return bytes
}

/**
 * Cut `file` back to its last whole block. Null when it holds no whole block
 * at all — a take that died before its first frame was written, or bytes
 * that are not a WebM.
 */
export async function trimToWholeBlocks(
  file: Blob,
  windowBytes: number = TRIM_READ_WINDOW_BYTES
): Promise<TrimmedWebM | null> {
  const window = new Window(file, windowBytes)
  const header = await readElement(window, 0)
  if (!header || header.id !== ID.EBML || header.end > window.size) return null
  const segment = await readElement(window, header.end)
  if (!segment || segment.id !== ID.SEGMENT) return null

  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS
  let blocks = 0
  let lastBlock = -Infinity
  /** Everything before this is kept. */
  let keepEnd = segment.dataStart
  /** A Cluster cut short, whose size field becomes "unknown". */
  let cutCluster: Element | null = null
  let seenCluster = false

  let position = segment.dataStart
  walk: while (position < window.size) {
    const element = await readElement(window, position)
    if (!element) break
    if (element.id !== ID.CLUSTER) {
      // A header element (Info, Tracks, SeekHead, Void…) before the media is
      // kept whole; one torn there leaves nothing playable. After the media
      // (a finalized file's Cues, Tags) everything is the repair's to write.
      if (seenCluster || element.end > window.size) break
      if (element.id === ID.INFO) {
        for (let p = element.dataStart; p < element.end; ) {
          const field = await readElement(window, p)
          if (!field) break
          if (field.id === ID.TIMECODE_SCALE) timecodeScale = await readUint(window, field)
          p = field.end
        }
      }
      position = element.end
      keepEnd = position
      continue
    }

    seenCluster = true
    let clusterTime = 0
    let p = element.dataStart
    let whole = false
    for (;;) {
      if (p === element.end) {
        whole = true
        break
      }
      const child = await readElement(window, p)
      if (!child) {
        // The file ends here. For an unknown-size Cluster that ends exactly
        // on a block boundary, that is simply the end of the stream.
        whole = element.end === Infinity && p === window.size
        break
      }
      if (child.id >= LEVEL_ONE_ID_MIN) {
        // Only an unknown-size Cluster can run into the next level-1 element.
        whole = element.end === Infinity
        break
      }
      if (child.end > window.size || child.end > element.end) break
      if (child.id === ID.TIMECODE) {
        clusterTime = await readUint(window, child)
      } else if (child.id === ID.SIMPLE_BLOCK) {
        lastBlock = Math.max(lastBlock, clusterTime + (await blockTimecode(window, child.dataStart)))
        blocks++
      } else if (child.id === ID.BLOCK_GROUP) {
        for (let g = child.dataStart; g < child.end; ) {
          const inner = await readElement(window, g)
          if (!inner) break
          if (inner.id === ID.BLOCK) {
            lastBlock = Math.max(lastBlock, clusterTime + (await blockTimecode(window, inner.dataStart)))
            blocks++
          }
          g = inner.end
        }
      }
      p = child.end
      keepEnd = p
    }
    if (!whole) {
      if (element.end !== Infinity && keepEnd > element.dataStart) cutCluster = element
      break walk
    }
    position = p
    keepEnd = p
  }

  if (blocks === 0) return null

  const parts: BlobPart[] = [file.slice(0, segment.start), UNKNOWN_SIZE_SEGMENT]
  if (cutCluster) {
    const sizeAt = cutCluster.dataStart - cutCluster.sizeLength
    parts.push(
      file.slice(segment.dataStart, sizeAt),
      unknownSize(cutCluster.sizeLength) as Uint8Array<ArrayBuffer>,
      file.slice(cutCluster.dataStart, keepEnd)
    )
  } else {
    parts.push(file.slice(segment.dataStart, keepEnd))
  }
  return {
    blob: new Blob(parts, { type: file.type || 'video/webm' }),
    blocks,
    lastBlockSeconds: (lastBlock * timecodeScale) / 1e9,
  }
}
