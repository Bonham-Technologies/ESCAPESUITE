/**
 * A WebM's video blocks, Clusters and Cues, read in Node from its bytes
 * (ESCSUITE-417). Enough to ask the two questions a seekable ESCAPECRAFT take
 * has to answer yes to: does every video frame have a timecode of its own, and
 * does every key frame open its Cluster's video with a cue pointing at it?
 *
 * SimpleBlocks only, which is everything Mediabunny writes; Clusters of known
 * size or of unknown size (a Cluster then runs until the next one starts).
 */

const SEGMENT = 0x18538067
const TRACKS = 0x1654ae6b
const CLUSTER = 0x1f43b675
const CUES = 0x1c53bb6b

export interface VideoBlock {
  /** Its timecode, in the Segment's timecode units (milliseconds for Mediabunny). */
  time: number
  key: boolean
  /** The Cluster it is in, as an index into `clusterPositions`. */
  cluster: number
  /** Whether it is the first video block of its Cluster. */
  firstInCluster: boolean
}

export interface WebmLayout {
  videoTrack: number
  videoBlocks: VideoBlock[]
  /** Each Cluster's offset from the Segment's data, as a CueClusterPosition counts it. */
  clusterPositions: number[]
  /** Every CuePoint's track positions: its time, track and Cluster. */
  cues: Array<{ time: number; track: number; clusterPosition: number }>
}

export function readWebmLayout(bytes: Uint8Array): WebmLayout {
  const vintLength = (byte: number) => Math.clz32(byte) - 23
  const element = (at: number) => {
    const idLength = vintLength(bytes[at])
    let id = 0
    for (let k = 0; k < idLength; k++) id = id * 256 + bytes[at + k]
    const sizeAt = at + idLength
    const sizeLength = vintLength(bytes[sizeAt])
    const mask = 0xff >> sizeLength
    let size = bytes[sizeAt] & mask
    let unknown = size === mask
    for (let k = 1; k < sizeLength; k++) {
      size = size * 256 + bytes[sizeAt + k]
      unknown = unknown && bytes[sizeAt + k] === 0xff
    }
    const dataStart = sizeAt + sizeLength
    return { id, start: at, dataStart, end: unknown ? bytes.length : dataStart + size, unknown }
  }
  const uint = (e: { dataStart: number; end: number }) => {
    let v = 0
    for (let k = e.dataStart; k < e.end; k++) v = v * 256 + bytes[k]
    return v
  }
  const children = (e: { dataStart: number; end: number }) => {
    const out: Array<ReturnType<typeof element>> = []
    for (let at = e.dataStart; at < Math.min(e.end, bytes.length); ) {
      const child = element(at)
      out.push(child)
      at = child.end
    }
    return out
  }

  const segment = element(element(0).end)
  if (segment.id !== SEGMENT) throw new Error('Not a WebM: no Segment after the EBML header')
  const layout: WebmLayout = { videoTrack: 0, videoBlocks: [], clusterPositions: [], cues: [] }

  for (let at = segment.dataStart; at < bytes.length; ) {
    const e = element(at)
    if (e.id === TRACKS) {
      for (const entry of children(e)) {
        const fields = children(entry)
        const number = fields.find((f) => f.id === 0xd7)
        const type = fields.find((f) => f.id === 0x83)
        if (number && type && uint(type) === 1) layout.videoTrack = uint(number)
      }
    } else if (e.id === CUES) {
      for (const point of children(e)) {
        const fields = children(point)
        const time = uint(fields.find((f) => f.id === 0xb3)!)
        for (const positions of fields.filter((f) => f.id === 0xb7)) {
          const field = (id: number) => children(positions).find((f) => f.id === id)
          layout.cues.push({ time, track: uint(field(0xf7)!), clusterPosition: uint(field(0xf1)!) })
        }
      }
    } else if (e.id === CLUSTER) {
      const cluster = layout.clusterPositions.length
      layout.clusterPositions.push(e.start - segment.dataStart)
      let timecode = 0
      let sawVideo = false
      let i = e.dataStart
      while (i < Math.min(e.end, bytes.length)) {
        const child = element(i)
        if (child.id === CLUSTER) break
        if (child.id === 0xe7) timecode = uint(child)
        if (child.id === 0xa3) {
          const length = vintLength(bytes[child.dataStart])
          let track = bytes[child.dataStart] & (0xff >> length)
          for (let k = 1; k < length; k++) track = track * 256 + bytes[child.dataStart + k]
          const head = child.dataStart + length
          const relative = (((bytes[head] << 8) | bytes[head + 1]) << 16) >> 16
          if (track === layout.videoTrack) {
            layout.videoBlocks.push({
              time: timecode + relative,
              key: (bytes[head + 2] & 0x80) !== 0,
              cluster,
              firstInCluster: !sawVideo,
            })
            sawVideo = true
          }
        }
        i = child.end
      }
      at = i
      continue
    }
    at = e.end
  }
  return layout
}

/**
 * What is wrong with a take's video, in words: frames that share a timecode
 * with the frame before them, and key frames that do not open their
 * Cluster's video or have no cue. Empty when there is nothing.
 */
export function videoLayoutProblems(layout: WebmLayout): string[] {
  const problems: string[] = []
  const blocks = layout.videoBlocks
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].time <= blocks[i - 1].time) {
      problems.push(
        `the ${blocks[i].key ? 'key' : 'delta'} frame at ${blocks[i].time} ms has the timecode of the frame before it`
      )
    }
  }
  for (const block of blocks.filter((b) => b.key)) {
    if (!block.firstInCluster) problems.push(`the key frame at ${block.time} ms sits mid-Cluster`)
    const position = layout.clusterPositions[block.cluster]
    const cued = layout.cues.some(
      (c) => c.track === layout.videoTrack && c.time === block.time && c.clusterPosition === position
    )
    if (!cued) problems.push(`the key frame at ${block.time} ms has no cue`)
  }
  return problems
}
