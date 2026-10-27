// Waveform peaks place a source's audio by its packets' timestamps
// (ESCSUITE-368), the way the export mixes it and a player plays it: a hole in
// a MediaRecorder track shows as a silent stretch where it falls.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSample, AudioSampleSink, EncodedPacketSink } from 'mediabunny';
import { extractWaveformData } from './waveform';
import * as placement from './audioPlacement';
import { createAudioBufferDouble, installAudioContextDouble, type AudioContextDoubles } from '../test/doubles/audio';
import { floatWav } from '../test/fixtures/wavFixture';

vi.mock('./audioPlacement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audioPlacement')>();
  return { ...actual, placeDecodedFile: vi.fn(actual.placeDecodedFile) };
});

const RATE = 48000;
/** One 20 ms Opus frame: two peak buckets at 100 peaks a second. */
const FRAME = 960;

const chunk = (value: number, timestamp: number) =>
  new AudioSample({
    data: new Float32Array(FRAME).fill(value),
    format: 'f32-planar',
    numberOfChannels: 1,
    sampleRate: RATE,
    timestamp,
  });

const wav = () => new Blob([floatWav([new Float32Array(4800)], RATE)]);

describe('extractWaveformData, placed by timestamp (ESCSUITE-368)', () => {
  let audio: AudioContextDoubles | undefined;

  afterEach(() => {
    audio?.uninstall();
    audio = undefined;
    vi.restoreAllMocks();
  });

  it('draws a hole in the track as silence, and the sound after it at its timestamp', async () => {
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      for (const [k, value] of [0.25, 0.5, 0.75].entries()) yield chunk(value, (k * FRAME) / RATE);
    });
    // A 20 ms hole before the third packet.
    vi.spyOn(EncodedPacketSink.prototype, 'packets').mockImplementation(async function* () {
      yield* [{ timestamp: 0 }, { timestamp: 0.02 }, { timestamp: 0.06 }] as never[];
    });

    const { peaks } = await extractWaveformData(wav());

    expect(peaks.map((p) => p.max)).toEqual([0.25, 0.25, 0.5, 0.5, 0, 0, 0.75, 0.75]);
  });

  it('places the whole-file fallback by the packets too, when the timestamps leave holes', async () => {
    const decoded = new Float32Array(2 * FRAME).fill(0.25, 0, FRAME).fill(0.5, FRAME);
    audio = installAudioContextDouble(createAudioBufferDouble([decoded], RATE));
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield* [];
      throw new Error('decoder error');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(placement.placeDecodedFile).mockResolvedValueOnce([
      [0, FRAME, 0],
      [FRAME, FRAME, 2 * FRAME],
    ]);

    const { peaks } = await extractWaveformData(wav());

    expect(audio.decodeCalls).toHaveLength(1);
    expect(peaks.map((p) => p.max)).toEqual([0.25, 0.25, 0, 0, 0.5, 0.5]);
  });
});
