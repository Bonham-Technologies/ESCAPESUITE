/**
 * Tests for the streaming peak reducer (ESCSUITE-338) and the bucketing both
 * paths share (ESCSUITE-418: peak i is the track's i-th 10 ms).
 *
 * The reducer must give exactly the peaks the whole-buffer algorithm gives for
 * the same PCM, however the PCM is chunked, so these tests compare the two over
 * lengths chosen to sit on every boundary the bucketing has: multiples of the
 * bucket size and one either side of them, short and long tracks, at the
 * sample rates imports actually see (one, 22.05 kHz, that 100 does not divide).
 */

import { describe, expect, it } from 'vitest';
import type { WaveformPeak } from '../store/types';
import {
  PeakReducer,
  mixToMono,
  bucketStart,
  peakSecondsFor,
  peaksFromPcm,
} from './waveformPeaks';

/** Deterministic PRNG (mulberry32), so a failing length reproduces. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A channel of noise with a transient every so often, so bucket edges matter. */
function noise(length: number, seed: number): Float32Array {
  const rand = prng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (rand() * 2 - 1) * (i % 997 === 0 ? 1 : 0.3);
  }
  return out;
}

/** Equal peak for peak, reporting the first difference rather than two huge arrays. */
function expectSamePeaks(actual: WaveformPeak[], expected: WaveformPeak[], label: string): void {
  expect(actual.length, label).toBe(expected.length);
  const first = expected.findIndex(
    (peak, i) => peak.min !== actual[i].min || peak.max !== actual[i].max
  );
  expect(first === -1 ? null : { index: first, actual: actual[first], expected: expected[first] }, label).toBeNull();
}

/** Feed `channels` to a reducer in chunks of the sizes `nextSize` hands back. */
function feed(
  reducer: PeakReducer,
  channels: Float32Array[],
  nextSize: () => number
): void {
  const length = channels[0].length;
  let at = 0;
  while (at < length) {
    const size = Math.min(length - at, Math.max(1, nextSize()));
    reducer.push(channels.map((channel) => channel.subarray(at, at + size)));
    at += size;
  }
}

describe('peaksFromPcm (the whole-buffer algorithm)', () => {
  it('buckets min/max from zero, one bucket per requested peak', () => {
    // 4 samples at 4 Hz = 1 s; 2 peaks/s means 2 samples per peak.
    const peaks = peaksFromPcm(Float32Array.from([0.5, -0.25, 0.125, -0.875]), 4, 2);
    expect(peaks).toEqual([
      { min: -0.25, max: 0.5 },
      { min: -0.875, max: 0.125 },
    ]);
  });

  it('starts every bucket at zero, so an all-positive bucket has min 0', () => {
    expect(peaksFromPcm(Float32Array.from([0.5, 0.25]), 2, 1)).toEqual([{ min: 0, max: 0.5 }]);
  });

  it('keeps the tail as a shorter last peak, so no sample is dropped (ESCSUITE-418)', () => {
    // 5 samples at 4 Hz, 2 peaks/s: two whole 2-sample peaks and one of the last sample.
    // The old bucketing made 3 peaks of floor(5 / 3) = 1 sample and dropped the last two.
    const peaks = peaksFromPcm(Float32Array.from([0.1, 0.2, 0.3, 0.9, 0.7]), 4, 2);
    expect(peaks).toEqual([
      { min: 0, max: Math.fround(0.2) },
      { min: 0, max: Math.fround(0.9) },
      { min: 0, max: Math.fround(0.7) },
    ]);
  });

  it('puts peak i at the i-th 1 / samplesPerSecond, whatever the length (ESCSUITE-418)', () => {
    // 48 kHz, 600.013 s: every peak 480 samples, not the old 479, and the
    // track's last 0.013 s its own short peak.
    const length = Math.round(600.013 * 48000);
    const mono = new Float32Array(length);
    mono[59_999 * 480] = 0.5;
    mono[length - 1] = 0.25;
    const peaks = peaksFromPcm(mono, 48000, 100);
    expect(peaks).toHaveLength(60_002);
    expect(peaks[59_999].max).toBe(0.5);
    expect(peaks[59_998].max).toBe(0);
    expect(peaks[60_001].max).toBe(0.25);
  });

  it('alternates floor and ceiling of q at a rate 100 does not divide, by absolute index', () => {
    // 22.05 kHz: q = 220.5, so peaks are 220 and 221 samples in turn and
    // peak i starts at floor(220.5 i), within a sample of i / 100 s.
    expect([0, 1, 2, 3, 4].map((i) => bucketStart(i, 22050, 100))).toEqual([0, 220, 441, 661, 882]);
    expect(bucketStart(60_000, 22050, 100)).toBe(600 * 22050);
    expect(peaksFromPcm(new Float32Array(882), 22050, 100)).toHaveLength(4);
    expect(peaksFromPcm(new Float32Array(883), 22050, 100)).toHaveLength(5);
  });

  it('gives no peaks for a rate it cannot bucket by', () => {
    expect(peaksFromPcm(new Float32Array(10), 0, 100)).toEqual([]);
    expect(peaksFromPcm(new Float32Array(10), 48000, 0)).toEqual([]);
  });

  it('gives no peaks for no samples', () => {
    expect(peaksFromPcm(new Float32Array(0), 48000, 100)).toEqual([]);
  });
});

describe('mixToMono', () => {
  it('passes a mono channel through', () => {
    const left = Float32Array.from([0.5, -0.5]);
    expect(mixToMono([left], left.length)).toBe(left);
  });

  it('averages left and right in Float32, ignoring any further channels', () => {
    const mono = mixToMono(
      [Float32Array.from([1, 0.1]), Float32Array.from([0, 0.2]), Float32Array.from([9, 9])],
      2
    );
    expect(Array.from(mono)).toEqual([0.5, Math.fround((Math.fround(0.1) + Math.fround(0.2)) / 2)]);
  });
});

describe('PeakReducer', () => {
  const rates = [48000, 44100, 22050, 8000];

  /**
   * Lengths on every edge the bucketing has, for one sample rate at 100
   * peaks/s: around one, two and many buckets, and around the ~4.8 s the
   * reducer used to hold samples for before ESCSUITE-418.
   */
  function edgeLengths(sampleRate: number): number[] {
    const q = Math.floor(sampleRate / 100);
    const lengths = new Set<number>([1, 2, q - 1, q, q + 1, 3 * q + 7]);
    for (const base of [q * q + q, 2 * (q * q + q) + q, q * 1000]) {
      for (let d = -3; d <= 3; d++) lengths.add(base + d);
    }
    return [...lengths].filter((n) => n > 0).sort((a, b) => a - b);
  }

  for (const sampleRate of rates) {
    it(`matches the whole-buffer peaks exactly at ${sampleRate} Hz, whatever the chunking`, () => {
      const rand = prng(sampleRate);
      const q = Math.floor(sampleRate / 100);
      for (const length of edgeLengths(sampleRate)) {
        const left = noise(length, length);
        const right = noise(length, length + 1);
        const expected = peaksFromPcm(mixToMono([left, right], length), sampleRate, 100);

        const chunkings = [
          () => length, // one push
          () => 1 + Math.floor(rand() * 4096), // decoder-sized chunks
        ];
        // Pathological tiny chunks, on the lengths where they finish quickly.
        if (length < 3 * (q * q + q)) chunkings.push(() => 1 + Math.floor(rand() * 7));
        for (const sizes of chunkings) {
          const reducer = new PeakReducer(sampleRate, 100);
          feed(reducer, [left, right], sizes);
          expectSamePeaks(reducer.finish(), expected, `${sampleRate} Hz, length ${length}`);
        }
      }
      // Coverage instrumentation slows the per-sample loops several times over.
    }, 60_000);
  }

  it('matches a mono stream too', () => {
    const length = 480 * 481 * 3 + 123;
    const mono = noise(length, 7);
    const reducer = new PeakReducer(48000, 100);
    feed(reducer, [mono], () => 960);
    expect(reducer.finish()).toEqual(peaksFromPcm(mono, 48000, 100));
  });

  it('matches at a non-default peak rate', () => {
    const length = 250_000;
    const mono = noise(length, 11);
    const reducer = new PeakReducer(44100, 37);
    feed(reducer, [mono], () => 1000);
    expect(reducer.finish()).toEqual(peaksFromPcm(mono, 44100, 37));
  });

  it('gives no peaks, and no timing, at a rate it cannot bucket by', () => {
    const reducer = new PeakReducer(0, 100);
    reducer.push([new Float32Array(10).fill(0.5)]);
    expect(reducer.finish()).toEqual([]);
    expect(reducer.secondsPerPeak).toBeUndefined();
  });

  it('gives no peaks when nothing was pushed', () => {
    expect(new PeakReducer(48000, 100).finish()).toEqual([]);
  });

  it('ignores an empty chunk', () => {
    const reducer = new PeakReducer(4, 2);
    reducer.push([new Float32Array(0)]);
    reducer.push([Float32Array.from([0.5, -0.25, 0.125, -0.875])]);
    expect(reducer.finish()).toEqual([
      { min: -0.25, max: 0.5 },
      { min: -0.875, max: 0.125 },
    ]);
  });

  it('reduces a long stream a chunk at a time into 10 ms peaks', () => {
    // Two minutes at 48 kHz stereo is 5.76 M frames; the old extractor held
    // all of them (and a mono copy). The reducer folds each chunk into its
    // peaks and keeps none of it. Kept to two minutes so the instrumented
    // coverage run stays well inside the 5 s test timeout on a CI runner.
    const sampleRate = 48000;
    const chunk = [new Float32Array(4800), new Float32Array(4800)];
    chunk[0][17] = 0.75;
    chunk[1][4000] = -0.5;
    const reducer = new PeakReducer(sampleRate, 100);
    for (let pushed = 0; pushed < sampleRate * 120; pushed += 4800) {
      reducer.push(chunk);
    }

    const peaks = reducer.finish();
    expect(peaks).toHaveLength(12_000);
    expect(peaks[0]).toEqual({ min: 0, max: 0.375 });
    expect(peaks[8]).toEqual({ min: -0.25, max: 0 });
  });

  it('clamps peaks past full scale to [-1, 1], short track or long', () => {
    for (const length of [4800, 480 * 481 + 4800]) {
      const hot = new Float32Array(length);
      hot[10] = 1.5;
      hot[20] = -2;
      const reducer = new PeakReducer(48000, 100);
      reducer.push([hot]);
      expect(reducer.finish()[0], `length ${length}`).toEqual({ min: -1, max: 1 });
    }
  });

  it('refuses a chunk after finish', () => {
    const reducer = new PeakReducer(48000, 100);
    reducer.finish();
    expect(() => reducer.push([new Float32Array(1)])).toThrow(/finished/);
  });
});

describe('peakSecondsFor (ESCSUITE-403)', () => {
  it('is 1 / samplesPerSecond at any rate and length (ESCSUITE-418; it was q − 1 samples off a multiple of q)', () => {
    expect(peakSecondsFor(Math.round(600.013 * 48000), 48000, 100)).toBe(0.01);
    expect(peakSecondsFor(600 * 48000, 48000, 100)).toBe(0.01);
    expect(peakSecondsFor(Math.round(600.013 * 44100), 44100, 100)).toBe(0.01);
    expect(peakSecondsFor(Math.round(600.013 * 16000), 16000, 100)).toBe(0.01);
    expect(peakSecondsFor(Math.round(600.013 * 22050), 22050, 100)).toBe(0.01);
    expect(peakSecondsFor(1000, 44100, 37)).toBe(1 / 37);
  });

  it('has nothing to time with no samples or no rate', () => {
    expect(peakSecondsFor(0, 48000, 100)).toBeUndefined();
    expect(peakSecondsFor(100, 0, 100)).toBeUndefined();
    expect(peakSecondsFor(100, 48000, 0)).toBeUndefined();
  });

  it('is what the reducer reports for the peaks it made, short track or long', () => {
    expect(new PeakReducer(48000, 100).secondsPerPeak).toBeUndefined();
    for (const length of [1000, 441 * 442 + 12345]) {
      const mono = noise(length, length);
      const reducer = new PeakReducer(44100, 100);
      reducer.push([mono]);
      const peaks = reducer.finish();
      expect(reducer.secondsPerPeak, `length ${length}`).toBe(peakSecondsFor(length, 44100, 100));
      expect(peaks.length).toBe(peaksFromPcm(mono, 44100, 100).length);
    }
    const empty = new PeakReducer(48000, 100);
    empty.finish();
    expect(empty.secondsPerPeak).toBeUndefined();
  });
});
