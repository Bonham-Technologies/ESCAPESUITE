/**
 * Waveform peak reduction (ESCSUITE-338, ESCSUITE-418).
 *
 * `peaksFromPcm` reduces a whole decoded track to min/max peaks; `PeakReducer`
 * gives exactly the same peaks from the same PCM fed in chunks of any size,
 * without holding the track: a decoder's output is reduced as it arrives and
 * dropped, so an hour of 48 kHz stereo costs a few MB of peaks rather than the
 * ~1.4 GB of Float32 a whole-file decode holds.
 *
 * **Peak i is the track's i-th 1 / samplesPerSecond of time** (ESCSUITE-418):
 * samples `[bucketStart(i), bucketStart(i + 1))`, with
 * `bucketStart(i) = floor(i · sampleRate / samplesPerSecond)`, and the last
 * peak holding whatever of the track is left (so it may be shorter). That is
 * exactly q = sampleRate / 100 samples a peak at every rate q is whole for
 * (48 kHz: 480, 44.1 kHz: 441, 16 kHz: 160) and q's floor or ceiling, by
 * absolute index, at a rate it is not (22.05 kHz: 220 and 221 in turn), so
 * peak i starts within one sample of i / samplesPerSecond at any rate and any
 * length, and the peaks cover every sample. Nothing depends on the track's
 * final length, so the reducer streams from the first sample.
 *
 * The bucketing before ESCSUITE-418 was `floor(length / ceil(duration · 100))`
 * samples a peak: one sample short of 10 ms on any track not a whole number of
 * 10 ms long (479 at 48 kHz), which drew the waveform ~0.2 % off the sound.
 * Peaks made that way are still read correctly by the length stored beside
 * them (`SourceVideo.waveformSecondsPerPeak`, ESCSUITE-403), or estimated when
 * none was (`utils/peakTiming.ts`); they are never rebucketed.
 */

import type { WaveformPeak } from '../store/types';

/**
 * The first sample of peak `index`: `floor(index · sampleRate / samplesPerSecond)`.
 * Exact in floating point for any realistic track (the product is an integer
 * well under 2^53, and a quotient that is a whole number comes out whole).
 */
export function bucketStart(index: number, sampleRate: number, samplesPerSecond: number): number {
  return Math.floor((index * sampleRate) / samplesPerSecond);
}

/** Whether a rate pair can bucket at all (a bucket of no time would never end). */
function canBucket(sampleRate: number, samplesPerSecond: number): boolean {
  return sampleRate > 0 && samplesPerSecond > 0 && Number.isFinite(sampleRate / samplesPerSecond);
}

/**
 * Min/max peaks over a whole mono track: peak i over samples
 * `[bucketStart(i), bucketStart(i + 1))`, the last one cut at the track's end
 * (see the module comment). Every peak's min and max start at 0.
 */
export function peaksFromPcm(
  audioData: Float32Array,
  sampleRate: number,
  samplesPerSecond: number
): WaveformPeak[] {
  const peaks: WaveformPeak[] = [];
  if (!canBucket(sampleRate, samplesPerSecond)) return peaks;
  const length = audioData.length;

  for (let i = 0, start = 0; start < length; i++) {
    const end = Math.min(bucketStart(i + 1, sampleRate, samplesPerSecond), length);

    let min = 0;
    let max = 0;

    for (let j = start; j < end; j++) {
      const sample = audioData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    peaks.push({ min, max });
    start = end;
  }

  return peaks;
}

/**
 * How long one of `peaksFromPcm`'s peaks lasts, in seconds, for a track
 * `length` samples long: 1 / samplesPerSecond, whatever the rate and the
 * length (the module comment). `undefined` for a track with no samples, which
 * has no peaks to time. Stored beside the peaks as
 * `SourceVideo.waveformSecondsPerPeak`, so they are read by their own timing
 * and not mistaken for peaks bucketed the old way.
 */
export function peakSecondsFor(length: number, sampleRate: number, samplesPerSecond: number): number | undefined {
  if (!(length > 0) || !canBucket(sampleRate, samplesPerSecond)) return undefined;
  return 1 / samplesPerSecond;
}

/**
 * The mono signal the peaks are taken from: the first channel of a mono track,
 * `(left + right) / 2` rounded to Float32 for anything wider (further channels
 * are ignored, as they always were). Every channel is `frames` long; `out`, at
 * least that long, is written instead of a fresh array.
 */
export function mixToMono(
  channels: readonly Float32Array[],
  frames: number,
  out: Float32Array = new Float32Array(frames)
): Float32Array {
  const left = channels[0];
  if (channels.length < 2) return left;
  const right = channels[1];
  const mono = out.subarray(0, frames);
  for (let i = 0; i < frames; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }
  return mono;
}

/**
 * Reduces a track to `peaksFromPcm`'s peaks as its PCM arrives, in chunks of
 * any size. It holds no samples: each bucket's bounds are known from its index
 * alone, so a chunk is folded into the open bucket (closing it, and any that
 * follow, at their boundaries) and dropped.
 */
export class PeakReducer {
  /** Closed peaks' minima and maxima. */
  private mins = new Float32Array(1024);
  private maxs = new Float32Array(1024);
  private closed = 0;
  /** The open peak's running min and max. */
  private min = 0;
  private max = 0;
  /** Absolute sample index the open peak ends at (exclusive). */
  private boundary: number;
  private length = 0;
  private scratch = new Float32Array(0);
  private finished = false;
  private timing: number | undefined;

  constructor(
    private readonly sampleRate: number,
    private readonly samplesPerSecond: number
  ) {
    // A rate pair that cannot bucket never closes a peak: one that would
    // otherwise run forever has its first boundary at the end of time.
    this.boundary = canBucket(sampleRate, samplesPerSecond) ? this.startOf(1) : Infinity;
  }

  private startOf(index: number): number {
    return bucketStart(index, this.sampleRate, this.samplesPerSecond);
  }

  /** One chunk of planar PCM: one array per channel, all the same length. */
  push(channels: readonly Float32Array[]): void {
    if (this.finished) throw new Error('PeakReducer: push after finished');
    const frames = channels[0].length;
    if (frames === 0) return;
    if (this.scratch.length < frames) this.scratch = new Float32Array(frames);
    const mono = mixToMono(channels, frames, this.scratch);

    const start = this.length;
    let i = 0;
    while (i < frames) {
      const end = Math.min(frames, this.boundary - start);
      let min = this.min;
      let max = this.max;
      for (let j = i; j < end; j++) {
        const sample = mono[j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      this.min = min;
      this.max = max;
      i = end;
      if (start + i === this.boundary) this.close();
    }
    this.length += frames;
  }

  private close(): void {
    if (this.closed === this.mins.length) {
      const mins = new Float32Array(this.mins.length * 2);
      const maxs = new Float32Array(this.maxs.length * 2);
      mins.set(this.mins);
      maxs.set(this.maxs);
      this.mins = mins;
      this.maxs = maxs;
    }
    this.mins[this.closed] = this.min;
    this.maxs[this.closed] = this.max;
    this.closed += 1;
    this.min = 0;
    this.max = 0;
    this.boundary = this.startOf(this.closed + 1);
  }

  /**
   * How long each of `finish`'s peaks lasts, in seconds (`peakSecondsFor`):
   * `undefined` before `finish`, or when nothing was pushed.
   */
  get secondsPerPeak(): number | undefined {
    return this.timing;
  }

  /** The peaks of everything pushed. The reducer takes no more chunks after. */
  finish(): WaveformPeak[] {
    this.finished = true;
    this.timing = peakSecondsFor(this.length, this.sampleRate, this.samplesPerSecond);
    // The last peak is whatever the track left after the last boundary.
    if (this.length > this.startOf(this.closed) && this.boundary !== Infinity) this.close();
    const peaks: WaveformPeak[] = new Array(this.closed);
    for (let i = 0; i < this.closed; i++) {
      peaks[i] = { min: this.mins[i], max: this.maxs[i] };
    }
    return clampToFullScale(peaks);
  }
}

/**
 * Peaks limited to full scale, in place. A decode through WebCodecs can hand
 * back samples past ±1 (an Opus stream mixed hot), which decodeAudioData's
 * Opus decoder soft-clips; the old peaks never left [-1, 1] there, so neither
 * do these. Peaks already in range — every sample in range — are untouched,
 * so in-range PCM still gives exactly `peaksFromPcm`'s peaks.
 */
function clampToFullScale(peaks: WaveformPeak[]): WaveformPeak[] {
  for (const peak of peaks) {
    peak.min = Math.max(-1, peak.min);
    peak.max = Math.min(1, peak.max);
  }
  return peaks;
}
