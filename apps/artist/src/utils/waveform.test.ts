/**
 * Tests for waveform extraction utilities
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioSample, AudioSampleSink } from 'mediabunny';
import { extractWaveformData, resamplePeaks, getPeaksForRange } from './waveform';
import type { WaveformPeak } from '../store/types';
import {
  createAudioBufferDouble,
  installAudioContextDouble,
  type AudioContextDoubles,
} from '../test/doubles/audio';
import { removeGlobal } from '../test/doubles/globals';
import { floatWav } from '../test/fixtures/wavFixture';

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media');
/** A committed media fixture, as a Blob (src/test/fixtures/media/README.md). */
const mediaBlob = (name: string): Blob => new Blob([new Uint8Array(readFileSync(resolve(MEDIA, name)))]);

/** `length` frames of a tone with a click every 997 frames, so bucket edges matter. */
function signal(length: number, phase: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin(i * 0.013 + phase) * 0.4 + (i % 997 === 0 ? 0.5 : 0);
  }
  return out;
}

describe('waveform utilities', () => {
  describe('resamplePeaks', () => {
    it('returns empty array for empty input', () => {
      expect(resamplePeaks([], 10)).toEqual([]);
    });

    it('returns empty array for zero target samples', () => {
      const peaks: WaveformPeak[] = [{ min: -0.5, max: 0.5 }];
      expect(resamplePeaks(peaks, 0)).toEqual([]);
    });

    it('returns original array when target equals source length', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.3 },
        { min: -0.7, max: 0.7 },
      ];
      expect(resamplePeaks(peaks, 3)).toEqual(peaks);
    });

    it('downsamples by combining peaks', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.2, max: 0.2 },
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.8 },
        { min: -0.7, max: 0.1 },
      ];
      const result = resamplePeaks(peaks, 2);

      expect(result).toHaveLength(2);
      // First sample combines peaks 0-1
      expect(result[0].min).toBe(-0.5);
      expect(result[0].max).toBe(0.5);
      // Second sample combines peaks 2-3
      expect(result[1].min).toBe(-0.7);
      expect(result[1].max).toBe(0.8);
    });

    it('upsamples by repeating peaks', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.3 },
      ];
      const result = resamplePeaks(peaks, 4);

      expect(result).toHaveLength(4);
      // Each original peak should be used for 2 output samples
      expect(result[0]).toEqual({ min: -0.5, max: 0.5 });
      expect(result[1]).toEqual({ min: -0.5, max: 0.5 });
      expect(result[2]).toEqual({ min: -0.3, max: 0.3 });
      expect(result[3]).toEqual({ min: -0.3, max: 0.3 });
    });

    it('handles single sample downsampling', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.2, max: 0.3 },
        { min: -0.5, max: 0.5 },
        { min: -0.1, max: 0.8 },
      ];
      const result = resamplePeaks(peaks, 1);

      expect(result).toHaveLength(1);
      expect(result[0].min).toBe(-0.5);
      expect(result[0].max).toBe(0.8);
    });

    it('copies the one real source sample into every bucket far narrower than it', () => {
      // ratio = 1/49: every one of the 49 buckets maps to at most the
      // single real sample at index 0 — confirmed by construction (not
      // asserted here) to never take the multi-sample branch at all, so
      // this is a clean, unambiguous exercise of the single-sample path on
      // every iteration, first and last included. (ESCSUITE-13 coverage
      // round: this used to be one of a true/false pair pinning a
      // defensive `if (single)` null-check on `peaks[startIndex]`; that
      // guard's false side was only reachable by constructing a sparse
      // `peaks` array with a hole, which `resamplePeaks` never receives in
      // practice — the guard was deleted rather than tested, per the
      // ESCSUITE-110 / 118 precedent, and this case is what remains of the
      // pair.)
      const peaks: WaveformPeak[] = [{ min: -0.6, max: 0.9 }];
      const result = resamplePeaks(peaks, 49);

      expect(result).toHaveLength(49);
      expect(result[0]).toEqual({ min: -0.6, max: 0.9 });
      expect(result[48]).toEqual({ min: -0.6, max: 0.9 });
    });

    describe('with a reusable output buffer (ESCSUITE-13 round 2, MAJOR-1(d))', () => {
      it('writes into and returns the given buffer instead of allocating', () => {
        const peaks: WaveformPeak[] = [
          { min: -0.2, max: 0.2 },
          { min: -0.5, max: 0.5 },
          { min: -0.3, max: 0.8 },
          { min: -0.7, max: 0.1 },
        ];
        const buffer: WaveformPeak[] = [];
        const result = resamplePeaks(peaks, 2, buffer);

        expect(result).toBe(buffer);
        expect(result).toEqual([
          { min: -0.5, max: 0.5 },
          { min: -0.7, max: 0.8 },
        ]);
      });

      it('mutates an object already at an index rather than replacing it', () => {
        const peaks: WaveformPeak[] = [
          { min: -0.2, max: 0.2 },
          { min: -0.9, max: 0.9 },
        ];
        const reused = { min: 0, max: 0 };
        const buffer: WaveformPeak[] = [reused];

        const result = resamplePeaks(peaks, 1, buffer);

        expect(result[0]).toBe(reused);
        expect(reused).toEqual({ min: -0.9, max: 0.9 });
      });

      it('grows the buffer when the new request is longer than its last use', () => {
        const peaks: WaveformPeak[] = [
          { min: -0.1, max: 0.1 },
          { min: -0.2, max: 0.2 },
        ];
        const buffer: WaveformPeak[] = [{ min: -0.9, max: 0.9 }];

        const result = resamplePeaks(peaks, 2, buffer);

        expect(result).toHaveLength(2);
        // The one pre-existing slot is reused; the new slot is a fresh object.
        expect(result[0]).toEqual({ min: -0.1, max: 0.1 });
        expect(result[1]).toEqual({ min: -0.2, max: 0.2 });
      });

      it('shrinks a longer previous buffer to exactly the new request', () => {
        const peaks: WaveformPeak[] = [{ min: -0.4, max: 0.4 }];
        const buffer: WaveformPeak[] = [
          { min: -0.1, max: 0.1 },
          { min: -0.2, max: 0.2 },
          { min: -0.3, max: 0.3 },
        ];

        const result = resamplePeaks(peaks, 1, buffer);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ min: -0.4, max: 0.4 });
      });

      it('never aliases a source peak object, even on the single-sample path', () => {
        const source = { min: -0.6, max: 0.6 };
        const buffer: WaveformPeak[] = [];

        const result = resamplePeaks([source], 1, buffer);
        result[0].min = 1;

        // Mutating the output must not corrupt the caller's source data.
        expect(source.min).toBe(-0.6);
      });

      it('empties rather than discards the buffer for empty input', () => {
        const buffer: WaveformPeak[] = [{ min: -0.1, max: 0.1 }];
        const result = resamplePeaks([], 10, buffer);

        expect(result).toBe(buffer);
        expect(result).toEqual([]);
      });
    });
  });

  describe('getPeaksForRange', () => {
    it('returns empty array for empty input', () => {
      expect(getPeaksForRange([], 10, 0, 5)).toEqual([]);
    });

    it('returns empty array for zero duration', () => {
      const peaks: WaveformPeak[] = [{ min: -0.5, max: 0.5 }];
      expect(getPeaksForRange(peaks, 0, 0, 5)).toEqual([]);
    });

    it('returns all peaks when range covers full duration', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      const result = getPeaksForRange(peaks, 5, 0, 5);
      expect(result).toEqual(peaks);
    });

    it('returns subset for partial range from start', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      // 5 peaks over 5 seconds = 1 peak per second
      // Range 0-2 should get peaks 0-1 (indices 0,1)
      const result = getPeaksForRange(peaks, 5, 0, 2);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]).toEqual({ min: -0.1, max: 0.1 });
    });

    it('returns subset for partial range from middle', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      // 5 peaks over 5 seconds = 1 peak per second
      // Range 2-4 should get peaks at seconds 2-4 (indices 2,3)
      const result = getPeaksForRange(peaks, 5, 2, 4);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ min: -0.3, max: 0.3 });
      expect(result[1]).toEqual({ min: -0.4, max: 0.4 });
    });

    it('clamps to valid indices', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
      ];
      // Request range beyond duration
      const result = getPeaksForRange(peaks, 3, 2, 10);
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ min: -0.3, max: 0.3 });
    });

    it('returns empty for range entirely beyond duration', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
      ];
      const result = getPeaksForRange(peaks, 2, 5, 10);
      expect(result).toEqual([]);
    });
  });
});

describe('extractWaveformData', () => {
  let audio: AudioContextDoubles;

  afterEach(() => {
    audio?.uninstall();
    vi.restoreAllMocks();
  });

  /** A one-second mono buffer at 100 Hz, so 100 samples map to 100 peaks/s. */
  const oneSecond = (values: number[]) =>
    createAudioBufferDouble([Float32Array.from(values)], values.length);

  it('extracts one peak per requested sample, each the min/max of its bucket', async () => {
    // 4 samples at 4 Hz = 1 second; 2 peaks/s means 2 samples per peak.
    audio = installAudioContextDouble(oneSecond([0.5, -0.25, 0.125, -0.875]));

    const result = await extractWaveformData(new Blob(['audio']), 2);

    expect(result.peaks).toEqual([
      { min: -0.25, max: 0.5 },
      { min: -0.875, max: 0.125 },
    ]);
    expect(result.hasAudio).toBe(true);
    // The blob really was read and the context really was closed.
    expect(audio.decodeCalls).toHaveLength(1);
    expect(audio.closed).toBe(1);
  });

  it('averages the two channels of a stereo buffer', async () => {
    audio = installAudioContextDouble(
      createAudioBufferDouble(
        [Float32Array.from([1, 0]), Float32Array.from([0, -1])],
        2
      )
    );

    const result = await extractWaveformData(new Blob(['audio']), 2);

    // (1+0)/2 = 0.5 and (0+-1)/2 = -0.5
    expect(result.peaks).toEqual([
      { min: 0, max: 0.5 },
      { min: -0.5, max: 0 },
    ]);
  });

  it('reports hasAudio false for a silent track, while still returning peaks', async () => {
    audio = installAudioContextDouble(oneSecond([0, 0.00048828125, -0.00048828125, 0]));

    const result = await extractWaveformData(new Blob(['audio']), 2);

    expect(result.peaks).toHaveLength(2);
    expect(result.hasAudio).toBe(false);
  });

  it('returns no peaks and closes the context when the media has no decodable audio', async () => {
    audio = installAudioContextDouble(null);

    const result = await extractWaveformData(new Blob(['video-without-audio']));

    expect(result).toEqual({ peaks: [], hasAudio: false });
    expect(audio.closed).toBe(1);
  });

  it('defaults to 100 peaks per second of audio', async () => {
    audio = installAudioContextDouble(
      createAudioBufferDouble([new Float32Array(4800)], 4800)
    );

    const result = await extractWaveformData(new Blob(['audio']));

    // 1 second of audio at the default rate
    expect(result.peaks).toHaveLength(100);
  });

  it('warns and returns nothing when the audio pipeline throws outright', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = removeGlobal('AudioContext');
    try {
      const result = await extractWaveformData(new Blob(['audio']));

      expect(result).toEqual({ peaks: [], hasAudio: false });
      expect(warn).toHaveBeenCalledWith('Failed to extract waveform data:', expect.any(Error));
    } finally {
      restore();
    }
  });
});

describe('extractWaveformData, streamed (ESCSUITE-338)', () => {
  let audio: AudioContextDoubles | undefined;

  afterEach(() => {
    audio?.uninstall();
    audio = undefined;
    vi.restoreAllMocks();
  });

  it('gives exactly the whole-file decode\'s peaks for the same PCM, without decodeAudioData', async () => {
    // Six seconds of 48 kHz stereo: past the point where the reducer stops
    // holding samples, so the bucketing is the streamed one.
    const left = signal(48000 * 6 + 123, 0);
    const right = signal(48000 * 6 + 123, 1.7);

    audio = installAudioContextDouble(createAudioBufferDouble([left, right], 48000));
    const whole = await extractWaveformData(new Blob(['not a container']));
    expect(audio.decodeCalls).toHaveLength(1);

    const streamed = await extractWaveformData(new Blob([floatWav([left, right], 48000)]));

    expect(audio.decodeCalls).toHaveLength(1);
    expect(audio.created).toBe(1);
    expect(streamed.peaks).toHaveLength(601);
    expect(streamed).toEqual(whole);
    expect(streamed.hasAudio).toBe(true);
  });

  it('reads a mono track, and one too short to stream, the same way', async () => {
    const mono = signal(4410, 0.3);
    audio = installAudioContextDouble(createAudioBufferDouble([mono], 44100));
    const whole = await extractWaveformData(new Blob(['not a container']));

    const streamed = await extractWaveformData(new Blob([floatWav([mono], 44100)]));

    expect(streamed.peaks).toHaveLength(10);
    expect(streamed).toEqual(whole);
    expect(audio.decodeCalls).toHaveLength(1);
  });

  it('reports hasAudio false for a silent track, while still returning peaks', async () => {
    const result = await extractWaveformData(new Blob([floatWav([new Float32Array(4800)])]));

    expect(result.peaks).toHaveLength(10);
    expect(result.hasAudio).toBe(false);
  });

  it('answers a container with no audio track with no peaks and no decode', async () => {
    audio = installAudioContextDouble(createAudioBufferDouble([signal(4800, 0)], 48000));

    const result = await extractWaveformData(mediaBlob('h264-faststart.mp4'));

    expect(result).toEqual({ peaks: [], hasAudio: false });
    expect(audio.created).toBe(0);
  });

  it('answers an audio track with no samples with no peaks', async () => {
    audio = installAudioContextDouble(null);

    const result = await extractWaveformData(new Blob([floatWav([new Float32Array(0)])]));

    expect(result).toEqual({ peaks: [], hasAudio: false });
    expect(audio.created).toBe(0);
  });

  it('falls back to the whole-file decode for a codec this browser cannot decode', async () => {
    // jsdom has no AudioDecoder, so the AAC track cannot be streamed.
    audio = installAudioContextDouble(createAudioBufferDouble([signal(4800, 0)], 48000));

    const result = await extractWaveformData(mediaBlob('video-with-aac.mp4'));

    expect(audio.decodeCalls).toHaveLength(1);
    expect(result.peaks).toHaveLength(10);
  });

  it('warns and falls back to the whole-file decode when the streamed decode fails part-way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield* [];
      throw new Error('decoder error');
    });
    const channel = signal(4800, 0);
    audio = installAudioContextDouble(createAudioBufferDouble([channel], 48000));

    const result = await extractWaveformData(new Blob([floatWav([channel])]));

    expect(warn).toHaveBeenCalledWith(
      'Streamed waveform decode failed; decoding the whole file instead:',
      expect.any(Error)
    );
    expect(audio.decodeCalls).toHaveLength(1);
    expect(result.peaks).toHaveLength(10);
  });

  it('drops the priming frames a track places before zero, as decodeAudioData does', async () => {
    // An MP4 edit list's AAC priming arrives as frames with negative
    // timestamps: here a whole sample before zero and half of the next one.
    const planar = (values: number[], timestamp: number) =>
      new AudioSample({
        data: Float32Array.from(values),
        format: 'f32-planar',
        numberOfChannels: 1,
        sampleRate: 4,
        timestamp,
      });
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield planar([0.9, 0.9], -1);
      yield planar([0.9, 0.5, -0.25], -0.25);
      yield planar([0.125, -0.875], 0.5);
    });
    audio = installAudioContextDouble(null);

    const result = await extractWaveformData(new Blob([floatWav([new Float32Array(4)], 4)]), 2);

    expect(audio.created).toBe(0);
    expect(result.peaks).toEqual([
      { min: -0.25, max: 0.5 },
      { min: -0.875, max: 0.125 },
    ]);
  });

  it('leaves MP3 to the whole-file decode, which trims its encoder delay', async () => {
    // Three MPEG-1 Layer III frames (128 kb/s, 44.1 kHz, 417 bytes each).
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x64]);
    const mp3 = new Blob([frame, frame, frame]);
    audio = installAudioContextDouble(createAudioBufferDouble([signal(4410, 0)], 44100));

    const result = await extractWaveformData(mp3);

    expect(audio.decodeCalls).toHaveLength(1);
    expect(result.peaks).toHaveLength(10);
  });
});
