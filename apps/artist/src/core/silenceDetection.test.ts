/**
 * Tests for silence detection (ESCSUITE-403).
 *
 * The fixtures are PCM run through `peaksFromPcm`, the bucketing every import
 * uses, at its 100 peaks a second: so these are the peaks a real recording
 * carries, not hand-made ones.
 */

import { describe, expect, it } from 'vitest';
import type { Clip, SourceVideo } from '../store/types';
import { DEFAULT_EFFECTS, DEFAULT_TRANSFORM, DEFAULT_TRANSITION } from '../store/types';
import { peaksFromPcm } from '../utils/waveformPeaks';
import {
  DEFAULT_SILENCE_OPTIONS,
  cutsFromSilences,
  detectSilences,
  findTakeSilences,
  intersectRanges,
  silentRuns,
  totalLength,
} from './silenceDetection';

const RATE = 48_000;
const PEAKS_PER_SECOND = 100;
/** The acceptance tolerance: every gap found within 50 ms of where it is. */
const TOLERANCE = 0.05;

/**
 * PCM of `[seconds, loud]` stretches in order: a 440 Hz tone at 0.8 of full
 * scale where `loud`, digital silence elsewhere.
 */
function speech(stretches: [number, boolean][]): Float32Array {
  const total = Math.round(stretches.reduce((sum, [s]) => sum + s, 0) * RATE);
  const pcm = new Float32Array(total);
  let at = 0;
  for (const [seconds, loud] of stretches) {
    const n = Math.round(seconds * RATE);
    if (loud) for (let i = 0; i < n; i++) pcm[at + i] = 0.8 * Math.sin((2 * Math.PI * 440 * (at + i)) / RATE);
    at += n;
  }
  return pcm;
}

const peaksOf = (pcm: Float32Array) => peaksFromPcm(pcm, RATE, PEAKS_PER_SECOND);

describe('detectSilences', () => {
  it('finds exactly the 2 s gaps between stretches of tone, within 50 ms', () => {
    // tone 0–3, silence 3–5, tone 5–7, silence 7–9, tone 9–10.
    const peaks = peaksOf(speech([[3, true], [2, false], [2, true], [2, false], [1, true]]));
    const gaps = detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, padding: 0 });
    expect(gaps).toHaveLength(2);
    expect(gaps[0].start).toBeCloseTo(3, 0);
    expect(Math.abs(gaps[0].start - 3)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 5)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[1].start - 7)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[1].end - 9)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('keeps the padding on both sides of every cut', () => {
    const peaks = peaksOf(speech([[1, true], [2, false], [1, true]]));
    const [gap] = detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, padding: 0.25 });
    expect(Math.abs(gap.start - 1.25)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gap.end - 2.75)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('never cuts a gap shorter than the minimum gap', () => {
    // A 0.5 s pause, then a 1 s one: only the second passes a 0.7 s minimum.
    const peaks = peaksOf(speech([[1, true], [0.5, false], [1, true], [1, false], [1, true]]));
    const gaps = detectSilences(peaks, PEAKS_PER_SECOND, DEFAULT_SILENCE_OPTIONS);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - (2.5 + 0.1))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - (3.5 - 0.1))).toBeLessThanOrEqual(TOLERANCE);
  });

  it('cuts nothing when the padding would eat the whole gap', () => {
    const peaks = peaksOf(speech([[1, true], [0.8, false], [1, true]]));
    expect(detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, padding: 0.4 })).toEqual([]);
  });

  it('counts sound under the threshold as silence, and sound over it as speech', () => {
    // A tone at 0.005 of full scale is -46 dBFS: silence at -40, sound at -50.
    const quiet = speech([[1, true], [2, true], [1, true]]);
    for (let i = RATE; i < 3 * RATE; i++) quiet[i] *= 0.005 / 0.8;
    const peaks = peaksOf(quiet);
    expect(detectSilences(peaks, PEAKS_PER_SECOND, DEFAULT_SILENCE_OPTIONS)).toHaveLength(1);
    expect(detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, thresholdDb: -50 })).toEqual([]);
  });

  it('looks only inside the window it is given, and clips a gap to it', () => {
    const peaks = peaksOf(speech([[1, true], [2, false], [1, true]]));
    const gaps = detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, padding: 0 }, { start: 2, end: 4 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(2, 5);
    expect(Math.abs(gaps[0].end - 3)).toBeLessThanOrEqual(TOLERANCE);
    // Inside the window, but shorter than the minimum gap once clipped to it.
    expect(detectSilences(peaks, PEAKS_PER_SECOND, DEFAULT_SILENCE_OPTIONS, { start: 2.5, end: 4 })).toEqual([]);
  });

  it('finds the silence at either end of a recording', () => {
    const peaks = peaksOf(speech([[1, false], [1, true], [1, false]]));
    const gaps = detectSilences(peaks, PEAKS_PER_SECOND, { ...DEFAULT_SILENCE_OPTIONS, padding: 0 });
    expect(gaps).toHaveLength(2);
    expect(gaps[0].start).toBe(0);
    expect(Math.abs(gaps[1].end - 3)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('has nothing to find without peaks', () => {
    expect(detectSilences([], PEAKS_PER_SECOND, DEFAULT_SILENCE_OPTIONS)).toEqual([]);
    expect(detectSilences(peaksOf(speech([[1, false]])), 0, DEFAULT_SILENCE_OPTIONS)).toEqual([]);
  });
});

describe('the range helpers', () => {
  it('silentRuns merges neighbouring quiet buckets into one run', () => {
    const peaks = [{ min: 0, max: 0 }, { min: -0.001, max: 0.001 }, { min: -0.5, max: 0.5 }, { min: 0, max: 0 }];
    expect(silentRuns(peaks, 10, -40)).toEqual([{ start: 0, end: 0.2 }, { start: 0.3, end: 0.4 }]);
  });

  it('cutsFromSilences drops a non-positive minimum gap to "any gap"', () => {
    expect(cutsFromSilences([{ start: 1, end: 1.1 }], { minGap: 0, padding: 0 })).toEqual([{ start: 1, end: 1.1 }]);
  });

  it('intersectRanges keeps only where both lists are silent', () => {
    expect(
      intersectRanges(
        [{ start: 0, end: 2 }, { start: 3, end: 6 }],
        [{ start: 1, end: 4 }, { start: 5, end: 7 }]
      )
    ).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 6 }]);
    expect(intersectRanges([{ start: 0, end: 1 }], [{ start: 1, end: 2 }])).toEqual([]);
  });

  it('totalLength adds up the ranges', () => {
    expect(totalLength([{ start: 0, end: 0.5 }, { start: 2, end: 3.25 }])).toBeCloseTo(1.75, 9);
  });
});

describe('findTakeSilences', () => {
  const clip = (id: string, sourceVideoId: string, at: number, from: number, to: number, linkGroupId?: string): Clip => ({
    id,
    sourceVideoId,
    name: id,
    startTime: from,
    endTime: to,
    duration: to - from,
    trackId: `t-${id}`,
    timelinePosition: at,
    blendMode: 'normal',
    transform: { ...DEFAULT_TRANSFORM },
    effects: { ...DEFAULT_EFFECTS },
    transition: { ...DEFAULT_TRANSITION },
    ...(linkGroupId ? { linkGroupId } : {}),
  });
  const source = (id: string, pcm: Float32Array | null, mediaType: 'video' | 'audio' = 'audio'): SourceVideo => ({
    id,
    name: id,
    duration: pcm ? pcm.length / RATE : 10,
    width: 0,
    height: 0,
    frameRate: 0,
    mimeType: 'audio/webm',
    size: 1,
    mediaType,
    hasAudio: pcm !== null,
    ...(pcm ? { waveformData: peaksOf(pcm) } : {}),
  });

  // Mic: tone 0–2, silence 2–4, tone 4–6. System audio: tone 0–3, silence 3–6.
  const mic = source('mic', speech([[2, true], [2, false], [2, true]]));
  const system = source('system', speech([[3, true], [3, false]]));
  const screen = source('screen', null, 'video');
  const options = { ...DEFAULT_SILENCE_OPTIONS, padding: 0 };

  it('maps a clip\'s silences from source time onto the timeline', () => {
    // The mic trimmed to 1–6 of its source and placed at 10 s on the timeline.
    const gaps = findTakeSilences([clip('m', 'mic', 10, 1, 6)], [mic], 'm', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 11)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 13)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('cuts a take only where every linked part with sound is silent', () => {
    const clips = [clip('s', 'screen', 0, 0, 6, 'g'), clip('m', 'mic', 0, 0, 6, 'g'), clip('y', 'system', 0, 0, 6, 'g')];
    const gaps = findTakeSilences(clips, [screen, mic, system], 's', options);
    // Mic silent 2–4, system audio 3–6: both only 3–4, which is over 0.7 s.
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 3)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 4)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('counts a part that has not started yet as silent there', () => {
    // The system audio starts 4 s into the take: before that only the mic speaks.
    const clips = [clip('m', 'mic', 0, 0, 6, 'g'), clip('y', 'system', 4, 0, 2, 'g')];
    const gaps = findTakeSilences(clips, [mic, system], 'm', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 2)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 4)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('finds nothing in a take with no sound to listen to, or for a clip that is not there', () => {
    expect(findTakeSilences([clip('s', 'screen', 0, 0, 6)], [screen], 's', options)).toEqual([]);
    expect(findTakeSilences([], [mic], 'missing', options)).toEqual([]);
  });
});
