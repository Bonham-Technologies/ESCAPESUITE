// The export mixer's streamed decode (ESCSUITE-367): each source's audio read a
// chunk at a time through mediabunny and mixed as it arrives, so neither the
// file nor its decoded track is ever held whole.
//
// mediabunny reads PCM without WebCodecs, so in jsdom a float WAV is decoded
// for real, bit for bit. Each case mixes the same channels twice — streamed,
// from a WAV, and through the whole-file `decodeAudioData` fallback, from bytes
// no demuxer recognises with the OfflineAudioContext double handing back the
// same channels — and the two must agree exactly: the streamed path places
// every sample where the old path did.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioSample, AudioSampleSink, Input, InputAudioTrack } from 'mediabunny'
import { extractAndMixAudio, SourceAudioError } from './audioMixer'
import { storeVideo } from './storage'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import { makeAnimation, makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import { floatWav } from '../test/fixtures/wavFixture'
import type { Clip } from '../store/types'

const SAMPLE_RATE = 48000
/** 0.1 s of timeline. */
const TOTAL_DURATION = 0.1

function signal(length: number, phase: number): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = Math.sin(i * 0.031 + phase) * 0.3
  return out
}

const left = signal(4800, 0)
const right = signal(4800, 1.3)

async function store(id: string, bytes: BlobPart, name = id): Promise<void> {
  const blob = new Blob([bytes], { type: 'audio/wav' })
  await storeVideo(id, blob, { ...makeSourceVideo({ id, name }), size: blob.size })
}

/** The same clips mixed streamed (from `wav`) and whole-file (from unreadable bytes). */
async function bothWays(
  clips: Clip[],
  range?: { start: number; end: number },
  channels: Float32Array[] = [left, right],
  rate = SAMPLE_RATE
) {
  await store('wav', floatWav(channels, rate))
  await store('opaque', new Uint8Array(64))
  const streamed = await extractAndMixAudio(clips.map((c) => ({ ...c, sourceVideoId: 'wav' })), [makeTrack()], TOTAL_DURATION, vi.fn(), range)
  const whole = await extractAndMixAudio(clips.map((c) => ({ ...c, sourceVideoId: 'opaque' })), [makeTrack()], TOTAL_DURATION, vi.fn(), range)
  return { streamed, whole }
}

describe('extractAndMixAudio, streamed', () => {
  let offline: OfflineAudioContextDoubles

  beforeEach(() => {
    offline = installOfflineAudioContextDouble(() => createAudioBufferDouble([left, right], SAMPLE_RATE))
  })

  afterEach(() => {
    offline.uninstall()
    vi.restoreAllMocks()
  })

  it('places every sample where the whole-file decode does, without decodeAudioData', async () => {
    const clips = [
      makeClip({ id: 'a', timelinePosition: 0.002, startTime: 0.001, duration: 0.03, endTime: 0.031 }),
      makeClip({ id: 'b', timelinePosition: 0.05, startTime: 0.04, duration: 0.04, endTime: 0.08 }),
    ]

    const { streamed, whole } = await bothWays(clips)

    // Only the fallback's decode: the WAV never reached decodeAudioData.
    expect(offline.decodeCalls).toHaveLength(1)
    expect(streamed).not.toBeNull()
    expect(streamed!.map((c) => Array.from(c))).toEqual(whole!.map((c) => Array.from(c)))
    expect(streamed![0][Math.floor(0.002 * SAMPLE_RATE) + 10]).toBe(left[48 + 10])
  })

  it('agrees on a range, volume keyframes and a track volume', async () => {
    const clips = [
      makeClip({
        id: 'a',
        timelinePosition: 0.01,
        startTime: 0.02,
        duration: 0.06,
        endTime: 0.08,
        animation: makeAnimation({
          keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 0.06, value: 1, easing: 'linear' }] },
        }),
      }),
    ]

    const { streamed, whole } = await bothWays(clips, { start: 0.03, end: 0.065 })

    expect(streamed!.map((c) => Array.from(c))).toEqual(whole!.map((c) => Array.from(c)))
  })

  it('copies a mono track into both channels, as the whole-file decode does', async () => {
    offline.decode = () => createAudioBufferDouble([left], SAMPLE_RATE)
    const clips = [makeClip({ duration: 0.05, endTime: 0.05 })]

    const { streamed, whole } = await bothWays(clips, undefined, [left])

    expect(streamed!.map((c) => Array.from(c))).toEqual(whole!.map((c) => Array.from(c)))
    expect(Array.from(streamed![1].subarray(0, 2400))).toEqual(Array.from(streamed![0].subarray(0, 2400)))
  })

  it('decodes each source once, and stops after the last frame any clip reads', async () => {
    const samples = vi.spyOn(AudioSampleSink.prototype, 'samples')
    const closed: number[] = []
    const close = vi.spyOn(AudioSample.prototype, 'close').mockImplementation(function (this: AudioSample) {
      closed.push(this.timestamp)
    })
    // Ten seconds of source; the clips read only its first 0.03 s.
    await store('long', floatWav([signal(480_000, 0), signal(480_000, 1)]))
    const clips = [
      makeClip({ id: 'a', sourceVideoId: 'long', duration: 0.01, endTime: 0.01 }),
      makeClip({ id: 'b', sourceVideoId: 'long', timelinePosition: 0.05, startTime: 0.02, duration: 0.01, endTime: 0.03 }),
    ]

    await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(samples).toHaveBeenCalledTimes(1)
    expect(Math.max(...closed)).toBeLessThan(1)
    close.mockRestore()
  })

  it('reads a source whose clips all lie outside the range as audio, without decoding it', async () => {
    const samples = vi.spyOn(AudioSampleSink.prototype, 'samples')
    await store('wav', floatWav([left, right]))
    const clips = [makeClip({ sourceVideoId: 'wav', timelinePosition: 0.08, duration: 0.01, endTime: 0.01 })]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn(), { start: 0, end: 0.01 })

    expect(mixed).not.toBeNull()
    expect(samples).not.toHaveBeenCalled()
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('drops the priming frames a track places before zero, as decodeAudioData does', async () => {
    const planar = (values: number[], timestamp: number) =>
      new AudioSample({ data: Float32Array.from(values), format: 'f32-planar', numberOfChannels: 1, sampleRate: SAMPLE_RATE, timestamp })
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield planar([0.9, 0.9], -2 / SAMPLE_RATE)
      yield planar([0.9, 0.5, -0.25], -1 / SAMPLE_RATE)
      yield planar([0.125, -0.875], 2 / SAMPLE_RATE)
    })
    await store('wav', floatWav([left]))
    const clips = [makeClip({ sourceVideoId: 'wav', duration: 0.01, endTime: 0.01 })]

    const mixed = (await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()))!

    expect(Array.from(mixed[0].subarray(0, 5))).toEqual([0.5, -0.25, 0.125, -0.875, 0])
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('falls back to the whole-file decode for a track not at 48 kHz, which decodeAudioData resamples', async () => {
    const clips = [makeClip({ sourceVideoId: 'wav', duration: 0.05, endTime: 0.05 })]
    await store('wav', floatWav([left, right], 44100))

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(offline.decodeCalls).toHaveLength(1)
    expect(mixed![0][10]).toBe(left[10])
  })

  it('falls back to the whole-file decode when the decode fails before anything was mixed', async () => {
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield* []
      throw new Error('decoder error')
    })
    await store('wav', floatWav([left, right]))
    const clips = [makeClip({ sourceVideoId: 'wav', duration: 0.05, endTime: 0.05 })]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(offline.decodeCalls).toHaveLength(1)
    expect(mixed![0][10]).toBe(left[10])
  })

  it('fails the export by name when the decode fails part-way, rather than export half the sound', async () => {
    const real = AudioSampleSink.prototype.samples
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* (this: AudioSampleSink) {
      let n = 0
      for await (const sample of real.call(this)) {
        if (n++ === 1) {
          sample.close()
          throw new Error('decoder error')
        }
        yield sample
      }
    })
    await store('wav', floatWav([signal(96_000, 0), signal(96_000, 1)]), 'Keynote take')
    const clips = [makeClip({ name: 'Keynote take', sourceVideoId: 'wav', duration: 0.1, endTime: 0.1 })]

    const error = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SourceAudioError)
    expect((error as Error).message).toMatch(/^Could not read the sound of Keynote take: .*decoder error/)
    expect(offline.decodeCalls).toHaveLength(0)
  })

  it('falls back to the whole-file decode when asking for a decoder throws', async () => {
    vi.spyOn(InputAudioTrack.prototype, 'canDecode').mockRejectedValue(new Error('no AudioDecoder'))
    await store('wav', floatWav([left, right]))
    const clips = [makeClip({ sourceVideoId: 'wav', duration: 0.05, endTime: 0.05 })]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(offline.decodeCalls).toHaveLength(1)
    expect(mixed![0][10]).toBe(left[10])
  })

  it('answers a container with no audio track as no audio, with no decode', async () => {
    vi.spyOn(Input.prototype, 'getPrimaryAudioTrack').mockResolvedValue(null)
    await store('wav', floatWav([left, right]))
    const clips = [makeClip({ sourceVideoId: 'wav', duration: 0.05, endTime: 0.05 })]

    const mixed = await extractAndMixAudio(clips, [makeTrack()], TOTAL_DURATION, vi.fn())

    expect(mixed).toBeNull()
    expect(offline.decodeCalls).toHaveLength(0)
  })
})
