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

import type { Clip, SourceVideo, Track, WaveformPeak } from '../store/types';
import { linkedRows } from '../store/rippleRanges';
import { isVisibleTrack } from '../store/trackVisibility';
import { peakTimingOf, type PeakTiming } from '../utils/peakTiming';

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
 * The silent runs in `peaks`, in the peaks' own seconds, clipped to `within`.
 * Bucket `i` covers `[i, i + 1) / peaksPerSecond`.
 */
export function silentRuns(
  peaks: readonly WaveformPeak[],
  peaksPerSecond: number,
  thresholdDb: number,
  within: TimeRange = { start: 0, end: peaks.length / peaksPerSecond }
): TimeRange[] {
  if (!(peaksPerSecond > 0)) return [];
  const at = (i: number) => i / peaksPerSecond;
  const buckets = { first: Math.floor(within.start * peaksPerSecond), last: Math.ceil(within.end * peaksPerSecond) };
  return runsOver(peaks, thresholdDb, within, buckets, at, at);
}

/**
 * The stretches of source time, within `within`, that are silent in `peaks`
 * however long a peak really lasts within `timing` (`utils/peakTiming.ts`).
 * A silent run of buckets `[i, j)` starts at `i · max` at the latest and ends
 * at `j · min` at the earliest, so only that much of it is certainly silent;
 * with exact timing that is the run itself. A run that leaves nothing certain
 * is dropped, so wrong timing can only cut less, never into sound.
 */
export function certainSilentRuns(
  peaks: readonly WaveformPeak[],
  timing: Pick<PeakTiming, 'min' | 'max'>,
  thresholdDb: number,
  within: TimeRange
): TimeRange[] {
  if (!(timing.min > 0) || !(timing.max >= timing.min)) return [];
  const buckets = { first: Math.floor(within.start / timing.max), last: Math.ceil(within.end / timing.min) };
  return runsOver(peaks, thresholdDb, within, buckets, (i) => i * timing.max, (i) => i * timing.min);
}

/**
 * Silent runs of buckets `[i, j)` of `peaks` as `[startOf(i), endOf(j))`,
 * clipped to `within`. `buckets` are every bucket that may overlap `within`:
 * from the first that can hold its start to the last that can hold its end.
 */
function runsOver(
  peaks: readonly WaveformPeak[],
  thresholdDb: number,
  within: TimeRange,
  buckets: { first: number; last: number },
  startOf: (index: number) => number,
  endOf: (index: number) => number
): TimeRange[] {
  if (peaks.length === 0) return [];
  const level = Math.pow(10, thresholdDb / 20);
  const first = Math.max(0, buckets.first);
  const last = Math.min(peaks.length, buckets.last);
  const runs: TimeRange[] = [];
  let runStart = -1;
  for (let i = first; i <= last; i++) {
    const silent = i < last && Math.max(Math.abs(peaks[i].min), Math.abs(peaks[i].max)) < level;
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      const start = Math.max(within.start, startOf(runStart));
      const end = Math.min(within.end, endOf(i));
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

/** A source's peaks and how long each lasts, if it has peaks to read. */
function peaksOfSource(source: SourceVideo | undefined): { peaks: WaveformPeak[]; timing: PeakTiming } | null {
  const peaks = source?.waveformData;
  if (!source || !source.hasAudio || !peaks?.length) return null;
  return { peaks, timing: peakTimingOf(source) };
}

/** Whether a clip's source carries peaks that silence detection can read. */
export function clipHasPeaks(clip: Clip, sources: readonly SourceVideo[]): boolean {
  return !clip.overlayType && peaksOfSource(sources.find((s) => s.id === clip.sourceVideoId)) !== null;
}

/**
 * The clips a cut through `target`'s span has to be judged against: every clip
 * with sound (`hasAudio`) that overlaps the span on any row the cut moves
 * (`linkedRows`, the rows `removeTimeRanges` cuts). Not only the target's own
 * link group: a music bed or a voice-over on a partner's row, or a clip on a
 * row a later piece's link reaches, is cut too, so it is listened to too. An
 * overlay, and a clip whose source has no sound, has nothing to listen to.
 *
 * Only what the export plays is heard (ESCSUITE-435): a clip on a muted or a
 * hidden row, or on a row that is gone, is skipped, as `audioMixer`'s
 * `mixInto` skips it. It is still cut and moved with the take; it just does
 * not stop a pause being a pause.
 */
function listenedClips(
  clips: readonly Clip[],
  tracks: readonly Track[],
  sources: readonly SourceVideo[],
  target: Clip
): { clip: Clip; source: SourceVideo }[] {
  const rows = linkedRows(clips, target);
  const spanEnd = target.timelinePosition + target.duration;
  const listened: { clip: Clip; source: SourceVideo }[] = [];
  for (const clip of clips) {
    if (!rows.has(clip.trackId) || clip.overlayType) continue;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track || track.muted || !isVisibleTrack(track)) continue;
    if (clip.timelinePosition >= spanEnd || clip.timelinePosition + clip.duration <= target.timelinePosition) continue;
    const source = sources.find((s) => s.id === clip.sourceVideoId);
    if (source?.hasAudio) listened.push({ clip, source });
  }
  return listened;
}

/**
 * Whether any clip `findTakeSilences(…, clipId, …)` listens to has peaks made
 * before their length was recorded (`peakTimingOf`), so pauses late in it may
 * be left in rather than placed exactly.
 */
export function hasApproximateTiming(
  clips: readonly Clip[],
  tracks: readonly Track[],
  sources: readonly SourceVideo[],
  clipId: string
): boolean {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return false;
  return listenedClips(clips, tracks, sources, target).some(({ source }) => {
    const audio = peaksOfSource(source);
    return audio !== null && !audio.timing.exact;
  });
}

/**
 * Whether `clipId` is on the timeline but nothing `findTakeSilences` would
 * listen to plays: every clip with sound the cut touches is on a muted or a
 * hidden row (ESCSUITE-435). There is then no audible sound to judge, and
 * nothing is found.
 */
export function nothingAudible(
  clips: readonly Clip[],
  tracks: readonly Track[],
  sources: readonly SourceVideo[],
  clipId: string
): boolean {
  const target = clips.find((c) => c.id === clipId);
  return target !== undefined && listenedClips(clips, tracks, sources, target).length === 0;
}

/**
 * The cuts to make in `clipId`'s stretch of the timeline, in timeline seconds.
 *
 * A stretch is a pause only where **every** clip the cut would touch that has
 * sound is silent (`listenedClips`: the take's other parts — the microphone,
 * the system audio, a screen part with sound — and anything else on the rows
 * it moves, on a row that plays); where such a clip is absent, muted or
 * hidden it does not speak. A clip whose
 * source has sound (`hasAudio`) but no peaks to read (its waveform could not
 * be decoded) is never silent within its span: what it says there is unknown,
 * so nothing there is cut. Peaks are placed by `peakTimingOf`, and only what is
 * silent whatever their exact length is counted (`certainSilentRuns`).
 * Detection runs on the silent runs, before the minimum gap and the padding
 * apply, so a pause every clip shares is judged by its shared length.
 */
export function findTakeSilences(
  clips: readonly Clip[],
  tracks: readonly Track[],
  sources: readonly SourceVideo[],
  clipId: string,
  options: SilenceOptions
): TimeRange[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return [];
  const span: TimeRange = { start: target.timelinePosition, end: target.timelinePosition + target.duration };

  let silent: TimeRange[] | null = null;
  for (const { clip, source } of listenedClips(clips, tracks, sources, target)) {
    const audio = peaksOfSource(source);
    // Source time to timeline time for this clip.
    const shift = clip.timelinePosition - clip.startTime;
    const from = Math.max(span.start, clip.timelinePosition);
    const to = Math.min(span.end, clip.timelinePosition + clip.duration);
    const runs: TimeRange[] = [];
    if (from > span.start) runs.push({ start: span.start, end: from });
    if (audio) {
      for (const run of certainSilentRuns(audio.peaks, audio.timing, options.thresholdDb, { start: from - shift, end: to - shift })) {
        runs.push({ start: run.start + shift, end: run.end + shift });
      }
    }
    if (to < span.end) runs.push({ start: to, end: span.end });
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
