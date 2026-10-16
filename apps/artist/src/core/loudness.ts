// Loudness metering and normalise-to-target for the export's rendered mix
// (ESCSUITE-292): ITU-R BS.1770-4 integrated loudness and true peak, the
// EBU R128 way of reading them, and a gain-plus-limiter that moves a mix onto
// a target loudness without letting its true peak past a ceiling.
//
// Written from the public specification, not ported:
//
// * **K-weighting** is two biquads in series — a high shelf (≈ +4 dB above
//   ~1.7 kHz, the head's acoustic effect) then the "RLB" high-pass (≈ 38 Hz).
//   BS.1770-4 prints their coefficients for 48 kHz only; here they are derived
//   for any rate through the bilinear transform from the analog prototype the
//   table was designed from (centre frequency, Q and gain as published in
//   libebur128), and at 48 kHz they reproduce the table to eight decimals —
//   `loudness.test.ts` checks that against the table itself.
// * **Mean square** of the K-weighted signal per channel over 400 ms blocks
//   stepped every 100 ms (75 % overlap), summed across channels with weights
//   L/R/C 1.0, surrounds 1.41, LFE 0.
// * **Gating**: blocks at or below −70 LUFS are dropped (absolute gate); of
//   the rest, blocks at or below the mean of the survivors minus 10 LU are
//   dropped (relative gate). Integrated loudness = −0.691 + 10·log10(mean
//   energy of what is left).
// * **True peak**: the sample peak and the peaks between samples, read by 4×
//   oversampling each channel with a 24-tap-per-phase Hann-windowed sinc —
//   BS.1770-4 Annex 2 asks for 4× oversampling through an interpolation
//   low-pass and leaves the filter to the implementer. This one reads an fs/4
//   tone at 45° (every sample at −3 dB, the waveform at 0 dB) well inside EBU
//   Tech 3341's +0.2 / −0.4 dB, and full-band white noise at the same figure
//   ffmpeg's `ebur128` prints (−3.6 dBTP, measured 2026-10-16); 16 taps read
//   that noise 0.6 dB low. Content right up at Nyquist still reads up to
//   ~0.7 dB under a long band-limited reference, as ffmpeg's does — which is
//   also how far over −1 dBTP the limiter can let such content go.
//
// The open-source storytold/filmcraft meter (`crates/audio-dsp/src/
// loudness.rs`) was read as a cross-check of the constants and of the Tech
// 3341 cases, not copied.
//
// Cost: one pass over the mix, after it is mixed and before any encoder sees
// it — never per video frame. The only allocations are the per-100-ms block
// accumulators (one number per 100 ms of programme) and the limiter's
// constant-size gain delay line.

/** The integrated loudnesses the export offers to normalise to, in LUFS. */
export type LoudnessTarget = -14 | -16 | -23;

/**
 * −14 LUFS (the streaming platforms' reference), −16 (podcasts and mobile),
 * −23 (EBU R128 broadcast). Normalising is off by default; "off" is the absence
 * of a target, never a fourth value.
 */
export const LOUDNESS_TARGETS: readonly LoudnessTarget[] = [-14, -16, -23];

/** The ceiling the limiter holds a normalised mix's true peak to, in dBTP. */
export const TRUE_PEAK_CEILING_DBTP = -1;

/**
 * One of the three targets, or `undefined` for off — for a value read back
 * from storage or handed over by a caller the type system did not see (a
 * stale saved setting, a headless job spec), which must land on "off" rather
 * than on whatever number it carried.
 */
export function loudnessTargetOrOff(value: unknown): LoudnessTarget | undefined {
  return LOUDNESS_TARGETS.find((target) => target === value);
}

/** What `measureLoudness` reports. */
export interface LoudnessMeasurement {
  /** Gated integrated loudness in LUFS; −Infinity when no block passed the gates. */
  integratedLufs: number;
  /** The highest 4×-oversampled sample in any channel, in dBTP; −Infinity for digital silence. */
  truePeakDbtp: number;
  /** How many 400 ms blocks passed both gates — 0 exactly when `integratedLufs` is −Infinity. */
  gatedBlocks: number;
}

/** One biquad section, normalised so a0 = 1. */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The two K-weighting stages for `sampleRate`, derived by the bilinear
 * transform from their analog prototypes (the derivation libebur128 uses).
 */
export function kWeightingCoefficients(sampleRate: number): { pre: BiquadCoefficients; rlb: BiquadCoefficients } {
  // Stage 1: the high shelf.
  const f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const pre = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  // Stage 2: the RLB high-pass. Its numerator is (1, −2, 1) unnormalised,
  // which is how BS.1770-4 prints it.
  const f1 = 38.13547087602444;
  const q1 = 0.5003270373238773;
  const k1 = Math.tan((Math.PI * f1) / sampleRate);
  const a01 = 1 + k1 / q1 + k1 * k1;
  const rlb = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k1 * k1 - 1)) / a01,
    a2: (1 - k1 / q1 + k1 * k1) / a01,
  };
  return { pre, rlb };
}

/**
 * BS.1770-4's channel weight for channel `index` of a `count`-channel layout:
 * 1.0 for the fronts, 1.41 (≈ +1.5 dB) for the surrounds and 0 for an LFE,
 * in the usual L R C [LFE] Ls Rs order. Every other layout — mono and stereo,
 * which is everything the export mixes — weights every channel 1.0.
 */
function channelWeight(index: number, count: number): number {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41][index];
  if (count === 5) return [1, 1, 1, 1.41, 1.41][index];
  return 1;
}

/**
 * The channels of a mix as the meter and the limiter walk them: channel `c`
 * is `data[c][offset[c] + n * stride]` for frames `n = 0 … frames − 1`. One
 * shape for planar channels (stride 1) and for an interleaved buffer (stride
 * = channel count), so the export's interleaved mix is read in place instead
 * of being copied apart first.
 */
interface Lanes {
  data: readonly Float32Array[];
  offset: readonly number[];
  stride: number;
  frames: number;
}

function planarLanes(channels: readonly Float32Array[]): Lanes {
  let frames = channels.length > 0 ? Infinity : 0;
  for (const channel of channels) frames = Math.min(frames, channel.length);
  return { data: channels, offset: channels.map(() => 0), stride: 1, frames };
}

function interleavedLanes(data: Float32Array, channelCount: number): Lanes {
  const offset = Array.from({ length: channelCount }, (_, c) => c);
  return { data: offset.map(() => data), offset, stride: channelCount, frames: Math.floor(data.length / channelCount) };
}

// --- True peak: 4× oversampling --------------------------------------------

/** Half the interpolator's support: each in-between point reads 2·TAPS_HALF samples around it. */
const TAPS_HALF = 12;
const TAPS = 2 * TAPS_HALF;

/**
 * The three in-between phases (n + 1/4, n + 1/2, n + 3/4) of a Hann-windowed
 * sinc. Each holds the taps for samples n − TAPS_HALF + 1 … n + TAPS_HALF,
 * normalised to unit DC gain. Phase 0 is the sample itself.
 */
function phaseTaps(fraction: number): Float64Array {
  const taps = new Float64Array(TAPS);
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const u = fraction - (i - TAPS_HALF + 1);
    const sinc = Math.sin(Math.PI * u) / (Math.PI * u);
    const window = 0.5 + 0.5 * Math.cos((Math.PI * u) / TAPS_HALF);
    taps[i] = sinc * window;
    sum += taps[i];
  }
  for (let i = 0; i < TAPS; i++) taps[i] /= sum;
  return taps;
}
const QUARTER = phaseTaps(0.25);
const HALF = phaseTaps(0.5);
const THREE_QUARTERS = phaseTaps(0.75);

/**
 * The largest magnitude of channel `c` anywhere in [n, n + 1): the sample
 * itself and the three oversampled points after it, accumulated in one walk
 * over the window. Samples outside the programme read as silence.
 */
function forwardPeak(d: Float32Array, o: number, stride: number, frames: number, n: number): number {
  const first = n - TAPS_HALF + 1;
  let a = 0;
  let b = 0;
  let c = 0;
  if (first >= 0 && n + TAPS_HALF < frames) {
    for (let i = 0, at = o + first * stride; i < TAPS; i++, at += stride) {
      const x = d[at];
      a += QUARTER[i] * x;
      b += HALF[i] * x;
      c += THREE_QUARTERS[i] * x;
    }
  } else {
    for (let i = 0; i < TAPS; i++) {
      const m = first + i;
      const x = m >= 0 && m < frames ? d[o + m * stride] : 0;
      a += QUARTER[i] * x;
      b += HALF[i] * x;
      c += THREE_QUARTERS[i] * x;
    }
  }
  return Math.max(Math.abs(d[o + n * stride]), Math.abs(a), Math.abs(b), Math.abs(c));
}

/**
 * The most any oversampled point can exceed the largest sample it is built
 * from: the largest sum of |taps| of the three phases (≈ 2.3; at least 1,
 * since each phase sums to 1).
 */
const INTERPOLATION_GAIN = Math.max(
  ...[QUARTER, HALF, THREE_QUARTERS].map((taps) => taps.reduce((sum, t) => sum + Math.abs(t), 0))
);

/**
 * A cheap upper bound on |x| over every sample `forwardPeak(…, n)` reads, so
 * the 48 multiply-adds can be skipped wherever they cannot change the answer:
 * the meter skips a frame whose bound cannot beat the peak already found, the
 * limiter one whose bound cannot reach the ceiling. Without it the true-peak
 * read is ~90 % of the meter's cost; with it, a minute of speech-like stereo
 * meters in ~0.2 s and a minute of a steady tone (where nothing can be
 * skipped) in ~0.5 s (measured 2026-10-16, Node 26, x86_64).
 *
 * The bound is the largest sample of the aligned TAPS-sample chunk frame n is
 * in and of its two neighbours, which together contain [n − TAPS_HALF + 1,
 * n + TAPS_HALF]. Three rolling values, each chunk read once; frames must be
 * visited in order from 0.
 */
function windowBound(d: Float32Array, o: number, stride: number, frames: number): (n: number) => number {
  const chunkMax = (k: number) => {
    let max = 0;
    const end = Math.min(frames, (k + 1) * TAPS);
    for (let i = k * TAPS; i < end; i++) max = Math.max(max, Math.abs(d[o + i * stride]));
    return max;
  };
  let previous = 0;
  let current = 0;
  let next = chunkMax(0);
  return (n) => {
    if (n % TAPS === 0) {
      previous = current;
      current = next;
      next = chunkMax(n / TAPS + 1);
    }
    return INTERPOLATION_GAIN * Math.max(previous, current, next);
  };
}

// --- Measurement ------------------------------------------------------------

/** −70 LUFS as a mean-square energy: −0.691 + 10·log10(e) = −70. */
const ABSOLUTE_GATE_ENERGY = 10 ** ((-70 + 0.691) / 10);
/** The relative gate sits 10 LU below the absolute-gated mean: a factor of 0.1 in energy. */
const RELATIVE_GATE_FACTOR = 0.1;
/**
 * A constant far below anything audible (−400 dB) added to the filters'
 * input. Through a stretch of digital silence — every gap between clips —
 * the filter state would otherwise decay into subnormal numbers, which x86
 * CPUs process an order of magnitude slower. The RLB stage removes DC, so it
 * contributes no energy once the filters settle.
 */
const ANTI_DENORMAL = 1e-20;

function measure(lanes: Lanes, sampleRate: number): LoudnessMeasurement {
  const { data, offset, stride, frames } = lanes;
  const channelCount = data.length;
  const { pre, rlb } = kWeightingCoefficients(sampleRate);
  // 100 ms sub-blocks; a 400 ms gating block is four consecutive ones. A
  // trailing partial sub-block is not a whole block's worth and is dropped,
  // as BS.1770-4 drops a partial block.
  const subLength = Math.round(sampleRate * 0.1);
  const subCount = Math.floor(frames / subLength);
  const subEnergy = new Float64Array(subCount);
  let peak = 0;

  for (let c = 0; c < channelCount; c++) {
    const d = data[c];
    const weight = channelWeight(c, channelCount);
    // Transposed direct form II, one state pair per stage.
    let z1 = 0;
    let z2 = 0;
    let w1 = 0;
    let w2 = 0;
    let sum = 0;
    let inSub = 0;
    let sub = 0;
    const bound = windowBound(d, offset[c], stride, frames);
    for (let n = 0, at = offset[c]; n < frames; n++, at += stride) {
      const x = d[at] + ANTI_DENORMAL;
      const y = pre.b0 * x + z1;
      z1 = pre.b1 * x - pre.a1 * y + z2;
      z2 = pre.b2 * x - pre.a2 * y;
      const k = rlb.b0 * y + w1;
      w1 = rlb.b1 * y - rlb.a1 * k + w2;
      w2 = rlb.b2 * y - rlb.a2 * k;
      sum += k * k;
      if (++inSub === subLength) {
        subEnergy[sub++] += weight * sum;
        sum = 0;
        inSub = 0;
      }
      // The peak only grows, so a frame that cannot beat it changes nothing.
      if (bound(n) > peak) peak = Math.max(peak, forwardPeak(d, offset[c], stride, frames, n));
    }
  }

  // Each block's energy is the mean square over its four sub-blocks.
  const blockCount = Math.max(0, subCount - 3);
  const blockEnergy = (j: number) =>
    (subEnergy[j] + subEnergy[j + 1] + subEnergy[j + 2] + subEnergy[j + 3]) / (4 * subLength);

  let absoluteSum = 0;
  let absoluteCount = 0;
  for (let j = 0; j < blockCount; j++) {
    const e = blockEnergy(j);
    if (e > ABSOLUTE_GATE_ENERGY) {
      absoluteSum += e;
      absoluteCount++;
    }
  }

  const truePeakDbtp = 20 * Math.log10(peak);
  if (absoluteCount === 0) return { integratedLufs: -Infinity, truePeakDbtp, gatedBlocks: 0 };

  // At least the loudest block always clears a gate 10 LU below the mean, so
  // the second pass never comes back empty.
  const threshold = Math.max(ABSOLUTE_GATE_ENERGY, (absoluteSum / absoluteCount) * RELATIVE_GATE_FACTOR);
  let gatedSum = 0;
  let gatedBlocks = 0;
  for (let j = 0; j < blockCount; j++) {
    const e = blockEnergy(j);
    if (e > threshold) {
      gatedSum += e;
      gatedBlocks++;
    }
  }
  return { integratedLufs: -0.691 + 10 * Math.log10(gatedSum / gatedBlocks), truePeakDbtp, gatedBlocks };
}

/**
 * BS.1770-4 integrated loudness and true peak of planar `channels` (one array
 * per channel, L R [C …] order; extra length in a longer channel is ignored).
 */
export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessMeasurement {
  return measure(planarLanes(channels), sampleRate);
}

/** `measureLoudness` over an interleaved buffer — the export mix's own layout — read in place. */
export function measureInterleavedLoudness(
  data: Float32Array,
  channelCount: number,
  sampleRate: number
): LoudnessMeasurement {
  return measure(interleavedLanes(data, channelCount), sampleRate);
}

// --- Normalising ------------------------------------------------------------

/**
 * The gain that moves `measured` onto `targetLufs`, and whether applying it
 * would put the true peak above `ceilingDbtp` (so the limiter will engage).
 * A programme with no measurable loudness asks for no gain.
 */
export function gainForTarget(
  measured: LoudnessMeasurement,
  targetLufs: number,
  ceilingDbtp: number
): { gainDb: number; limited: boolean } {
  if (!Number.isFinite(measured.integratedLufs)) return { gainDb: 0, limited: false };
  const gainDb = targetLufs - measured.integratedLufs;
  return { gainDb, limited: measured.truePeakDbtp + gainDb > ceilingDbtp };
}

/** How long the limiter holds a reduction before letting go: 5 ms at 48 kHz, the export's rate. */
const HOLD_FRAMES = 240;
/** Per-frame release step toward unity: a 50 ms time constant at 48 kHz. */
const RELEASE = 1 - Math.exp(-1 / 2400);
/**
 * How far behind the detector the gain is written. The detector at frame n
 * reads samples up to TAPS_HALF either side of n, so every sample it reads
 * must still be the original when it reads it.
 */
const WRITE_LAG = TAPS_HALF + 1;

function gainWithLimiter(lanes: Lanes, gainDb: number, ceilingDbtp: number): void {
  const { data, offset, stride, frames } = lanes;
  const channelCount = data.length;
  const gain = 10 ** (gainDb / 20);
  const ceiling = 10 ** (ceilingDbtp / 20);
  const envelope = new Float64Array(WRITE_LAG + 1);
  let env = 1;
  let hold = 0;
  let previous = 0;
  // Below this (pre-gain) level nothing reaches the ceiling, so a channel whose
  // bound is under it needs no exact read: the bound itself stands in, which
  // keeps the required gain at 1 for this frame and the next exactly as the
  // exact read would.
  const quiet = ceiling / gain;
  const bounds = data.map((d, c) => windowBound(d, offset[c], stride, frames));

  const write = (m: number) => {
    const g = gain * envelope[m % (WRITE_LAG + 1)];
    for (let c = 0; c < channelCount; c++) data[c][offset[c] + m * stride] *= g;
  };

  for (let n = 0; n < frames; n++) {
    // Linked: one detector across every channel, so the stereo image holds.
    // Frame n's neighbourhood is [n − 1, n + 1), the two intervals it bounds.
    let forward = 0;
    for (let c = 0; c < channelCount; c++) {
      const bound = bounds[c](n);
      forward = Math.max(forward, bound <= quiet ? bound : forwardPeak(data[c], offset[c], stride, frames, n));
    }
    const truePeak = gain * Math.max(previous, forward);
    previous = forward;
    const required = truePeak > ceiling ? ceiling / truePeak : 1;
    if (required < env) {
      env = required;
      hold = HOLD_FRAMES;
    } else if (hold > 0) {
      hold--;
    } else {
      env = Math.min(required, env + (1 - env) * RELEASE);
    }
    envelope[n % (WRITE_LAG + 1)] = env;
    if (n >= WRITE_LAG) write(n - WRITE_LAG);
  }
  for (let m = Math.max(0, frames - WRITE_LAG); m < frames; m++) write(m);
}

/**
 * Apply `gainDb` to planar `channels` in place, through a true-peak limiter
 * that holds the result at or below `ceilingDbtp`.
 *
 * What the limiter is: stereo-linked (every channel takes the same gain),
 * instant attack, a 5 ms hold, then an exponential release with a 50 ms time
 * constant; no look-ahead beyond the interpolator's own few samples. Its
 * detector is the meter's 4×-oversampled peak of the gained signal around
 * each sample, so the *sample* peak is held exactly and the *true* peak to
 * within about 0.1 dB (the reduction lands on the loud sample itself, so the
 * samples just before it are a little less reduced). When nothing would pass
 * the ceiling it never engages and this is a plain gain.
 */
export function applyGainWithLimiter(channels: readonly Float32Array[], gainDb: number, ceilingDbtp: number): void {
  gainWithLimiter(planarLanes(channels), gainDb, ceilingDbtp);
}

/** `applyGainWithLimiter` over an interleaved buffer, in place. */
export function applyInterleavedGainWithLimiter(
  data: Float32Array,
  channelCount: number,
  gainDb: number,
  ceilingDbtp: number
): void {
  gainWithLimiter(interleavedLanes(data, channelCount), gainDb, ceilingDbtp);
}

// --- The export's one call --------------------------------------------------

/** What an export says about its sound, when it had any to measure. */
export interface ExportLoudness {
  /** The mix's integrated loudness as mixed, before any gain, in LUFS. */
  measuredLufs: number;
  /** The mix's true peak as mixed, before any gain, in dBTP. */
  truePeakDbtp: number;
  /** The gain applied: 0 with normalising off. */
  gainDb: number;
  /** The target normalised to, or null when normalising was off. */
  targetLufs: LoudnessTarget | null;
  /** Whether the limiter had to hold the gained mix under the −1 dBTP ceiling. */
  limited: boolean;
}

/**
 * Measure the export's interleaved mix and, when `target` is one of the
 * three, normalise it onto that target in place under the −1 dBTP ceiling.
 * `undefined` — nothing to say — for no mix at all and for a mix with no
 * measurable loudness (silence, or nothing above −70 LUFS for 400 ms), which
 * is left exactly as it is.
 */
export function exportLoudness(
  data: Float32Array | null,
  channelCount: number,
  sampleRate: number,
  target: unknown
): ExportLoudness | undefined {
  if (!data) return undefined;
  const measured = measureInterleavedLoudness(data, channelCount, sampleRate);
  if (measured.gatedBlocks === 0) return undefined;
  const base = { measuredLufs: measured.integratedLufs, truePeakDbtp: measured.truePeakDbtp };
  const targetLufs = loudnessTargetOrOff(target);
  if (targetLufs === undefined) return { ...base, gainDb: 0, targetLufs: null, limited: false };
  const { gainDb, limited } = gainForTarget(measured, targetLufs, TRUE_PEAK_CEILING_DBTP);
  if (limited) {
    applyInterleavedGainWithLimiter(data, channelCount, gainDb, TRUE_PEAK_CEILING_DBTP);
  } else {
    // The limiter's detector reads exactly the peaks the meter just measured,
    // so when the gained true peak is under the ceiling it could never engage:
    // a plain multiply gives the same samples without the detector's cost.
    const gain = 10 ** (gainDb / 20);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return { ...base, gainDb, targetLufs, limited };
}

/** One decimal, a real minus sign for a negative, `plus` before anything else (never "−0.0"). */
function signedTenth(value: number, plus: string): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded < 0 ? `−${(-rounded).toFixed(1)}` : `${plus}${rounded.toFixed(1)}`;
}

/**
 * The completion line: "Measured −18.3 LUFS", plus " · gain +4.3 dB" when a
 * target was applied and " · limited" when the limiter engaged.
 */
export function formatLoudnessSummary(loudness: ExportLoudness): string {
  const parts = [`Measured ${signedTenth(loudness.measuredLufs, '')} LUFS`];
  if (loudness.targetLufs !== null) parts.push(`gain ${signedTenth(loudness.gainDb, '+')} dB`);
  if (loudness.limited) parts.push('limited');
  return parts.join(' · ');
}
