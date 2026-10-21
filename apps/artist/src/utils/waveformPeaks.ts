/**
 * Waveform peak reduction (ESCSUITE-338).
 *
 * `peaksFromPcm` is the bucketing `extractWaveformData` has always used, over a
 * whole decoded track. `PeakReducer` gives exactly the same peaks from the same
 * PCM fed in chunks of any size, without holding the track: a decoder's output
 * is reduced as it arrives and dropped, so an hour of 48 kHz stereo costs a few
 * MB of peaks rather than the ~1.4 GB of Float32 a whole-file decode holds.
 *
 * The one thing that makes streaming awkward is that the bucket size depends on
 * the track's final length, which is not known until the last chunk:
 *
 *   totalSamples   = ceil(length / sampleRate * samplesPerSecond)
 *   samplesPerPeak = floor(length / totalSamples)
 *
 * With q = sampleRate / samplesPerSecond, once totalSamples >= q the bucket size
 * can only be floor(q) - 2 .. floor(q) + 1 (length / totalSamples lies in
 * (q - q / totalSamples, q], and the float `ceil` can move totalSamples by one
 * either way). So the reducer holds samples only until the track is certain to
 * be that long (`streamingThreshold`: ~4.8 s at 48 kHz), then reduces into one
 * set of buckets per candidate size at once, and `finish` keeps the set whose
 * size the real length picks. Buckets are by absolute sample index in every
 * set, so the result equals `peaksFromPcm` by construction, not approximately.
 */

import type { WaveformPeak } from '../store/types';

/**
 * Min/max peaks over a whole mono track — the bucketing `extractWaveformData`
 * has always used, kept verbatim so the streaming path has something to equal.
 *
 * `totalSamples = ceil(duration * samplesPerSecond)` buckets of
 * `floor(length / totalSamples)` samples each, by absolute sample index; every
 * bucket's min and max start at 0; samples past the last bucket are dropped.
 */
export function peaksFromPcm(
  audioData: Float32Array,
  sampleRate: number,
  samplesPerSecond: number
): WaveformPeak[] {
  const duration = audioData.length / sampleRate;
  const totalSamples = Math.ceil(duration * samplesPerSecond);
  const samplesPerPeak = Math.floor(audioData.length / totalSamples);

  const peaks: WaveformPeak[] = [];

  for (let i = 0; i < totalSamples; i++) {
    const startSample = i * samplesPerPeak;
    const endSample = Math.min(startSample + samplesPerPeak, audioData.length);

    let min = 0;
    let max = 0;

    for (let j = startSample; j < endSample; j++) {
      const sample = audioData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    peaks.push({ min, max });
  }

  return peaks;
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
 * How many samples the reducer holds before it starts reducing: enough that the
 * final `totalSamples` is at least q = sampleRate / samplesPerSecond whatever
 * else arrives, so the bucket size is one of the four candidates.
 */
export function streamingThreshold(sampleRate: number, samplesPerSecond: number): number {
  const q = sampleRate / samplesPerSecond;
  return Math.ceil(q * q) + Math.ceil(q);
}

/** One candidate bucket size's running buckets. */
class BucketSet {
  /** Closed buckets' minima and maxima. */
  private mins = new Float32Array(1024);
  private maxs = new Float32Array(1024);
  private closed = 0;
  /** The open bucket. */
  private min = 0;
  private max = 0;
  /** Absolute sample index the open bucket ends at (exclusive). */
  private boundary: number;

  constructor(readonly size: number) {
    this.boundary = size;
  }

  /** Reduce `mono`, whose first sample has absolute index `start`. */
  push(mono: Float32Array, start: number): void {
    const length = mono.length;
    let i = 0;
    while (i < length) {
      const end = Math.min(length, this.boundary - start);
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
    this.boundary += this.size;
  }

  /**
   * The first `count` buckets. `count * size` never exceeds the samples pushed
   * (that is how `finish` picks the size), so every one of them has closed.
   */
  peaks(count: number): WaveformPeak[] {
    const peaks: WaveformPeak[] = new Array(count);
    for (let i = 0; i < count; i++) {
      peaks[i] = { min: this.mins[i], max: this.maxs[i] };
    }
    return peaks;
  }
}

/**
 * Reduces a track to `peaksFromPcm`'s peaks as its PCM arrives, in chunks of any
 * size, holding at most `streamingThreshold` samples (see the module comment).
 */
export class PeakReducer {
  private readonly threshold: number;
  /** Mono samples held until the threshold, or null once reducing. */
  private held: Float32Array | null;
  private heldLength = 0;
  private sets: BucketSet[] | null = null;
  private length = 0;
  private scratch = new Float32Array(0);
  private finished = false;

  constructor(
    private readonly sampleRate: number,
    private readonly samplesPerSecond: number
  ) {
    this.threshold = streamingThreshold(sampleRate, samplesPerSecond);
    this.held = new Float32Array(Math.min(this.threshold, 1 << 16));
  }

  /** Mono samples currently held (0 once the reducer is streaming). */
  get heldSamples(): number {
    return this.held ? this.heldLength : 0;
  }

  /** One chunk of planar PCM: one array per channel, all the same length. */
  push(channels: readonly Float32Array[]): void {
    if (this.finished) throw new Error('PeakReducer: push after finished');
    const frames = channels[0].length;
    if (frames === 0) return;
    if (this.scratch.length < frames) this.scratch = new Float32Array(frames);
    const mono = mixToMono(channels, frames, this.scratch);

    if (this.sets) {
      for (const set of this.sets) set.push(mono, this.length);
    } else {
      this.hold(mono);
      if (this.heldLength >= this.threshold) this.startStreaming();
    }
    this.length += frames;
  }

  private hold(mono: Float32Array): void {
    let held = this.held!;
    const needed = this.heldLength + mono.length;
    if (needed > held.length) {
      const grown = new Float32Array(Math.max(needed, held.length * 2));
      grown.set(held.subarray(0, this.heldLength));
      held = grown;
      this.held = grown;
    }
    held.set(mono, this.heldLength);
    this.heldLength = needed;
  }

  private startStreaming(): void {
    const q = Math.floor(this.sampleRate / this.samplesPerSecond);
    const sets: BucketSet[] = [];
    // Never a size below one, which would never close a bucket.
    for (let size = Math.max(1, q - 2); size <= q + 1; size++) sets.push(new BucketSet(size));
    const held = this.held!.subarray(0, this.heldLength);
    for (const set of sets) set.push(held, 0);
    this.sets = sets;
    this.held = null;
    this.heldLength = 0;
  }

  /** The peaks of everything pushed. The reducer takes no more chunks after. */
  finish(): WaveformPeak[] {
    this.finished = true;
    if (!this.sets) {
      const held = this.held!.subarray(0, this.heldLength);
      this.held = null;
      return clampToFullScale(peaksFromPcm(held, this.sampleRate, this.samplesPerSecond));
    }
    const duration = this.length / this.sampleRate;
    const totalSamples = Math.ceil(duration * this.samplesPerSecond);
    const samplesPerPeak = Math.floor(this.length / totalSamples);
    // Always found, by the bound in the module comment, so there is no branch
    // for a miss (ESCSUITE-110 / 118: no guard nothing can reach). Were it ever
    // missed, `.peaks` would throw, and `extractWaveformData` answers a throw
    // here with its whole-file decode rather than a guessed bucketing.
    const set = this.sets.find((candidate) => candidate.size === samplesPerPeak)!;
    this.sets = null;
    return clampToFullScale(set.peaks(totalSamples));
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
