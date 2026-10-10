// ESCSUITE-254: the decode worker has never decoded a frame. mp4box parses an
// in-memory file *inside* appendBuffer() and fires onReady from it, so
// extraction armed only after appendBuffer returned saw no samples at all:
// every source threw "No keyframes found in video" and every MP4 export fell
// back to in-page decoding. These cases run the worker's demux against real
// MP4 bytes (src/test/fixtures/media/README.md says how each was made), which
// is the only way to see that ordering.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demuxVideoTrack, presentationStart, rotationFromMatrix } from './mp4Demux'

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media')

/** A fixture's bytes as an ArrayBuffer of their own (the demuxer writes `fileStart` onto it). */
function fixture(name: string): ArrayBuffer {
  return toArrayBuffer(readFileSync(resolve(MEDIA, name)))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Presentation timestamps of a demuxed track, in presentation order. */
function presentationOrder(samples: { timestampUs: number }[]): number[] {
  return samples.map((sample) => sample.timestampUs).sort((a, b) => a - b)
}

describe('demuxVideoTrack', () => {
  it('extracts every sample of the video track, keyframe included', async () => {
    // h264-bframes.mp4 is apps/e2e/fixtures/headless/source.mp4: 25 frames of
    // 64x48 H.264 High with B-frames, one IDR.
    const video = await demuxVideoTrack(fixture('h264-bframes.mp4'))

    expect(video.samples).toHaveLength(25)
    expect(video.keyframeCount).toBe(1)
  })

  it('describes the track the way VideoDecoder needs it', async () => {
    const video = await demuxVideoTrack(fixture('h264-bframes.mp4'))

    expect(video).toMatchObject({
      codec: 'avc1.64000a',
      codedWidth: 64,
      codedHeight: 48,
      displayWidth: 64,
      displayHeight: 48,
      rotation: 0,
      duration: 1,
    })
    // The avcC record without its 8-byte box header: configurationVersion 1,
    // then the profile (100, High) and level (10) the codec string names.
    expect(Array.from(video.description!.subarray(0, 4))).toEqual([1, 100, 0, 10])
  })

  it('keeps decode order and applies the edit list, so the first frame shown is at 0', async () => {
    const { samples } = await demuxVideoTrack(fixture('h264-bframes.mp4'))

    // Decode order: the IDR first, then a P frame from further on that the
    // B-frames before it reference.
    expect(samples[0]).toMatchObject({ isKeyframe: true, timestampUs: 0 })
    expect(samples[1].timestampUs).toBeGreaterThan(samples[2].timestampUs)
    // The file's composition times start at 1024/12800 s; its edit list
    // starts presentation there. 25 fps, so every 40 ms from 0.
    expect(presentationOrder(samples)).toEqual(Array.from({ length: 25 }, (_, i) => i * 40_000))
    expect(samples.every((sample) => sample.durationUs === 40_000)).toBe(true)
    expect(samples[0].data.byteLength).toBeGreaterThan(0)
  })

  it('reads a file whose moov box comes before its mdat the same way', async () => {
    const video = await demuxVideoTrack(fixture('h264-faststart.mp4'))

    expect(video.samples).toHaveLength(25)
    expect(presentationOrder(video.samples)).toEqual(Array.from({ length: 25 }, (_, i) => i * 40_000))
  })

  it("reads a rotated track's display matrix and reports the size it is shown at", async () => {
    // Coded 320x180; the display matrix stands it up as 180x320.
    const video = await demuxVideoTrack(fixture('h264-rotated.mp4'))

    expect(video).toMatchObject({
      rotation: 270,
      codedWidth: 320,
      codedHeight: 180,
      displayWidth: 180,
      displayHeight: 320,
    })
  })

  // Fix rounds 1 (M1) and 2: where the decoder's colour comes from. The
  // VideoDecoder sees only the bitstream, so whether a stream is "tagged" is
  // decided by its SPS VUI; a colour description carried only in the colr
  // box is handed to the decoder explicitly; and the size guess is left for
  // a stream that describes its colour nowhere in full. Measured in Chromium
  // 153 against <video> (see decoderConfig.ts).
  describe("reads the stream's own colour description", () => {
    const rec = (standard: string) => ({ primaries: standard, transfer: standard, matrix: standard, fullRange: false })

    it('a stream with no colour description is unspecified', async () => {
      const { colour } = await demuxVideoTrack(fixture('h264-bframes.mp4'))

      expect(colour).toEqual({ kind: 'unspecified' })
    })

    it('a stream whose VUI gives primaries, transfer and matrix keeps them in the bitstream', async () => {
      const { colour } = await demuxVideoTrack(fixture('h264-tagged709-480p.mp4'))

      expect(colour).toEqual({ kind: 'bitstream' })
    })

    it('a stream that signals full range alone is unspecified, and full range', async () => {
      const { colour } = await demuxVideoTrack(fixture('h264-fullrange-480p.mp4'))

      expect(colour).toEqual({ kind: 'unspecified', fullRange: true })
    })

    it('a stream that tags only its matrix is unspecified', async () => {
      // primaries and transfer 'unspecified' (2), matrix BT.709: Chromium's
      // <video> draws this with its size-based guess, so the worker must too.
      const { colour } = await demuxVideoTrack(fixture('h264-partial-tag.mp4'))

      expect(colour).toEqual({ kind: 'unspecified', fullRange: false })
    })

    it('a colr box that agrees with a fully tagged bitstream changes nothing', async () => {
      const { colour } = await demuxVideoTrack(fixture('h264-colr.mp4'))

      expect(colour).toEqual({ kind: 'bitstream' })
    })

    it('a colour description carried only in the colr box is handed to the decoder', async () => {
      // ffmpeg -c copy with -color_* and +write_colr over an untagged stream:
      // colr nclx 6/6/6 (BT.601) or 1/1/1 (BT.709), VUI untagged.
      expect((await demuxVideoTrack(fixture('h264-colr-only-601.mp4'))).colour).toEqual({
        kind: 'container',
        colorSpace: rec('smpte170m'),
      })
      expect((await demuxVideoTrack(fixture('h264-colr-only-709.mp4'))).colour).toEqual({
        kind: 'container',
        colorSpace: rec('bt709'),
      })
    })
  })

  describe('refuses, by name, what it cannot present the way <video> does', () => {
    // Fix round 1, MD3: H.264 is the only codec compared against <video>,
    // and the codec is known in onReady — so anything else is refused there,
    // before a single sample is copied, rather than after the whole file was.
    it('a codec other than H.264, before extracting anything', async () => {
      await expect(demuxVideoTrack(fixture('hevc.mp4'))).rejects.toThrow(
        /^Only H\.264 is decoded in the worker; hvc1\.[^ ]+ needs the <video> path$/
      )
      await expect(demuxVideoTrack(fixture('vp9.mp4'))).rejects.toThrow(
        'Only H.264 is decoded in the worker; vp09.00.10.08 needs the <video> path'
      )
    })

    it('a fragmented file', async () => {
      await expect(demuxVideoTrack(fixture('h264-fragmented.mp4'))).rejects.toThrow(
        'Fragmented MP4 is not decoded in the worker'
      )
    })

    it('a file with no video track', async () => {
      await expect(demuxVideoTrack(fixture('audio-only.mp4'))).rejects.toThrow('No video tracks found in file')
    })

    it('bytes that are not an MP4 at all', async () => {
      const garbage = new Uint8Array(1000).map((_, i) => (i * 37) % 256)

      await expect(demuxVideoTrack(toArrayBuffer(garbage))).rejects.toThrow(/^MP4 parsing error: /)
    })

    it('a file cut off before its moov box', async () => {
      const truncated = new Uint8Array(fixture('h264-bframes.mp4')).subarray(0, 1100)

      await expect(demuxVideoTrack(toArrayBuffer(truncated))).rejects.toThrow(
        'MP4 parsing incomplete: no movie header (moov box) found'
      )
    })

    it('a file cut off inside its samples, naming the counts rather than hanging', async () => {
      // moov first, so the track is known; the mdat stops short.
      const truncated = new Uint8Array(fixture('h264-faststart.mp4')).subarray(0, 1500)

      await expect(demuxVideoTrack(toArrayBuffer(truncated), { timeoutMs: 20 })).rejects.toThrow(
        'MP4 demux incomplete: extracted 0 of 25 video samples within 20ms'
      )
    })

    // Fix round 1, MD1: <video> draws a non-square pixel wider or narrower;
    // whether a VideoDecoder's frame does was never measured, so the worker
    // refuses it rather than guess.
    it('a stream whose VUI gives a non-square sample aspect ratio', async () => {
      await expect(demuxVideoTrack(fixture('h264-sar4x3.mp4'))).rejects.toThrow(
        'Non-square pixels are not decoded in the worker; the <video> path draws this source'
      )
    })

    // Fix round 2: which of two disagreeing descriptions <video> follows is
    // not something the worker should guess at.
    it('a colr box that disagrees with the colour description in the bitstream', async () => {
      const refusal = 'The colr box and the H.264 stream describe its colour differently; the <video> path draws this source'
      // colr 6/6/6 over a VUI tagging 1/1/1...
      await expect(demuxVideoTrack(fixture('h264-colr-disagrees.mp4'))).rejects.toThrow(refusal)
      // ...and over a VUI tagging only its matrix (2/2/1).
      await expect(demuxVideoTrack(fixture('h264-partial-tag-colr-disagrees.mp4'))).rejects.toThrow(refusal)
    })

    it('a track whose first sample is not a keyframe', async () => {
      // Point the sync-sample table's one entry at sample 2 instead of 1.
      const bytes = new Uint8Array(fixture('h264-bframes.mp4'))
      const view = new DataView(bytes.buffer)
      const stss = Buffer.from(bytes).indexOf('stss')
      expect(view.getUint32(stss + 8)).toBe(1) // entry_count
      expect(view.getUint32(stss + 12)).toBe(1) // sample_number
      view.setUint32(stss + 12, 2)

      await expect(demuxVideoTrack(bytes.buffer)).rejects.toThrow('MP4 video track does not start with a keyframe')
    })
  })
})

describe('rotationFromMatrix', () => {
  const ONE = 0x10000
  const matrix = (a: number, b: number, c: number, d: number) => [a, b, 0, c, d, 0, 0, 0, 0x40000000]

  it('reads the four right-angle rotations, clockwise', () => {
    expect(rotationFromMatrix(matrix(ONE, 0, 0, ONE))).toBe(0)
    expect(rotationFromMatrix(matrix(0, ONE, -ONE, 0))).toBe(90)
    expect(rotationFromMatrix(matrix(-ONE, 0, 0, -ONE))).toBe(180)
    expect(rotationFromMatrix(matrix(0, -ONE, ONE, 0))).toBe(270)
  })

  it('reads negative entries stored unsigned', () => {
    expect(rotationFromMatrix(new Uint32Array(matrix(0, -ONE, ONE, 0)))).toBe(270)
  })

  it('refuses a mirror and a scale', () => {
    expect(() => rotationFromMatrix(matrix(-ONE, 0, 0, ONE))).toThrow(
      'Unsupported display matrix [-65536,0,0,65536]: only the four right-angle rotations are decoded in the worker'
    )
    expect(() => rotationFromMatrix(matrix(2 * ONE, 0, 0, 2 * ONE))).toThrow(/^Unsupported display matrix/)
  })
})

describe('presentationStart', () => {
  const edit = (media_time: number, media_rate_integer = 1) => ({ segment_duration: 1000, media_time, media_rate_integer })

  it('is 0 without an edit list', () => {
    expect(presentationStart(undefined)).toBe(0)
    expect(presentationStart([])).toBe(0)
  })

  it("is a single plain edit's media time", () => {
    expect(presentationStart([edit(1024)])).toBe(1024)
  })

  it('refuses more than one edit, an empty edit and a rate other than 1', () => {
    const refusal = 'Unsupported MP4 edit list: only a single plain edit is decoded in the worker'
    expect(() => presentationStart([edit(0), edit(1024)])).toThrow(refusal)
    expect(() => presentationStart([edit(-1)])).toThrow(refusal)
    expect(() => presentationStart([edit(0, 2)])).toThrow(refusal)
  })
})
