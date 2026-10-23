// The audio mixer decodes each clip's source, mixes it into planar stereo (one
// array per channel) over the exported range, and normalises the result.
// Everything here runs the real mixing loop against real IndexedDB
// (fake-indexeddb) and the real keyframe interpolator; only the browser API
// jsdom lacks — OfflineAudioContext — is a double. These sources are bytes no
// demuxer recognises, so they take the whole-file `decodeAudioData` fallback;
// the streamed path is covered by `audioMixer.streamed.test.ts`.
//
// This used to also cover `extractAndMixAudioWithWorker`, a Web Worker fast
// path with a main-thread fallback. ESCSUITE-99 deleted it: the worker's own
// mixer never applied volume keyframes, and its support probe always resolved
// `false` in real Chromium (it tests for `OfflineAudioContext` *inside* the
// worker, which is `[Exposed=Window]` and absent there), so the worker path
// never ran in production. `extractAndMixAudio` — exercised below — is now the
// export pipeline's only mixer, and the "applies volume keyframes per sample"
// case below is the guarantee the worker used to threaten.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Input } from 'mediabunny'
import { extractAndMixAudio, SourceAudioError, WHOLE_FILE_DECODE_MAX_BYTES } from './audioMixer'
import { storeVideo } from './storage'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type AudioBufferDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import {
  makeAnimation,
  makeClip,
  makeSourceVideo,
  makeTrack,
} from '../test/fixtures/clipFixtures'
import type { Clip } from '../store/types'

const SAMPLE_RATE = 48000
/** 480 samples of timeline — small enough to assert on sample by sample. */
const TOTAL_DURATION = 0.01

function ramp(length: number, sign = 1): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = (sign * (i + 1)) / 1000
  return data
}

/** A ramp loud enough that a few stacked copies exceed full scale. */
function loudRamp(length: number): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = (i + 1) / 250
  return data
}

/** Store a source video whose blob is `bytes` bytes long, so decodes can be told apart. */
async function storeSource(id: string, bytes: number): Promise<void> {
  await storeVideo(id, new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), {
    ...makeSourceVideo({ id }),
    size: bytes,
  })
}

describe('extractAndMixAudio', () => {
  let offline: OfflineAudioContextDoubles
  let stereo: AudioBufferDouble
  let warn: ReturnType<typeof vi.spyOn>
  let patchedBlobRead: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(async () => {
    patchedBlobRead = null
    stereo = createAudioBufferDouble([ramp(480), ramp(480, -1)], SAMPLE_RATE)
    offline = installOfflineAudioContextDouble(() => stereo)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await storeSource('video1', 16)
  })

  afterEach(() => {
    // Restore here, not at the end of the test body: a failing assertion must
    // not leave the patched prototype behind for the next test.
    patchedBlobRead?.mockRestore()
    offline.uninstall()
    warn.mockRestore()
  })

  it('sizes the output channels from the timeline duration, and the decode context to one frame', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(offline.constructions).toEqual([
      // Only decodeAudioData is used: a context the length of a long range
      // could itself fail to allocate (ESCSUITE-367).
      { numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE },
    ])
    expect(mixed).not.toBeNull()
    // Planar stereo (ESCSUITE-367): one array per channel, one frame per sample.
    expect(mixed!.map((channel) => channel.length)).toEqual([480, 480])
  })

  it('writes the clip at its timeline position, reading from its trim start', async () => {
    // 0.002s in on the timeline (sample 96), starting 0.001s into the source
    // (sample 48), for 0.005s (240 samples).
    const clip = makeClip({
      timelinePosition: 0.002,
      startTime: 0.001,
      duration: 0.005,
      endTime: 0.006,
    })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[0][95]).toBe(0) // before the clip: silence
    expect(mixed[0][96]).toBeCloseTo(stereo.getChannelData(0)[48], 6)
    expect(mixed[1][96]).toBeCloseTo(stereo.getChannelData(1)[48], 6)
    expect(mixed[0][200]).toBeCloseTo(stereo.getChannelData(0)[152], 6)
    expect(mixed[0][335]).toBeCloseTo(stereo.getChannelData(0)[287], 6)
    expect(mixed[0][336]).toBe(0) // one past the last mixed sample
  })

  it('scales every sample by the track volume', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const full = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!
    const half = (await extractAndMixAudio(
      [clip],
      [makeTrack({ volume: 0.5 })],
      TOTAL_DURATION,
      vi.fn()
    ))!

    expect(half[0][10]).toBeCloseTo(full[0][10] * 0.5, 6)
    expect(half[1][10]).toBeCloseTo(full[1][10] * 0.5, 6)
  })

  it('treats a track with no volume set as full volume', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })
    const track = makeTrack()
    delete (track as Partial<typeof track>).volume

    const mixed = (await extractAndMixAudio([clip], [track], TOTAL_DURATION, vi.fn()))!

    expect(mixed[0][10]).toBeCloseTo(stereo.getChannelData(0)[10], 6)
  })

  it('skips a muted track entirely, without decoding its source', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio(
      [clip],
      [makeTrack({ muted: true })],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('skips a clip whose track is missing entirely, without decoding its source', async () => {
    const clip = makeClip({ trackId: 'gone', duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  // ESCSUITE-127: the preview is the truth — a hidden track is silent there
  // (`getClipsAtTime` filters on `track.visible`), so an export must agree
  // rather than mixing in audio nothing in the editor played.
  it('skips a clip on a hidden track entirely, without decoding its source', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio(
      [clip],
      [makeTrack({ visible: false, muted: false })],
      TOTAL_DURATION,
      vi.fn()
    )

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('copies a mono source into both channels', async () => {
    offline.decode = () => createAudioBufferDouble([ramp(480)], SAMPLE_RATE)
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[0][10]).toBeCloseTo(0.011, 6)
    expect(mixed[1][10]).toBeCloseTo(mixed[0][10], 6)
  })

  it('applies volume keyframes per sample on top of the track volume', async () => {
    const clip: Clip = makeClip({
      duration: 0.005,
      endTime: 0.005,
      animation: makeAnimation({
        keyframes: {
          volume: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 0.005, value: 1, easing: 'linear' },
          ],
        },
      }),
    })

    const mixed = (await extractAndMixAudio(
      [clip],
      [makeTrack({ volume: 0.5 })],
      TOTAL_DURATION,
      vi.fn()
    ))!

    const source = stereo.getChannelData(0)
    expect(mixed[0][0]).toBeCloseTo(0, 6) // ramp starts at volume 0
    // Half way through the clip (sample 120 of 240) the keyframe ramp is at 0.5,
    // and the track is at 0.5 on top of that.
    expect(mixed[0][120]).toBeCloseTo(source[120] * 0.5 * 0.5, 5)
    expect(mixed[0][239]).toBeCloseTo(source[239] * 0.5 * (239 / 240), 5)
  })

  it('sums overlapping clips and normalises the peak back under 1', async () => {
    await storeSource('video2', 32)
    // Each ramp peaks at 0.96, so four stacked copies clip well past 1.
    const loud = createAudioBufferDouble([loudRamp(480), loudRamp(480)], SAMPLE_RATE)
    offline.decode = () => loud
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'c', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'd', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
    ]

    const mixed = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()))!

    const peak = Math.max(...mixed.flatMap((channel) => Array.from(channel, Math.abs)))
    expect(peak).toBeCloseTo(0.95, 5)
    // Normalisation is a single uniform scale, so the shape is preserved.
    expect(mixed[0][10] / mixed[0][20]).toBeCloseTo(
      loud.getChannelData(0)[10] / loud.getChannelData(0)[20],
      5
    )
  })

  it('leaves audio that never exceeds 1 untouched', async () => {
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed[0][239]).toBeCloseTo(stereo.getChannelData(0)[239], 6)
  })

  it('drops samples that fall outside the timeline buffer', async () => {
    const clip = makeClip({ timelinePosition: 0.02, duration: 0.005, endTime: 0.005 })

    const mixed = (await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(mixed.every((channel) => channel.every((s) => s === 0))).toBe(true)
  })

  it('returns null when no clip yielded decodable audio', async () => {
    offline.decode = () => null
    const clip = makeClip({ duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(1)
  })

  it('skips a clip whose source is not in storage', async () => {
    const clip = makeClip({ sourceVideoId: 'missing', duration: 0.005, endTime: 0.005 })

    const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('warns and carries on when reading one source fails', async () => {
    await storeSource('video2', 32)
    // Every read of the 16-byte source fails, the streamed path's and the
    // whole-file path's alike; the 32-byte one reads.
    patchedBlobRead = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      return this.size === 16 ? Promise.reject(new Error('read failed')) : Promise.resolve(new ArrayBuffer(this.size))
    })
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
    ]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(warn).toHaveBeenCalledWith(
      'Failed to extract audio from source:',
      expect.objectContaining({ message: 'read failed' })
    )
    // The second source still made it into the mix.
    expect(mixed).not.toBeNull()
    expect(mixed![0][10]).toBeCloseTo(stereo.getChannelData(0)[10], 6)
  })

  it('reports progress once per source, ending at 100', async () => {
    await storeSource('video2', 32)
    const onProgress = vi.fn()
    const clips = [
      makeClip({ id: 'a', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'b', sourceVideoId: 'video2', duration: 0.005, endTime: 0.005 }),
      makeClip({ id: 'c', duration: 0.005, endTime: 0.005 }),
    ]

    await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, onProgress)

    expect(onProgress.mock.calls.map((c) => Math.round(c[0]))).toEqual([50, 100])
  })

  // ESCSUITE-367: a source cut into many clips was decoded once per clip, each
  // time holding the whole file and its whole decoded track.
  it('decodes a source once however many clips use it', async () => {
    const clips = [
      makeClip({ id: 'a', duration: 0.001, endTime: 0.001 }),
      makeClip({ id: 'b', timelinePosition: 0.003, startTime: 0.002, duration: 0.001, endTime: 0.003 }),
      makeClip({ id: 'c', timelinePosition: 0.006, startTime: 0.004, duration: 0.002, endTime: 0.006 }),
    ]

    const mixed = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(offline.decodeCalls).toHaveLength(1)
    const source = stereo.getChannelData(0)
    expect(mixed[0][0]).toBeCloseTo(source[0], 6) // a
    expect(mixed[0][144]).toBeCloseTo(source[96], 6) // b: timeline 0.003 reads source 0.002
    expect(mixed[0][288 + 50]).toBeCloseTo(source[192 + 50], 6) // c
  })

  // ESCSUITE-367: the whole timeline used to be mixed and then sliced, so a
  // few seconds of a two-hour recording asked for one 2.76 GB buffer.
  describe('a range', () => {
    const clips = [
      makeClip({ id: 'a', timelinePosition: 0.002, startTime: 0.001, duration: 0.005, endTime: 0.006 }),
      makeClip({ id: 'b', timelinePosition: 0.006, duration: 0.003, endTime: 0.003 }),
    ]

    it('mixes only the range, exactly the samples the whole mix sliced the old way gives', async () => {
      const whole = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()))!
      const range = { start: 0.004, end: 0.0075 }

      const part = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn(), range))!

      const from = Math.floor(range.start * SAMPLE_RATE)
      const to = Math.floor(range.end * SAMPLE_RATE)
      expect(part.map((channel) => channel.length)).toEqual([to - from, to - from])
      expect(part.map((channel) => Array.from(channel))).toEqual(
        whole.map((channel) => Array.from(channel.slice(from, to)))
      )
    })

    it('stops at the end of the timeline when the range runs past it', async () => {
      const part = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn(), { start: 0.008, end: 0.02 }))!

      expect(part[0].length).toBe(480 - 384)
    })

    it('is still not null when its clips lie outside it but the timeline has sound', async () => {
      const part = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn(), { start: 0, end: 0.001 })

      expect(part).not.toBeNull()
      expect(part!.every((channel) => channel.every((s) => s === 0))).toBe(true)
    })
  })

  // ESCSUITE-367: a source over 2 GiB cannot be read into one buffer, and the
  // failed read used to be taken for "no audio" — the export went out silent.
  it('refuses, by name, a source too large for the whole-file decode that the streamed path cannot read', async () => {
    // No demuxer reads it (an MP3, or a container mediabunny does not know),
    // and it is over the one-buffer limit.
    const demux = vi.spyOn(Input.prototype, 'getPrimaryAudioTrack').mockRejectedValue(new Error('unknown format'))
    const size = vi.spyOn(Blob.prototype, 'size', 'get').mockReturnValue(WHOLE_FILE_DECODE_MAX_BYTES + 1)
    try {
      const clip = makeClip({ name: 'Two hour take', duration: 0.005, endTime: 0.005 })

      const error = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn()).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(SourceAudioError)
      expect((error as Error).message).toMatch(/^Could not read the sound of Two hour take: /)
      expect(offline.decodeCalls).toHaveLength(0)
    } finally {
      size.mockRestore()
      demux.mockRestore()
    }
  })

  it('leaves unread a source too large for the whole-file decode whose clips all miss the range', async () => {
    const demux = vi.spyOn(Input.prototype, 'getPrimaryAudioTrack').mockRejectedValue(new Error('unknown format'))
    const size = vi.spyOn(Blob.prototype, 'size', 'get').mockReturnValue(WHOLE_FILE_DECODE_MAX_BYTES + 1)
    try {
      const clip = makeClip({ timelinePosition: 0.008, duration: 0.001, endTime: 0.001 })

      const mixed = await extractAndMixAudio([clip], [makeTrack()], TOTAL_DURATION, vi.fn(), { start: 0, end: 0.002 })

      expect(mixed).toBeNull()
      expect(offline.decodeCalls).toHaveLength(0)
    } finally {
      size.mockRestore()
      demux.mockRestore()
    }
  })

  it('returns null for a timeline with no samples, without building a context or buffer (ESCSUITE-257)', async () => {
    const clip = makeClip({ duration: 0, endTime: 0 })

    await expect(extractAndMixAudio([clip], [makeTrack()], 0, vi.fn())).resolves.toBeNull()
    await expect(extractAndMixAudio([clip], [makeTrack()], -2, vi.fn())).resolves.toBeNull()

    expect(offline.constructions).toHaveLength(0)
    expect(offline.decodeCalls).toHaveLength(0)
  })
})
