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
  /** Sample counts per onSamples call. */
  batches: [2] as number[],
}))

vi.mock('mp4box', () => {
  class DataStream {
    static BIG_ENDIAN = false
    buffer = new ArrayBuffer(8)
  }
  return {
    DataStream,
    createFile: () => {
      const file = {
        onReady: undefined as undefined | ((info: unknown) => void),
        onSamples: undefined as undefined | ((id: number, user: unknown, samples: unknown[]) => void),
        onError: undefined as undefined | ((error: string) => void),
        getTrackById: () => ({
          mdia: { minf: { stbl: { stsd: { entries: Array.from({ length: script.entries }, () => ({ type: 'vp09', colr: script.colr, pasp: script.pasp })) } } } },
        }),
        setExtractionOptions: vi.fn(),
        start: vi.fn(),
        flush: vi.fn(),
        appendBuffer: () => {
          const total = script.batches.reduce((sum, count) => sum + count, 0)
          const track: ScriptedTrack = {
            id: 1,
            codec: 'vp09.00.10.08',
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

  // Fix round 1, M1: the colr shapes no ffmpeg fixture here produces.
  describe('colour from a colr box', () => {
    it("reads an 'nclc' box's code points, with no range", async () => {
      script.colr = { colour_type: 'nclc', colour_primaries: 1, transfer_characteristics: 1, matrix_coefficients: 1 }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ fullyTagged: true })
    })

    it("reads an 'nclx' box's full-range flag", async () => {
      script.colr = {
        colour_type: 'nclx',
        colour_primaries: 1,
        transfer_characteristics: 2,
        matrix_coefficients: 1,
        full_range_flag: 1,
      }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ fullyTagged: false, fullRange: true })
    })

    it('does not count a missing code point as specified', async () => {
      script.colr = { colour_type: 'nclc', colour_primaries: 1, matrix_coefficients: 1 }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ fullyTagged: false })
    })

    it('ignores an ICC-profile colr box', async () => {
      script.colr = { colour_type: 'prof' }

      expect((await demuxVideoTrack(new ArrayBuffer(8))).colour).toEqual({ fullyTagged: false })
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
})
