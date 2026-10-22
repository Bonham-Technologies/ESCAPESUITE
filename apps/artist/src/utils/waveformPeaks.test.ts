/**
 * Tests for the streaming peak reducer (ESCSUITE-338).
 *
 * The reducer must give exactly the peaks the whole-buffer algorithm gives for
 * the same PCM, however the PCM is chunked, so these tests compare the two over
 * lengths chosen to sit on every boundary the bucketing has: below, at and above
 * the point where the reducer stops holding samples, multiples of the bucket
 * size and one either side of them, at the sample rates imports actually see.
 */

import { describe, expect, it } from 'vitest';
import type { WaveformPeak } from '../store/types';
import {
  PeakReducer,
  mixToMono,
  peaksFromPcm,
  streamingThreshold,
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

  it('drops the tail past totalSamples x samplesPerPeak, as the old extractor did', () => {
    // 5 samples at 4 Hz: ceil(1.25 * 2) = 3 peaks of floor(5 / 3) = 1 sample.
    const peaks = peaksFromPcm(Float32Array.from([0.1, 0.2, 0.3, 0.9, 0.9]), 4, 2);
    expect(peaks).toEqual([
      { min: 0, max: Math.fround(0.1) },
      { min: 0, max: Math.fround(0.2) },
      { min: 0, max: Math.fround(0.3) },
    ]);
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

  /** Lengths on every edge the reducer has, for one sample rate at 100 peaks/s. */
  function edgeLengths(sampleRate: number): number[] {
    const q = Math.floor(sampleRate / 100);
    const threshold = streamingThreshold(sampleRate, 100);
    const lengths = new Set<number>([1, 2, q - 1, q, q + 1, 3 * q + 7]);
    for (const base of [threshold, threshold * 2 + q, q * 1000]) {
      for (let d = -3; d <= 3; d++) lengths.add(base + d);
    }
    return [...lengths].filter((n) => n > 0).sort((a, b) => a - b);
  }

  for (const sampleRate of rates) {
    it(`matches the whole-buffer peaks exactly at ${sampleRate} Hz, whatever the chunking`, () => {
      const rand = prng(sampleRate);
      const threshold = streamingThreshold(sampleRate, 100);
      for (const length of edgeLengths(sampleRate)) {
        const left = noise(length, length);
        const right = noise(length, length + 1);
        const expected = peaksFromPcm(mixToMono([left, right], length), sampleRate, 100);

        const chunkings = [
          () => length, // one push
          () => 1 + Math.floor(rand() * 4096), // decoder-sized chunks
        ];
        // Pathological tiny chunks, on the lengths where they finish quickly.
        if (length < 3 * threshold) chunkings.push(() => 1 + Math.floor(rand() * 7));
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
    const length = streamingThreshold(48000, 100) * 3 + 123;
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

  it('holds a bounded number of samples however long the stream runs', () => {
    // Two minutes at 48 kHz stereo is 5.76 M frames, 25 times the threshold;
    // the old extractor held all of them (and a mono copy). The reducer holds
    // at most the threshold. Kept to two minutes so the instrumented coverage
    // run stays well inside the 5 s test timeout on a CI runner.
    const sampleRate = 48000;
    const chunk = [new Float32Array(4800), new Float32Array(4800)];
    chunk[0][17] = 0.75;
    chunk[1][4000] = -0.5;
    const reducer = new PeakReducer(sampleRate, 100);
    let maxHeld = 0;
    for (let pushed = 0; pushed < sampleRate * 120; pushed += 4800) {
      reducer.push(chunk);
      maxHeld = Math.max(maxHeld, reducer.heldSamples);
    }
    expect(maxHeld).toBeLessThanOrEqual(streamingThreshold(sampleRate, 100));
    expect(reducer.heldSamples).toBe(0);

    const peaks = reducer.finish();
    expect(peaks).toHaveLength(12_000);
    expect(peaks[0]).toEqual({ min: 0, max: 0.375 });
    expect(peaks[8]).toEqual({ min: -0.25, max: 0 });
  });

  it('clamps peaks past full scale to [-1, 1], held or streamed', () => {
    for (const length of [4800, streamingThreshold(48000, 100) + 4800]) {
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
