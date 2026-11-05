// Silence detection for "Remove silences" (ESCSUITE-403).
//
// Reads the waveform peaks every import already computes (`utils/waveform.ts`,
// 100 min/max pairs a second of source), so it decodes nothing, fetches
// nothing and works the same in the offline single-file build. A peak bucket
// is silent when its loudest sample is under the threshold; a run of silent
// buckets at least `minGap` long is a pause, and the cut keeps `padding` of it
// on each side so a word is never clipped at its edge.
//
// Pure functions only: the dialog runs them, the store cuts what they find.

import type { Clip, SourceVideo, WaveformPeak } from '../store/types';

/** A stretch of time, in seconds; `end` is after `start`. */
export interface TimeRange {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** Under this level (dB relative to full scale) a bucket counts as silent. */
  thresholdDb: number;
  /** The shortest pause that is cut, in seconds. */
  minGap: number;
  /** How much of each pause is kept on either side of the cut, in seconds. */
  padding: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  thresholdDb: -40,
  minGap: 0.7,
  padding: 0.1,
};

/** Float slack when comparing a run's length with the minimum gap. */
const EPSILON = 1e-9;

/**
 * How long one peak of a library waveform lasts, in seconds of source.
 *
 * `extractWaveformData` makes 100 peaks a second nominally, but its bucketing
 * (`peaksFromPcm`, which the streamed reducer equals) puts
 * `floor(length / ceil(length / q))` samples in a bucket, q = sampleRate / 100.
 * For any track not an exact multiple of q long and over ~5 s that is q − 1
 * samples: 479 at 48 kHz, 0.2 % short of 10 ms. Read as
 * `peaks.length / duration` (≈ 10 ms) the peaks drift late by 2 ms a second,
 * so a pause 100 s in sat 0.2 s late — twice the default padding, and the cut
 * clipped the next word. 48 kHz is Opus's only rate (every CRAFT WebM) and the
 * usual AAC one; a 44.1 kHz track is left 0.02 % out (≈ 20 ms per 100 s).
 */
export const SECONDS_PER_PEAK = 0.01 - 1 / 48_000;

/**
 * The silent runs in `peaks`, in the peaks' own seconds, clipped to `within`.
 * Bucket `i` covers `[i, i + 1) / peaksPerSecond`.
 */
export function silentRuns(
  peaks: readonly WaveformPeak[],
  peaksPerSecond: number,
  thresholdDb: number,
  within: TimeRange = { start: 0, end: peaks.length / peaksPerSecond }
): TimeRange[] {
  if (peaks.length === 0 || !(peaksPerSecond > 0)) return [];
  const level = Math.pow(10, thresholdDb / 20);
  const first = Math.max(0, Math.floor(within.start * peaksPerSecond));
  const last = Math.min(peaks.length, Math.ceil(within.end * peaksPerSecond));
  const runs: TimeRange[] = [];
  let runStart = -1;
  for (let i = first; i <= last; i++) {
    const silent = i < last && Math.max(Math.abs(peaks[i].min), Math.abs(peaks[i].max)) < level;
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      const start = Math.max(within.start, runStart / peaksPerSecond);
      const end = Math.min(within.end, i / peaksPerSecond);
      if (end > start) runs.push({ start, end });
      runStart = -1;
    }
  }
  return runs;
}

/**
 * The cuts to make in `runs`: every run at least `minGap` long, less `padding`
 * on each side. A run the padding would close up entirely is left alone.
 */
export function cutsFromSilences(runs: readonly TimeRange[], { minGap, padding }: Pick<SilenceOptions, 'minGap' | 'padding'>): TimeRange[] {
  const pad = Math.max(0, padding);
  const cuts: TimeRange[] = [];
  for (const run of runs) {
    if (run.end - run.start < minGap - EPSILON) continue;
    const start = run.start + pad;
    const end = run.end - pad;
    if (end - start > EPSILON) cuts.push({ start, end });
  }
  return cuts;
}

/** Where both sorted, non-overlapping lists of ranges hold. */
export function intersectRanges(a: readonly TimeRange[], b: readonly TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

/** The ranges' total length, in seconds. */
export function totalLength(ranges: readonly TimeRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** The cuts for one recording's peaks, in its own seconds, within `within` when given. */
export function detectSilences(
  peaks: readonly WaveformPeak[],
  peaksPerSecond: number,
  options: SilenceOptions,
  within?: TimeRange
): TimeRange[] {
  return cutsFromSilences(silentRuns(peaks, peaksPerSecond, options.thresholdDb, within), options);
}

/** The peaks a clip's waveform is drawn from, if its source has any. */
function peaksOfSource(source: SourceVideo | undefined): { peaks: WaveformPeak[]; perSecond: number } | null {
  const peaks = source?.waveformData;
  if (!source || !source.hasAudio || !peaks?.length) return null;
  return { peaks, perSecond: 1 / SECONDS_PER_PEAK };
}

/** Whether a clip's source carries peaks that silence detection can read. */
export function clipHasPeaks(clip: Clip, sources: readonly SourceVideo[]): boolean {
  return !clip.overlayType && peaksOfSource(sources.find((s) => s.id === clip.sourceVideoId)) !== null;
}

/**
 * The cuts to make in `clipId`'s stretch of the timeline, in timeline seconds.
 *
 * A take recorded as separate tracks has its sound on more than one clip (the
 * microphone, the system audio, a screen part with sound), so a stretch is a
 * pause only where **every** clip linked to `clipId` that has sound is silent;
 * where a part has no clip at all it is silent by definition. A part whose
 * source has sound (`hasAudio`) but no peaks to read (its waveform could not
 * be decoded) is never silent within its clip: what it says there is unknown,
 * so nothing there is cut. Detection runs on the silent runs, before the
 * minimum gap and the padding apply, so a pause both parts share is judged by
 * its shared length.
 */
export function findTakeSilences(
  clips: readonly Clip[],
  sources: readonly SourceVideo[],
  clipId: string,
  options: SilenceOptions
): TimeRange[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return [];
  const span: TimeRange = { start: target.timelinePosition, end: target.timelinePosition + target.duration };
  const members = target.linkGroupId ? clips.filter((c) => c.linkGroupId === target.linkGroupId) : [target];

  let silent: TimeRange[] | null = null;
  for (const member of members) {
    if (member.overlayType) continue;
    const source = sources.find((s) => s.id === member.sourceVideoId);
    const audio = peaksOfSource(source);
    if (!audio && !source?.hasAudio) continue;
    // Source time to timeline time for this clip.
    const shift = member.timelinePosition - member.startTime;
    const from = Math.max(span.start, member.timelinePosition);
    const to = Math.min(span.end, member.timelinePosition + member.duration);
    const runs: TimeRange[] = [];
    if (from > span.start) runs.push({ start: span.start, end: Math.min(from, span.end) });
    if (to > from && audio) {
      for (const run of silentRuns(audio.peaks, audio.perSecond, options.thresholdDb, { start: from - shift, end: to - shift })) {
        runs.push({ start: run.start + shift, end: run.end + shift });
      }
    }
    if (to < span.end) runs.push({ start: Math.max(to, span.start), end: span.end });
    silent = silent ? intersectRanges(silent, mergeTouching(runs)) : mergeTouching(runs);
  }
  return silent ? cutsFromSilences(silent, options) : [];
}

/** Sorted ranges with any that touch or overlap joined into one. */
function mergeTouching(ranges: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPSILON) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
