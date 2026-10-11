// ESCSUITE-284: Firefox 155's VP9 and VP8 `VideoEncoder`s convert a canvas
// frame with the BT.601 matrix but report `decoderConfig.colorSpace.matrix:
// 'bt709'`. Mediabunny copies that report into two places — the WebM Colour
// element, which Chromium's `<video>` reads, and (VP9 only, its
// `fixVP9ColorSpace`) every keyframe header's `color_space`, which Firefox's
// `<video>` and ffmpeg read — so correcting the report once corrects both.
//
// The byte half of this file runs the **real** mediabunny muxer, not the
// double, over keyframe headers taken from a Firefox 155 export
// (ESCSUITE-279's `percolour.mp4` fixture at 1920x1080): it pins that the
// header's colour field really is written from the report (Firefox's own
// header carries 0, "unknown"), so a mediabunny upgrade that stopped doing it
// would turn this red rather than silently re-break Firefox and ffmpeg.
import { describe, it, expect } from 'vitest'
import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { relabelFirefoxVpxMeta } from './vpxColorLabel'

/** What Firefox 155 reports for both VP9 and VP8 (measured 2026-10-11). */
const FIREFOX_REPORT: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
}

const metaWith = (codec: string, colorSpace?: VideoColorSpaceInit): EncodedVideoChunkMetadata => ({
  decoderConfig: { codec, codedWidth: 1920, codedHeight: 1080, ...(colorSpace ? { colorSpace } : {}) },
})

describe('relabelFirefoxVpxMeta', () => {
  it('relabels the matrix BT.601 (smpte170m) and leaves primaries, transfer and range alone', () => {
    const meta = metaWith('vp09.00.10.08', FIREFOX_REPORT)
    expect(relabelFirefoxVpxMeta(meta)?.decoderConfig?.colorSpace).toEqual({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'smpte170m',
      fullRange: false,
    })
  })

  it('keeps the rest of the decoder configuration and does not mutate what the encoder handed over', () => {
    const meta = metaWith('vp8', FIREFOX_REPORT)
    const out = relabelFirefoxVpxMeta(meta)
    expect(out?.decoderConfig).toMatchObject({ codec: 'vp8', codedWidth: 1920, codedHeight: 1080 })
    expect(meta.decoderConfig?.colorSpace?.matrix).toBe('bt709')
    expect(out).not.toBe(meta)
  })

  it('passes a chunk with no decoder configuration through untouched (every delta chunk)', () => {
    const delta: EncodedVideoChunkMetadata = {}
    expect(relabelFirefoxVpxMeta(delta)).toBe(delta)
    expect(relabelFirefoxVpxMeta(undefined)).toBeUndefined()
  })

  it('leaves any other report alone: only the measured mislabel is corrected', () => {
    const corrected = metaWith('vp8', { ...FIREFOX_REPORT, matrix: 'smpte170m' })
    const unlabelled = metaWith('vp8')
    expect(relabelFirefoxVpxMeta(corrected)).toBe(corrected)
    expect(relabelFirefoxVpxMeta(unlabelled)).toBe(unlabelled)
  })
})

// --- the real muxer over byte fixtures -------------------------------------

/** First 24 bytes of a Firefox 155 VP9 keyframe, `color_space` = 0 as Firefox writes it. */
const FIREFOX_VP9_KEYFRAME = Uint8Array.from([
  0x82, 0x49, 0x83, 0x42, 0x00, 0x77, 0xf0, 0x43, 0x76, 0x00, 0x38, 0x24,
  0x1c, 0x18, 0x50, 0x18, 0x00, 0x58, 0x67, 0xd8, 0xc1, 0xa0, 0x75, 0xed,
])
/** First 24 bytes of a Firefox 155 VP8 keyframe. */
const FIREFOX_VP8_KEYFRAME = Uint8Array.from([
  0x50, 0xba, 0x01, 0x9d, 0x01, 0x2a, 0x80, 0x07, 0x38, 0x04, 0x01, 0x07,
  0x08, 0x85, 0x85, 0x88, 0x85, 0x84, 0x88, 0x06, 0x02, 0x03, 0x15, 0x35,
])

async function mux(
  codec: 'vp9' | 'vp8',
  keyframe: Uint8Array,
  meta: EncodedVideoChunkMetadata | undefined
): Promise<Uint8Array> {
  const target = new BufferTarget()
  const output = new Output({ format: new WebMOutputFormat(), target })
  const source = new EncodedVideoPacketSource(codec)
  output.addVideoTrack(source, { frameRate: 30 })
  await output.start()
  // Two keyframes: the header field has to be right on every one, not just the first.
  await source.add(new EncodedPacket(keyframe.slice(), 'key', 0, 1 / 30), meta)
  await source.add(new EncodedPacket(keyframe.slice(), 'key', 1 / 30, 1 / 30))
  await output.finalize()
  return new Uint8Array(target.buffer!)
}

/** The 1-byte value of a WebM Colour child element (MatrixCoefficients 0x55B1 etc.). */
function colourValue(bytes: Uint8Array, id: number): number | null {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === id >> 8 && bytes[i + 1] === (id & 0xff) && bytes[i + 2] === 0x81) return bytes[i + 3]
  }
  return null
}

/** `color_space` of every VP9 keyframe header in the file (the 3 bits after the sync code). */
function vp9HeaderColourSpaces(bytes: Uint8Array): number[] {
  const found: number[] = []
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0x82 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x83 && bytes[i + 3] === 0x42) {
      found.push(bytes[i + 4] >> 5)
    }
  }
  return found
}

const MATRIX = 0x55b1
const TRANSFER = 0x55ba
const PRIMARIES = 0x55bb
const RANGE = 0x55b9

describe('what mediabunny writes from the report (real muxer, Firefox keyframe bytes)', () => {
  it('as Firefox reports it: BT.709 in the Colour element and in every VP9 keyframe header', async () => {
    const bytes = await mux('vp9', FIREFOX_VP9_KEYFRAME, metaWith('vp09.00.10.08', FIREFOX_REPORT))
    expect(colourValue(bytes, MATRIX)).toBe(1)
    // 2 = CS_BT_709 — written by mediabunny, not by Firefox, whose own header says 0.
    expect(vp9HeaderColourSpaces(bytes)).toEqual([2, 2])
  })

  it('relabelled: BT.601 in the Colour element and in every VP9 keyframe header, primaries and transfer kept', async () => {
    const bytes = await mux(
      'vp9',
      FIREFOX_VP9_KEYFRAME,
      relabelFirefoxVpxMeta(metaWith('vp09.00.10.08', FIREFOX_REPORT))
    )
    expect(colourValue(bytes, MATRIX)).toBe(6)
    expect(colourValue(bytes, PRIMARIES)).toBe(1)
    expect(colourValue(bytes, TRANSFER)).toBe(1)
    expect(colourValue(bytes, RANGE)).toBe(1)
    // 3 = CS_SMPTE_170, the BT.601 matrix.
    expect(vp9HeaderColourSpaces(bytes)).toEqual([3, 3])
  })

  it('relabelled VP8: BT.601 in the Colour element, the frame bytes untouched (VP8 has no matrix field)', async () => {
    const bytes = await mux('vp8', FIREFOX_VP8_KEYFRAME, relabelFirefoxVpxMeta(metaWith('vp8', FIREFOX_REPORT)))
    expect(colourValue(bytes, MATRIX)).toBe(6)
    const at = bytes.findIndex(
      (_, i) => bytes[i] === 0x9d && bytes[i + 1] === 0x01 && bytes[i + 2] === 0x2a
    )
    expect(Array.from(bytes.subarray(at - 3, at - 3 + FIREFOX_VP8_KEYFRAME.length))).toEqual(
      Array.from(FIREFOX_VP8_KEYFRAME)
    )
  })
})
