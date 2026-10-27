// The export mixer places a source's audio by its packets' timestamps
// (ESCSUITE-368): a hole in a MediaRecorder track stays a silent hole instead
// of pulling the rest of the sound earlier, so a long take's export keeps its
// sound with its picture. Chunks and packets are doubles; the WAV only gives
// mediabunny a 48 kHz audio track to open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioSample, AudioSampleSink, EncodedPacketSink } from 'mediabunny'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import * as placement from '../utils/audioPlacement'
import {
  createAudioBufferDouble,
  installOfflineAudioContextDouble,
  type OfflineAudioContextDoubles,
} from '../test/doubles/audio'
import { makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import { floatWav } from '../test/fixtures/wavFixture'

vi.mock('../utils/audioPlacement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/audioPlacement')>()
  return { ...actual, placeDecodedFile: vi.fn(actual.placeDecodedFile) }
})

const SAMPLE_RATE = 48000
/** One 20 ms Opus frame. */
const FRAME = 960

/** A mono chunk of `FRAME` frames, every one `value`. */
const chunk = (value: number, timestamp: number) =>
  new AudioSample({
    data: new Float32Array(FRAME).fill(value),
    format: 'f32-planar',
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    timestamp,
  })

/** Decode `values` as one chunk each, counted end to end as the decoder stamps them, from packets stamped `stamps`. */
function decodeAs(values: number[], stamps: number[]): void {
  vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
    for (let k = 0; k < values.length; k++) yield chunk(values[k], (k * FRAME) / SAMPLE_RATE)
  })
  vi.spyOn(EncodedPacketSink.prototype, 'packets').mockImplementation(async function* () {
    yield* stamps.map((timestamp) => ({ timestamp, duration: FRAME / SAMPLE_RATE })) as never[]
  })
}

async function mix(duration = 0.1): Promise<Float32Array> {
  const blob = new Blob([floatWav([new Float32Array(4800)], SAMPLE_RATE)], { type: 'audio/wav' })
  await storeVideo('take', blob, { ...makeSourceVideo({ id: 'take', name: 'take' }), size: blob.size })
  const clips = [makeClip({ sourceVideoId: 'take', duration, endTime: duration })]
  return (await extractAndMixAudio(clips, [makeTrack()], duration, vi.fn()))![0]
}

/** The value at each 20 ms frame of `mixed`. */
const frames = (mixed: Float32Array, count: number) =>
  Array.from({ length: count }, (_, k) => mixed[k * FRAME + FRAME / 2])

describe('extractAndMixAudio, placed by timestamp (ESCSUITE-368)', () => {
  let offline: OfflineAudioContextDoubles

  beforeEach(() => {
    offline = installOfflineAudioContextDouble(() => createAudioBufferDouble([new Float32Array(4800)], SAMPLE_RATE))
  })

  afterEach(() => {
    offline.uninstall()
    vi.restoreAllMocks()
  })

  it('leaves a hole in the track silent, and the sound after it at its timestamp', async () => {
    // A 20 ms hole before the third packet.
    decodeAs([0.1, 0.2, 0.3, 0.4], [0, 0.02, 0.06, 0.08])

    expect(frames(await mix(), 5)).toEqual([0.1, 0.2, 0, 0.3, 0.4].map(Math.fround))
  })

  it('trims an overlap rather than stack the samples', async () => {
    // The third packet starts 15 ms into the second.
    decodeAs([0.1, 0.2, 0.3, 0.4], [0, 0.02, 0.025, 0.045])
    const mixed = await mix()

    expect(mixed[1919]).toBe(Math.fround(0.2))
    // The third chunk lost its first 720 frames; 240 remain, then the fourth.
    expect(mixed[1920]).toBe(Math.fround(0.3))
    expect(mixed[2159]).toBe(Math.fround(0.3))
    expect(mixed[2160]).toBe(Math.fround(0.4))
    expect(mixed[3119]).toBe(Math.fround(0.4))
    expect(mixed[3120]).toBe(0)
  })

  it('mixes a track whose packets tile, jitter and all, exactly as laid end to end', async () => {
    decodeAs([0.1, 0.2, 0.3, 0.4], [0, 0.023, 0.037, 0.061])

    expect(frames(await mix(), 5)).toEqual([0.1, 0.2, 0.3, 0.4, 0].map(Math.fround))
  })

  it('places the whole-file fallback by the packets too, when the timestamps leave holes', async () => {
    // A 44.1 kHz source goes to decodeAudioData, which resamples it to 48 kHz.
    const decoded = new Float32Array(3 * FRAME)
    decoded.fill(0.1, 0, FRAME).fill(0.2, FRAME, 2 * FRAME).fill(0.3, 2 * FRAME)
    offline.decode = () => createAudioBufferDouble([decoded], SAMPLE_RATE)
    vi.mocked(placement.placeDecodedFile).mockResolvedValueOnce([
      [0, FRAME, 0],
      [FRAME, FRAME, FRAME],
      [2 * FRAME, FRAME, 3 * FRAME],
    ])
    const blob = new Blob([floatWav([new Float32Array(4410)], 44100)], { type: 'audio/wav' })
    await storeVideo('take', blob, { ...makeSourceVideo({ id: 'take', name: 'take' }), size: blob.size })
    const clips = [makeClip({ sourceVideoId: 'take', duration: 0.1, endTime: 0.1 })]

    const mixed = (await extractAndMixAudio(clips, [makeTrack()], 0.1, vi.fn()))![0]

    expect(offline.decodeCalls).toHaveLength(1)
    expect(placement.placeDecodedFile).toHaveBeenCalledWith(expect.any(Blob), 3 * FRAME, SAMPLE_RATE)
    expect(frames(mixed, 5)).toEqual([0.1, 0.2, 0, 0.3, 0].map(Math.fround))
  })
})
