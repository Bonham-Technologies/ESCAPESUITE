// Seek index repair at import (ESCSUITE-305).
//
// Firefox cannot seek a WebM with no Cues index into a Cluster that does not
// start with a key frame, and every composited-PiP take ESCAPECRAFT has stored
// carries an empty one (`1c53bb6b 80`). These cases pin the two halves: the
// probe that decides from the file's head whether a WebM needs an index, and
// the packet-copy remux that writes one — through the **real** mediabunny, over
// hand-built files, so an upgrade that dropped side data or stopped writing
// Cues would turn this red.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlobSource, EncodedPacketSink, Input, WEBM } from 'mediabunny'
import { isWebmType, needsSeekIndexRepair, remuxWithSeekIndex, withSeekIndex } from './webmSeekIndex'
import { alphaFrames, buildWebm, hasNonEmptyCues, webmBlob } from '../test/fixtures/webmFixture'

/** The first offset of `id` in `bytes`. */
function indexOf(bytes: Uint8Array, id: number[]): number {
  for (let i = 0; i + id.length <= bytes.length; i++) {
    if (id.every((b, j) => bytes[i + j] === b)) return i
  }
  throw new Error('id not found')
}

const SEEK_HEAD = [0x11, 0x4d, 0x9b, 0x74]
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75]

/** Every packet of every track, as the demuxer reads them back. */
async function packetsOf(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] })
  try {
    const tracks = []
    for (const track of await input.getTracks()) {
      const packets = []
      for await (const packet of new EncodedPacketSink(track).packets()) {
        packets.push({
          timestamp: packet.timestamp,
          type: packet.type,
          data: [...packet.data],
          alpha: packet.sideData.alpha ? [...packet.sideData.alpha] : null,
        })
      }
      tracks.push({
        codec: track.codec,
        transparent: track.isVideoTrack() ? await track.canBeTransparent() : null,
        packets,
      })
    }
    return tracks
  } finally {
    input.dispose()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isWebmType', () => {
  it.each([
    ['video/webm', true],
    ['audio/webm', true],
    ['video/webm;codecs=vp9,opus', true],
    ['VIDEO/WEBM; codecs=vp8', true],
    ['video/mp4', false],
    ['video/webmx', false],
    ['', false],
  ])('%j → %s', (type, expected) => {
    expect(isWebmType(type)).toBe(expected)
  })
})

describe('needsSeekIndexRepair', () => {
  it('leaves a WebM whose SeekHead points at a Cues index with cue points in it', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'indexed' }))).toBe(false)
  })

  it('leaves a WebM whose Cues index it meets before the media, with no SeekHead entry for it', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'indexed', seekHeadToCues: false }))).toBe(false)
  })

  it('repairs the empty Cues element ESCAPECRAFT stores, found through the SeekHead', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'empty' }))).toBe(true)
  })

  it('repairs an empty Cues element it meets before the media', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'empty', seekHeadToCues: false }))).toBe(true)
  })

  it('repairs a WebM with no Cues at all, as a live recorder writes it', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'none' }))).toBe(true)
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'none', unknownSizes: true }))).toBe(true)
  })

  it('reads past a Void element inside the SeekHead', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'indexed', seekHeadVoid: true }))).toBe(false)
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'empty', seekHeadVoid: true }))).toBe(true)
  })

  it('trusts the SeekHead: a Cues position that lands on another element needs repair', async () => {
    // Position 0 is the SeekHead itself. The walk would have found a good index.
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'indexed', cuesSeekPosition: 0 }))).toBe(true)
  })

  it('trusts the SeekHead: a Cues position past the end of the file needs repair', async () => {
    expect(await needsSeekIndexRepair(webmBlob({ cues: 'indexed', cuesSeekPosition: 0x7fffffff }))).toBe(true)
  })

  it('walks on to the elements themselves when the SeekHead cannot be read', async () => {
    const bytes = buildWebm({ cues: 'indexed' })
    // The SeekHead's first child id becomes a zero byte, which no EBML id is.
    bytes[indexOf(bytes, SEEK_HEAD) + 5] = 0x00

    expect(await needsSeekIndexRepair(new Blob([bytes as BlobPart]))).toBe(false)
  })

  it('leaves alone anything it cannot read as a WebM', async () => {
    const empty = new Blob([])
    const junk = new Blob(['not a webm at all'])
    const zero = new Blob([new Uint8Array([0, 0, 0, 0])])
    const idOnly = new Blob([new Uint8Array([0x1a, 0x45, 0xdf])])
    const idNoSize = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])])
    const bytes = buildWebm({ cues: 'none' })
    const ebmlOnly = new Blob([bytes.slice(0, indexOf(bytes, [0x18, 0x53, 0x80, 0x67])) as BlobPart])
    // Cut just before the first Cluster: nothing tells it whether an index follows.
    const headOnly = new Blob([bytes.slice(0, indexOf(bytes, CLUSTER)) as BlobPart])

    for (const blob of [empty, junk, zero, idOnly, idNoSize, ebmlOnly, headOnly]) {
      expect(await needsSeekIndexRepair(blob)).toBe(false)
    }
  })
})

describe('remuxWithSeekIndex', () => {
  it('writes a Cues index the probe accepts, keeping the MIME type', async () => {
    const original = webmBlob({ cues: 'empty' }, 'video/webm;codecs=vp9')

    const remuxed = await remuxWithSeekIndex(original)

    expect(hasNonEmptyCues(new Uint8Array(await remuxed.arrayBuffer()))).toBe(true)
    expect(await needsSeekIndexRepair(remuxed)).toBe(false)
    expect(remuxed.type).toBe('video/webm;codecs=vp9')
  })

  it('keeps every packet of every track: count, timestamp, key flag and bytes', async () => {
    const original = webmBlob({ cues: 'none', unknownSizes: true, audio: true, frames: alphaFrames(30, 7) })

    const before = await packetsOf(original)
    const after = await packetsOf(await remuxWithSeekIndex(original))

    expect(before.map((t) => [t.codec, t.packets.length])).toEqual([
      ['vp9', 30],
      ['opus', 50],
    ])
    expect(after).toEqual(before)
  })

  // Rule 3's alpha question: Chrome writes a composited-PiP frame as a
  // BlockGroup whose BlockAdditions carry the VP9 alpha plane. mediabunny reads
  // that as `sideData.alpha` and writes it back as BlockAdditions (BlockAddID 1)
  // on a track it marks AlphaMode 1, so the remux keeps the transparency.
  it('keeps the alpha plane every BlockGroup carries, and the track stays transparent', async () => {
    const frames = alphaFrames(12, 5)
    const original = webmBlob({ cues: 'empty', alphaMode: true, frames })

    const before = await packetsOf(original)
    const after = await packetsOf(await remuxWithSeekIndex(original))

    expect(before[0].transparent).toBe(true)
    expect(before[0].packets.map((p) => p.alpha)).toEqual(frames.map((f) => [...f.alpha!]))
    expect(after).toEqual(before)
  })

  it('throws on a track it cannot name a codec for', async () => {
    await expect(remuxWithSeekIndex(webmBlob({ cues: 'empty', videoCodecId: 'V_NOT_A_CODEC' }))).rejects.toThrow()
  })
})

describe('withSeekIndex', () => {
  it('never reads a file that is not a WebM', async () => {
    const blob = webmBlob({ cues: 'empty' }, 'video/mp4')
    const slice = vi.spyOn(blob, 'slice')

    expect(await withSeekIndex(blob, 'clip.mp4')).toBe(blob)
    expect(slice).not.toHaveBeenCalled()
  })

  it('hands back the very same blob when the WebM already has an index', async () => {
    const blob = webmBlob({ cues: 'indexed' })

    expect(await withSeekIndex(blob, 'take.webm')).toBe(blob)
  })

  it('hands back a remuxed copy when the WebM has no usable index', async () => {
    const blob = webmBlob({ cues: 'empty' }, 'audio/webm')

    const repaired = await withSeekIndex(blob, 'take.webm')

    expect(repaired).not.toBe(blob)
    expect(repaired.type).toBe('audio/webm')
    expect(await needsSeekIndexRepair(repaired)).toBe(false)
  })

  it('keeps the original, and says so once, when the probe cannot read the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blob = webmBlob({ cues: 'empty' })
    vi.spyOn(blob, 'slice').mockImplementation(
      () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }) as unknown as Blob
    )

    expect(await withSeekIndex(blob, 'take.webm')).toBe(blob)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Could not add a seek index to "take.webm"; keeping it as recorded:', expect.any(Error))
  })

  it('keeps the original, and says so once, when the remux fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blob = webmBlob({ cues: 'empty', videoCodecId: 'V_NOT_A_CODEC' })

    expect(await withSeekIndex(blob, 'odd.webm')).toBe(blob)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
