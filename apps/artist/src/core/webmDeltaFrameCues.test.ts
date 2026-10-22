// Cues on delta frames (ESCSUITE-359).
//
// The import re-index (ESCSUITE-305) copies a take's packets through
// Mediabunny's muxer, which starts a Cluster on a delta frame once one would
// pass 32.767 s and still writes a video cue for it. Chromium trusts the cue as
// a key frame and its preview freezes for good on a far seek. These cases read
// the Cues of the output back byte by byte, with a walker of their own, and
// check every video cue against the key flag of the block it points at.
import { describe, expect, it, vi } from 'vitest'
import { BlobSource, EncodedPacketSink, Input, WEBM } from 'mediabunny'
import { dropDeltaFrameCues } from './webmDeltaFrameCues'
import { needsSeekIndexRepair, remuxWithSeekIndex, withSeekIndex } from './webmSeekIndex'
import { webmBlob, type WebmVideoFrame } from '../test/fixtures/webmFixture'

interface Element {
  id: number
  start: number
  dataStart: number
  end: number
}

function vint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number } {
  const length = Math.clz32(bytes[pos]) - 23
  let value = keepMarker ? bytes[pos] : bytes[pos] & (0xff >> length)
  for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i]
  return { value, length }
}

function at(bytes: Uint8Array, pos: number): Element {
  const id = vint(bytes, pos, true)
  const size = vint(bytes, pos + id.length, false)
  const dataStart = pos + id.length + size.length
  return { id: id.value, start: pos, dataStart, end: dataStart + size.value }
}

function children(bytes: Uint8Array, parent: Element): Element[] {
  const out: Element[] = []
  for (let pos = parent.dataStart; pos < parent.end; ) {
    const child = at(bytes, pos)
    out.push(child)
    pos = child.end
  }
  return out
}

function uintOf(bytes: Uint8Array, element: Element): number {
  let value = 0
  for (let i = element.dataStart; i < element.end; i++) value = value * 256 + bytes[i]
  return value
}

interface Cue {
  time: number
  track: number
  /** Whether the first block of `track` in the Cluster the cue names is a key frame. */
  key: boolean
}

/** Every cue in the file, with the key flag of the block it points at. */
function cuesOf(bytes: Uint8Array): Cue[] {
  const segment = at(bytes, at(bytes, 0).end)
  const top = children(bytes, segment)
  const cues = top.find((e) => e.id === 0x1c53bb6b)
  if (!cues) return []
  return children(bytes, cues).flatMap((point) => {
    const fields = children(bytes, point)
    const time = uintOf(bytes, fields.find((f) => f.id === 0xb3)!)
    return fields
      .filter((f) => f.id === 0xb7)
      .map((positions) => {
        const inner = children(bytes, positions)
        const track = uintOf(bytes, inner.find((f) => f.id === 0xf7)!)
        const cluster = at(bytes, segment.dataStart + uintOf(bytes, inner.find((f) => f.id === 0xf1)!))
        expect(cluster.id).toBe(0x1f43b675)
        for (const block of children(bytes, cluster)) {
          if (block.id === 0xa3 && vint(bytes, block.dataStart, false).value === track) {
            return { time, track, key: (bytes[block.dataStart + 3] & 0x80) !== 0 }
          }
          if (block.id === 0xa0) {
            const parts = children(bytes, block)
            const inner = parts.find((p) => p.id === 0xa1)!
            if (vint(bytes, inner.dataStart, false).value !== track) continue
            return { time, track, key: !parts.some((p) => p.id === 0xfb) }
          }
        }
        throw new Error(`cue at ${time} ms names a cluster with no block of track ${track}`)
      })
  })
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

async function packetsOf(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] })
  try {
    const out = []
    for (const track of await input.getTracks()) {
      for await (const packet of new EncodedPacketSink(track).packets()) {
        out.push([track.id, packet.timestamp, packet.type, [...packet.data]])
      }
    }
    return out
  } finally {
    input.dispose()
  }
}

/** A take `seconds` long at `fps`, with a key frame only every `keyEverySeconds` (MediaRecorder's sparse key frames). */
function sparseFrames(seconds: number, fps: number, keyEverySeconds = Infinity, alpha = false): WebmVideoFrame[] {
  return Array.from({ length: seconds * fps }, (_, i) => ({
    timeMs: Math.round((i * 1000) / fps),
    key: i === 0 || (i / fps) % keyEverySeconds === 0,
    ...(alpha ? { alpha: new Uint8Array(4).fill(i & 0xff) } : {}),
  }))
}

describe('the import re-index (remuxWithSeekIndex)', () => {
  it('writes a video cue only on a Cluster whose first video block is a key frame', async () => {
    const original = webmBlob({ cues: 'none', audio: true, frames: sparseFrames(100, 2) })

    const cues = cuesOf(await bytesOf(await remuxWithSeekIndex(original)))

    const video = cues.filter((c) => c.track === 1)
    expect(video.length).toBeGreaterThan(0)
    expect(video.filter((c) => !c.key)).toEqual([])
    // The Clusters Mediabunny had to force at 32.767 s keep their audio cues.
    expect(cues.filter((c) => c.track === 2 && c.time > 32_000).length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the cues of a take with a key frame in every forced Cluster', async () => {
    const original = webmBlob({ cues: 'none', frames: sparseFrames(100, 2, 10) })

    const video = cuesOf(await bytesOf(await remuxWithSeekIndex(original))).filter((c) => c.track === 1)

    expect(video.every((c) => c.key)).toBe(true)
    expect(video.map((c) => c.time)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000])
  })

  it('drops the cue of a forced Cluster that starts on a BlockGroup delta frame (alpha take)', async () => {
    const original = webmBlob({ cues: 'empty', alphaMode: true, frames: sparseFrames(70, 1, Infinity, true) })

    const remuxed = await remuxWithSeekIndex(original)
    const video = cuesOf(await bytesOf(remuxed)).filter((c) => c.track === 1)

    expect(video).toEqual([{ time: 0, track: 1, key: true }])
    expect(await packetsOf(remuxed)).toEqual(await packetsOf(original))
  })
})

describe('dropDeltaFrameCues on an index already stored', () => {
  // The layout every Cues-less WebM imported between ESCSUITE-305 and -359 was
  // stored with: a Cluster every ~33 s, a video cue on each, a key frame at 0 only.
  const stored = () => webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(100, 1) })

  it('drops every video cue on a delta frame and keeps the one on the key frame', async () => {
    const original = stored()
    expect(cuesOf(await bytesOf(original)).map((c) => c.key)).toEqual([true, false, false, false])

    const repaired = await dropDeltaFrameCues(original)

    expect(repaired).not.toBeNull()
    expect(cuesOf(await bytesOf(repaired!))).toEqual([{ time: 0, track: 1, key: true }])
  })

  it('keeps every other byte where it was: same size, same type, same packets', async () => {
    const original = stored()
    const before = await bytesOf(original)

    const repaired = (await dropDeltaFrameCues(original))!
    const after = await bytesOf(repaired)

    expect(after.length).toBe(before.length)
    expect(repaired.type).toBe(original.type)
    const segment = at(before, at(before, 0).end)
    const cues = children(before, segment).find((e) => e.id === 0x1c53bb6b)!
    expect([...after.subarray(0, cues.start)]).toEqual([...before.subarray(0, cues.start)])
    expect([...after.subarray(cues.end)]).toEqual([...before.subarray(cues.end)])
    // What filled the room the dropped cues held is one Void element.
    const filler = at(after, at(after, cues.start).end)
    expect(filler.id).toBe(0xec)
    expect(filler.end).toBe(cues.end)
    expect(await packetsOf(repaired)).toEqual(await packetsOf(original))
    expect(await needsSeekIndexRepair(repaired)).toBe(false)
  })

  it('is idempotent: a repaired file needs nothing more', async () => {
    const repaired = (await dropDeltaFrameCues(stored()))!

    expect(await dropDeltaFrameCues(repaired)).toBeNull()
  })

  it('leaves a file whose cues are all on key frames alone, without reading any Cluster', async () => {
    const blob = webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(100, 1, 33) })
    const slice = vi.spyOn(blob, 'slice')

    expect(await dropDeltaFrameCues(blob)).toBeNull()
    // Head, Cues header, Cues, then one read per suspect Cluster element.
    expect(slice.mock.calls.length).toBeLessThan(40)
  })

  it('keeps the audio half of a CuePoint whose video half is dropped', async () => {
    const original = webmBlob({ cues: 'indexed', cueAudio: true, audio: true, clusterMs: 33_000, frames: sparseFrames(100, 1) })

    const cues = cuesOf(await bytesOf((await dropDeltaFrameCues(original))!))

    expect(cues.filter((c) => c.track === 1)).toEqual([{ time: 0, track: 1, key: true }])
    expect(cues.filter((c) => c.track === 2).map((c) => c.time)).toEqual([0, 33_000, 66_000, 99_000])
  })

  it('fills a large room with one Void, the size field eight bytes long', async () => {
    const original = webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(600, 1) })
    const before = await bytesOf(original)

    const after = await bytesOf((await dropDeltaFrameCues(original))!)

    const segment = at(after, at(after, 0).end)
    const cues = children(after, segment).find((e) => e.id === 0x1c53bb6b)!
    const filler = at(after, cues.end)
    expect(filler.id).toBe(0xec)
    expect(filler.dataStart - filler.start).toBe(9)
    expect(after.length).toBe(before.length)
    expect(cuesOf(after)).toEqual([{ time: 0, track: 1, key: true }])
  })

  it('reads a stored take whose Segment and Clusters have the unknown size', async () => {
    const original = webmBlob({ cues: 'indexed', unknownSizes: true, clusterMs: 33_000, frames: sparseFrames(100, 1) })

    const repaired = await dropDeltaFrameCues(original)

    expect(repaired).not.toBeNull()
    expect(await packetsOf(repaired!)).toEqual(await packetsOf(original))
  })

  it('reads a stored alpha take, whose blocks are BlockGroups', async () => {
    const original = webmBlob({ cues: 'indexed', alphaMode: true, clusterMs: 33_000, frames: sparseFrames(100, 1, Infinity, true) })

    const repaired = await dropDeltaFrameCues(original)

    expect(cuesOf(await bytesOf(repaired!))).toEqual([{ time: 0, track: 1, key: true }])
  })

  it('keeps a cue whose Cluster it cannot find: only a cue proven wrong is dropped', async () => {
    const bytes = await bytesOf(stored())
    // Point every cue past the first at the SeekHead, which is not a Cluster.
    let seen = 0
    for (let i = 0; i + 6 <= bytes.length; i++) {
      if (bytes[i] === 0xf1 && bytes[i + 1] === 0x84 && seen++ > 0) bytes.fill(0, i + 2, i + 6)
    }

    expect(await dropDeltaFrameCues(new Blob([bytes as BlobPart], { type: 'video/webm' }))).toBeNull()
  })

  // Review round 1: a muxer that indexes key frames itself (ESCAPECRAFT's
  // `writeKeyframeCues`, ffmpeg) can name a key frame inside a Cluster that
  // opens on a delta frame. Such a cue is right, and the repair must not
  // drop it and write the drop back.
  it('leaves a cue that carries a CueRelativePosition alone', async () => {
    const blob = webmBlob({ cues: 'indexed', cueRelativePosition: true, clusterMs: 33_000, frames: sparseFrames(100, 1) })

    expect(await dropDeltaFrameCues(blob)).toBeNull()
  })

  it('leaves a cue alone whose time is not its Cluster\'s first block', async () => {
    // Frames every 10 s, Clusters every 33 s: the cue at 33 s names a Cluster
    // whose first frame is at 40 s, and so on up to 297 s (no frame lands on a
    // Cluster's start before 330 s).
    const blob = webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(300, 0.1) })

    expect(await dropDeltaFrameCues(blob)).toBeNull()
  })

  it('answers null for a file with no video track', async () => {
    const bytes = await bytesOf(stored())
    // TrackType 1 (video) becomes 2 (audio).
    const typeAt = bytes.findIndex((b, i) => b === 0x83 && bytes[i + 1] === 0x81 && bytes[i + 2] === 0x01)
    bytes[typeAt + 2] = 0x02

    expect(await dropDeltaFrameCues(new Blob([bytes as BlobPart], { type: 'audio/webm' }))).toBeNull()
  })

  it('answers null for a file cut short inside its Cues', async () => {
    const bytes = await bytesOf(webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(100, 1) }))
    const segment = at(bytes, at(bytes, 0).end)
    const cues = children(bytes, segment).find((e) => e.id === 0x1c53bb6b)!

    expect(await dropDeltaFrameCues(new Blob([bytes.subarray(0, cues.end - 3) as BlobPart]))).toBeNull()
  })

  it.each([
    ['no Cues', { cues: 'none' as const }],
    ['an empty Cues', { cues: 'empty' as const }],
    ['a short take', { cues: 'indexed' as const }],
  ])('answers null for %s', async (_, options) => {
    expect(await dropDeltaFrameCues(webmBlob(options))).toBeNull()
  })

  it('answers null for bytes that are not a WebM', async () => {
    expect(await dropDeltaFrameCues(new Blob([new Uint8Array(100).fill(7)]))).toBeNull()
    expect(await dropDeltaFrameCues(new Blob([]))).toBeNull()
  })
})

describe('withSeekIndex on a WebM that already has an index', () => {
  it('hands back a copy with the delta-frame cues dropped', async () => {
    const original = webmBlob({ cues: 'indexed', clusterMs: 33_000, frames: sparseFrames(100, 1) }, 'video/webm;codecs=vp9')

    const repaired = await withSeekIndex(original, 'take.webm')

    expect(repaired).not.toBe(original)
    expect(repaired.type).toBe('video/webm;codecs=vp9')
    expect(cuesOf(await bytesOf(repaired)).every((c) => c.key)).toBe(true)
  })
})
