// A sped clip's sound (ESCSUITE-471): resampled with the picture up to 2×, so
// the sound under each frame is the sound recorded with it, and silent above.
// The chunks are doubles laid end to end (Vorbis, so no packet timestamps are
// read); the WAV only gives mediabunny a 48 kHz audio track to open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioSample, AudioSampleSink, InputAudioTrack } from 'mediabunny'
import { extractAndMixAudio, extractSpeechMix } from './audioMixer'
import { storeVideo } from './storage'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import { makeAnimation, makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import { floatWav } from '../test/fixtures/wavFixture'
import { sourceTimeAt } from '../store/clipSpeed'
import type { Clip } from '../store/types'

const SAMPLE_RATE = 48000
/** One decoded chunk. */
const FRAME = 960
/** Source frames the double decodes: half a second. */
const SOURCE_FRAMES = 24000

/** Decode `source(i)` for every source frame `i`, a chunk of `FRAME` at a time. */
function decodeAs(source: (frame: number) => number): void {
  vi.spyOn(InputAudioTrack.prototype, 'getCodec').mockResolvedValue('vorbis' as never)
  vi.spyOn(InputAudioTrack.prototype, 'canDecode').mockResolvedValue(true)
  vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
    for (let start = 0; start < SOURCE_FRAMES; start += FRAME) {
      yield new AudioSample({
        data: Float32Array.from({ length: FRAME }, (_, i) => source(start + i)),
        format: 'f32-planar',
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        timestamp: start / SAMPLE_RATE,
      })
    }
  })
}

/** A clip of the take: `startTime` to `endTime` of source at `speed`, placed at `at`. */
function sped(startTime: number, endTime: number, speed: number, at = 0, extra: Partial<Clip> = {}): Clip {
  return makeClip({ sourceVideoId: 'take', startTime, endTime, duration: (endTime - startTime) / speed, timelinePosition: at, speed, ...extra })
}

async function mix(clip: Clip, length = clip.timelinePosition + clip.duration): Promise<Float32Array | null> {
  const blob = new Blob([floatWav([new Float32Array(4800)], SAMPLE_RATE)], { type: 'audio/wav' })
  await storeVideo('take', blob, { ...makeSourceVideo({ id: 'take', name: 'take' }), size: blob.size })
  const out = await extractAndMixAudio([clip], [makeTrack()], length, vi.fn())
  return out ? out[0] : null
}

/** The frame of the loudest sample. */
function peakFrame(samples: Float32Array): number {
  let at = 0
  for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i]) > Math.abs(samples[at])) at = i
  return at
}

describe('extractAndMixAudio, a sped clip (ESCSUITE-471)', () => {
  let offline: OfflineAudioContextDoubles

  beforeEach(() => {
    offline = installOfflineAudioContextDouble(() => createAudioBufferDouble([new Float32Array(4800)], SAMPLE_RATE))
  })

  afterEach(() => {
    offline.uninstall()
    vi.restoreAllMocks()
  })

  it('reads two source frames per output frame at 2×, over half the length', async () => {
    decodeAs((i) => i * 1e-5)
    const out = (await mix(sped(0, 0.4, 2)))!
    expect(out.length).toBe(0.2 * SAMPLE_RATE)
    for (const k of [0, 1, 959, 960, 4000, 9599]) expect(out[k]).toBeCloseTo(2 * k * 1e-5, 6)
  })

  it('interpolates between source frames at 0.5×, over twice the length', async () => {
    decodeAs((i) => i * 1e-5)
    const out = (await mix(sped(0, 0.2, 0.5)))!
    expect(out.length).toBe(0.4 * SAMPLE_RATE)
    for (const k of [0, 1, 2, 3, 1919, 9999, 18000]) expect(out[k]).toBeCloseTo((k / 2) * 1e-5, 6)
  })

  it.each([0.5, 2, 1.5])('keeps a sound in step with its picture at %s×', async (speed) => {
    // A click recorded 0.15 s into the take; the clip starts 0.05 s in and
    // is placed 0.1 s into the timeline.
    const click = 0.15 * SAMPLE_RATE
    decodeAs((i) => (i === click ? 1 : 0))
    const clip = sped(0.05, 0.35, speed, 0.1)
    const out = (await mix(clip))!
    // The timeline time whose picture is the source's 0.15 s.
    const pictureAt = clip.timelinePosition + (0.15 - clip.startTime) / speed
    expect(sourceTimeAt(clip, pictureAt - clip.timelinePosition)).toBeCloseTo(0.15, 9)
    expect(Math.abs(peakFrame(out) - pictureAt * SAMPLE_RATE)).toBeLessThanOrEqual(1)
  })

  it('is silent above 2×', async () => {
    decodeAs(() => 0.5)
    expect(await mix(sped(0, 0.4, 4))).toBeNull()
  })

  it('reads volume keyframes in timeline time', async () => {
    decodeAs(() => 0.5)
    const animation = makeAnimation({
      keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 0.1, value: 1, easing: 'linear' }] },
    })
    const out = (await mix(sped(0, 0.4, 2, 0, { animation })))!
    // Half way up the ramp at 0.05 s of timeline, full from 0.1 s.
    expect(out[0.05 * SAMPLE_RATE]).toBeCloseTo(0.25, 3)
    expect(out[0.15 * SAMPLE_RATE]).toBeCloseTo(0.5, 6)
  })

  it('mixes a sped clip into the speech mix at its timeline length', async () => {
    decodeAs(() => 0.5)
    const blob = new Blob([floatWav([new Float32Array(4800)], SAMPLE_RATE)], { type: 'audio/wav' })
    await storeVideo('take', blob, { ...makeSourceVideo({ id: 'take', name: 'take' }), size: blob.size })
    const plane = (await extractSpeechMix([sped(0, 0.4, 2)], [makeTrack()], 0.3))!
    // 16 kHz: sound for the clip's 0.2 s, silence after it.
    expect(plane[1000]).toBeCloseTo(0.5, 6)
    expect(plane[0.25 * 16000]).toBe(0)
  })
})
