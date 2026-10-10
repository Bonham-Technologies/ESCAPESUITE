// mp4Demux.test.ts drives the demuxer with real MP4 bytes. Two of its guards
// are about shapes no fixture here produces, so this file scripts mp4box
// instead: a track with two sample descriptions (a spliced file, whose second
// half would be decoded with the first half's configuration), and samples
// delivered in more than one batch (the demuxer waits for the track's whole
// sample count, not the first delivery).
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ScriptedTrack {
  id: number
  codec: string
  nb_samples: number
  matrix: number[]
  video: { width: number; height: number }
}

const script = vi.hoisted(() => ({
  entries: 1,
  /** The sample entry's colr box, if any. */
  colr: undefined as undefined | Record<string, unknown>,
  /** The sample entry's pasp box, if any. */
  pasp: undefined as undefined | { hSpacing: number; vSpacing: number },
  /** An H.264 sample entry with no avcC record. */
  noAvcC: false,
  /** Sample counts per onSamples call. */
  batches: [2] as number[],
}))

vi.mock('mp4box', () => {
  class DataStream {
    static BIG_ENDIAN = false
    buffer = new ArrayBuffer(8)
  }
  /**
   * An avcC record (behind an 8-byte box header) carrying one baseline SPS
   * with no VUI: square pixels, no colour description in the bitstream.
   */
  const avcC = {
    write(stream: DataStream) {
      stream.buffer = Uint8Array.of(
        0, 0, 0, 26, 0x61, 0x76, 0x63, 0x43,
        1, 66, 0, 31, 0xff, 0xe1, 0, 9, 0x67, 66, 0, 31, 0xda, 0x02, 0x80, 0xf6, 0x40, 0
      ).buffer
    },
  }
  return {
    DataStream,
    createFile: () => {
      const file = {
        onReady: undefined as undefined | ((info: unknown) => void),
        onSamples: undefined as undefined | ((id: number, user: unknown, samples: unknown[]) => void),
        onError: undefined as undefined | ((error: string) => void),
        getTrackById: () => ({
          mdia: { minf: { stbl: { stsd: { entries: Array.from({ length: script.entries }, () => ({
            type: 'avc1',
            avcC: script.noAvcC ? undefined : avcC,
            colr: script.colr,
            pasp: script.pasp,
          })) } } } },
        }),
        setExtractionOptions: vi.fn(),
        start: vi.fn(),
        flush: vi.fn(),
        appendBuffer: () => {
          const total = script.batches.reduce((sum, count) => sum + count, 0)
          const track: ScriptedTrack = {
            id: 1,
            codec: 'avc1.64001f',
            nb_samples: total,
            matrix: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
            video: { width: 64, height: 48 },
          }
          file.onReady?.({ duration: 1000, timescale: 1000, isFragmented: false, videoTracks: [track] })
          // Like mp4box, deliver nothing unless extraction was armed.
          if (file.setExtractionOptions.mock.calls.length === 0) return
          let number = 0
          for (const count of script.batches) {
            file.onSamples?.(
              1,
              null,
              Array.from({ length: count }, () => ({
                number: number++,
                cts: number * 100,
                duration: 100,
                timescale: 1000,
                is_sync: number === 1,
                data: new Uint8Array(4),
              }))
            )
          }
        },
      }
      return file
    },
  }
})

import { demuxVideoTrack } from './mp4Demux'

beforeEach(() => {
  script.noAvcC = false
  script.colr = undefined
  script.pasp = undefined
  script.entries = 1
  script.batches = [2]
})

describe('demuxVideoTrack (scripted mp4box)', () => {
  it('refuses a track with more than one sample description', async () => {
    script.entries = 2

    await expect(demuxVideoTrack(new ArrayBuffer(8))).rejects.toThrow(
      'MP4 video track has 2 sample descriptions; the worker decodes one'
    )
  })

  it('waits for every batch of samples, not the first', async () => {
    script.batches = [2, 3]

    const video = await demuxVideoTrack(new ArrayBuffer(8), { timeoutMs: 20 })

    expect(video.samples).toHaveLength(5)
  })

  // Fix rounds 1 and 2: the colr shapes no ffmpeg fixture here produces. The
  // scripted SPS has no VUI, so the bitstream describes nothing.
  describe('colour from a colr box over an untagged bitstream', () => {
    it("hands an 'nclc' box's code points to the decoder, limited range", async () => {
      script.colr = { colour_type: 'nclc', colour_primaries: 1, transfer_characteristics: 1, matrix_coefficients: 1 }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({
        kind: 'container',
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      })
    })

    it("hands an 'nclx' box's range over with its code points", async () => {
      script.colr = {
        colour_type: 'nclx',
        colour_primaries: 5,
        transfer_characteristics: 13,
        matrix_coefficients: 0,
        full_range_flag: 1,
      }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({
        kind: 'container',
        colorSpace: { primaries: 'bt470bg', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
      })
    })

    it("keeps an 'nclx' box's range when its code points are not all specified", async () => {
      script.colr = {
        colour_type: 'nclx',
        colour_primaries: 1,
        transfer_characteristics: 2,
        matrix_coefficients: 1,
        full_range_flag: 1,
      }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ kind: 'unspecified', fullRange: true })
    })

    it('does not count a missing code point as specified', async () => {
      script.colr = { colour_type: 'nclc', colour_primaries: 1, matrix_coefficients: 1 }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ kind: 'unspecified' })
    })

    it('ignores an ICC-profile colr box', async () => {
      script.colr = { colour_type: 'prof' }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ kind: 'unspecified' })
    })

    it('refuses code points VideoDecoder has no name for, whichever of the three it is', async () => {
      for (const [primaries, transfer, matrix] of [
        [9, 1, 1],
        [1, 16, 1],
        [1, 1, 9],
      ]) {
        script.colr = {
          colour_type: 'nclc',
          colour_primaries: primaries,
          transfer_characteristics: transfer,
          matrix_coefficients: matrix,
        }

        await expect(demuxVideoTrack(new ArrayBuffer(8))).rejects.toThrow(
          `The colr box describes a colour space VideoDecoder cannot be given (${primaries}/${transfer}/${matrix}); the <video> path draws this source`
        )
      }
    })
  })

  // Fix round 1, MD1: a pasp box saying the pixels are not square.
  it('refuses a pasp box whose spacings differ, and takes one whose spacings agree', async () => {
    script.pasp = { hSpacing: 4, vSpacing: 3 }
    await expect(demuxVideoTrack(new ArrayBuffer(8))).rejects.toThrow(
      'Non-square pixels are not decoded in the worker; the <video> path draws this source'
    )

    script.pasp = { hSpacing: 1, vSpacing: 1 }
    await expect(demuxVideoTrack(new ArrayBuffer(8))).resolves.toMatchObject({ samples: expect.any(Array) })
  })

  it('refuses an H.264 sample description with no avcC record', async () => {
    script.noAvcC = true

    await expect(demuxVideoTrack(new ArrayBuffer(8))).rejects.toThrow('The H.264 sample description has no avcC record')
  })
})
