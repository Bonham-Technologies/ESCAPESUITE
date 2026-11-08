/**
 * Tests for silence detection (ESCSUITE-403).
 *
 * The fixtures are PCM run through `peaksFromPcm`, the bucketing every import
 * uses, at its 100 peaks a second: so these are the peaks a real recording
 * carries, not hand-made ones.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Clip, SourceVideo, WaveformPeak } from '../store/types';
import { DEFAULT_EFFECTS, DEFAULT_TRANSFORM, DEFAULT_TRANSITION } from '../store/types';
import { linkedRows } from '../store/rippleRanges';
import { PeakReducer, peakSecondsFor, peaksFromPcm } from '../utils/waveformPeaks';
import { peakTimingOf } from '../utils/peakTiming';
import {
  DEFAULT_SILENCE_OPTIONS,
  certainSilentRuns,
  cutsFromSilences,
  detectSilences,
  findTakeSilences,
  hasApproximateTiming,
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

/** A clip of `sourceVideoId` from `from` to `to` of it, at `at` on the timeline, on row `t-<id>` unless `trackId` says. */
function clip(id: string, sourceVideoId: string, at: number, from: number, to: number, linkGroupId?: string, trackId = `t-${id}`): Clip {
  return {
    id,
    sourceVideoId,
    name: id,
    startTime: from,
    endTime: to,
    duration: to - from,
    trackId,
    timelinePosition: at,
    blendMode: 'normal',
    transform: { ...DEFAULT_TRANSFORM },
    effects: { ...DEFAULT_EFFECTS },
    transition: { ...DEFAULT_TRANSITION },
    ...(linkGroupId ? { linkGroupId } : {}),
  };
}

/** A library source with `pcm`'s peaks (48 kHz) and their recorded length, or one with no peaks. */
function source(id: string, pcm: Float32Array | null, mediaType: 'video' | 'audio' = 'audio'): SourceVideo {
  return {
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
    ...(pcm ? { waveformData: peaksOf(pcm), waveformSecondsPerPeak: peakSecondsFor(pcm.length, RATE, PEAKS_PER_SECOND) } : {}),
  };
}

describe('findTakeSilences', () => {

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

  it('places a pause minutes into a recording where it is, not where 100 peaks a second would put it', () => {
    // A recording that is not a whole number of 10 ms buckets long. Its peaks
    // were 479 samples each at 48 kHz before ESCSUITE-418 (480 since), and
    // reading those as 10 ms each put this pause 0.2 s late — past the
    // padding, into the word after it. Read by their recorded length, either
    // bucketing places it.
    const seconds = 120.013;
    const pcm = new Float32Array(Math.round(seconds * RATE));
    for (let i = 0; i < pcm.length; i++) {
      const t = i / RATE;
      if (t < 100 || t >= 102) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
    const long = source('long', pcm);
    const gaps = findTakeSilences([clip('l', 'long', 0, 0, seconds)], [long], 'l', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 100)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 102)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('cuts nothing where a part has sound it cannot read', () => {
    // The system audio has sound but no waveform (its decode failed): what it
    // says during the mic's pause is unknown, so the pause is not cut there.
    const unread: SourceVideo = { ...source('unread', null), hasAudio: true };
    const clips = [clip('m', 'mic', 0, 0, 6, 'g'), clip('u', 'unread', 0, 0, 6, 'g')];
    expect(findTakeSilences(clips, [mic, unread], 'm', options)).toEqual([]);
    // Where that part has no clip, the mic alone decides.
    const later = [clip('m', 'mic', 0, 0, 6, 'g'), clip('u', 'unread', 4, 0, 2, 'g')];
    const gaps = findTakeSilences(later, [mic, unread], 'm', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 2)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 4)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('finds nothing in a take with no sound to listen to, or for a clip that is not there', () => {
    expect(findTakeSilences([clip('s', 'screen', 0, 0, 6)], [screen], 's', options)).toEqual([]);
    expect(findTakeSilences([], [mic], 'missing', options)).toEqual([]);
  });
});

/**
 * A long track's peaks as an import makes them: PCM at `rate`, `seconds` long,
 * at half scale except in `pauses` (digital silence), streamed through
 * `PeakReducer` a second at a time so ten minutes cost no more than a chunk.
 */
function streamedTrack(rate: number, seconds: number, pauses: [number, number][]): { peaks: WaveformPeak[]; secondsPerPeak: number } {
  const reducer = new PeakReducer(rate, PEAKS_PER_SECOND);
  const total = Math.round(seconds * rate);
  const quiet = pauses.map(([a, b]) => [Math.round(a * rate), Math.round(b * rate)]);
  const chunk = new Float32Array(rate);
  for (let at = 0; at < total; at += rate) {
    const n = Math.min(rate, total - at);
    // Whole-range fills, not a test per sample: ten minutes at 48 kHz is 29
    // million samples, which a per-sample closure took past the 5 s timeout.
    chunk.fill(0.5, 0, n);
    for (const [a, b] of quiet) {
      const from = Math.max(a, at) - at;
      const to = Math.min(b, at + n) - at;
      if (to > from) chunk.fill(0, from, to);
    }
    reducer.push([chunk.subarray(0, n)]);
  }
  const peaks = reducer.finish();
  return { peaks, secondsPerPeak: reducer.secondsPerPeak! };
}

function trackSource(id: string, track: { peaks: WaveformPeak[]; secondsPerPeak: number }, seconds: number, recorded = true): SourceVideo {
  return {
    id,
    name: id,
    duration: seconds,
    width: 0,
    height: 0,
    frameRate: 0,
    mimeType: 'audio/webm',
    size: 1,
    mediaType: 'audio',
    hasAudio: true,
    waveformData: track.peaks,
    ...(recorded ? { waveformSecondsPerPeak: track.secondsPerPeak } : {}),
  };
}

/** Whether every cut lies inside one of the pauses: nothing heard is cut. */
function insidePauses(cuts: { start: number; end: number }[], pauses: [number, number][]): boolean {
  return cuts.every((cut) => pauses.some(([a, b]) => cut.start >= a - 1e-9 && cut.end <= b + 1e-9));
}

// Each case streams ten minutes of PCM through the real PeakReducer: about 2 s
// under coverage here, more on a shared CI runner, so these get 20 s each.
describe('findTakeSilences: peak timing at every sample rate (ESCSUITE-403)', { timeout: 20_000 }, () => {
  // A pause 590–592 s into a ten-minute track. Every rate's peaks last a
  // different, not-quite-10 ms time; read at the wrong one, this pause moved
  // by up to 2.5 s and the cut took the speech either side of it.
  const PAUSE: [number, number] = [590, 592];
  const cases: [string, number, number][] = [
    ['44.1 kHz', 44_100, 600.013],
    ['32 kHz', 32_000, 600.013],
    ['16 kHz (decodeAudioData resampling to a headset)', 16_000, 600.013],
    ['48 kHz', 48_000, 600.013],
    ['48 kHz, a whole number of 10 ms long', 48_000, 600],
  ];

  for (const [name, rate, seconds] of cases) {
    it(`places a pause 590 s into a ${name} track within 50 ms, cutting nothing heard`, () => {
      const track = streamedTrack(rate, seconds, [PAUSE]);
      const long = trackSource('long', track, seconds);
      const gaps = findTakeSilences([clip('l', 'long', 0, 0, seconds)], [long], 'l', DEFAULT_SILENCE_OPTIONS);
      expect(gaps).toHaveLength(1);
      expect(Math.abs(gaps[0].start - (PAUSE[0] + 0.1))).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(gaps[0].end - (PAUSE[1] - 0.1))).toBeLessThanOrEqual(TOLERANCE);
      // The padding is kept on both sides, not only "roughly".
      expect(gaps[0].start).toBeGreaterThanOrEqual(PAUSE[0] + 0.1 - 1e-9);
      expect(gaps[0].end).toBeLessThanOrEqual(PAUSE[1] - 0.1 + 1e-9);
      expect(hasApproximateTiming([clip('l', 'long', 0, 0, seconds)], [long], 'l')).toBe(false);
    });
  }

  it('reads peaks the whole-file fallback made the same way', () => {
    // decodeAudioData's path: `peaksFromPcm` over the whole buffer at the rate it resampled to.
    const rate = 16_000;
    const seconds = 300.013;
    const pcm = new Float32Array(Math.round(seconds * rate)).fill(0.5);
    pcm.fill(0, 290 * rate, 292 * rate);
    const peaks = peaksFromPcm(pcm, rate, PEAKS_PER_SECOND);
    const long = trackSource('long', { peaks, secondsPerPeak: peakSecondsFor(pcm.length, rate, PEAKS_PER_SECOND)! }, seconds);
    const [gap] = findTakeSilences([clip('l', 'long', 0, 0, seconds)], [long], 'l', DEFAULT_SILENCE_OPTIONS);
    expect(Math.abs(gap.start - 290.1)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gap.end - 291.9)).toBeLessThanOrEqual(TOLERANCE);
  });

  describe('peaks with no recorded length (made before ESCSUITE-403)', () => {
    const EARLY: [number, number] = [10, 12];
    for (const [name, rate, seconds] of cases) {
      it(`never cuts into sound at ${name}: an early pause is found, a late one left in`, () => {
        const track = streamedTrack(rate, seconds, [EARLY, PAUSE]);
        const legacy = trackSource('legacy', track, seconds, false);
        const clips = [clip('l', 'legacy', 0, 0, seconds)];
        const gaps = findTakeSilences(clips, [legacy], 'l', DEFAULT_SILENCE_OPTIONS);
        expect(insidePauses(gaps, [EARLY, PAUSE])).toBe(true);
        // Every cut still keeps the padding, at the worst-case timing.
        for (const gap of gaps) {
          const pause = [EARLY, PAUSE].find(([a, b]) => gap.start >= a && gap.end <= b)!;
          expect(gap.start - pause[0]).toBeGreaterThanOrEqual(0.1 - 1e-9);
          expect(pause[1] - gap.end).toBeGreaterThanOrEqual(0.1 - 1e-9);
        }
        expect(gaps).toHaveLength(1);
        expect(gaps[0].start).toBeLessThan(EARLY[1]);
        expect(hasApproximateTiming(clips, [legacy], 'l')).toBe(true);
      });
    }

    it('reads a recorded length no extractor could write as if it were absent', () => {
      expect(peakTimingOf({ waveformSecondsPerPeak: 0.02 }).exact).toBe(false);
      expect(peakTimingOf({ waveformSecondsPerPeak: Number.NaN }).exact).toBe(false);
      expect(peakTimingOf({}).exact).toBe(false);
      expect(peakTimingOf({ waveformSecondsPerPeak: 479 / 48_000 })).toEqual({ min: 479 / 48_000, max: 479 / 48_000, estimate: 479 / 48_000, exact: true });
    });
  });

  it('certainSilentRuns keeps only what is silent at either end of the timing range', () => {
    const peaks = [{ min: 0, max: 0.5 }, ...Array.from({ length: 98 }, () => ({ min: 0, max: 0 })), { min: 0, max: 0.5 }];
    // Buckets 1–98 silent: at 9–11 ms a bucket, certainly silent from 11 ms to 891 ms.
    const [run] = certainSilentRuns(peaks, { min: 0.009, max: 0.011 }, -40, { start: 0, end: 2 });
    expect(run.start).toBeCloseTo(0.011, 9);
    expect(run.end).toBeCloseTo(0.891, 9);
    expect(certainSilentRuns(peaks, { min: 0, max: 0.01 }, -40, { start: 0, end: 1 })).toEqual([]);
    expect(certainSilentRuns([], { min: 0.01, max: 0.01 }, -40, { start: 0, end: 1 })).toEqual([]);
  });
});

describe('findTakeSilences: every clip the cut touches is listened to (ESCSUITE-403)', () => {
  // Mic: tone 0–2, silence 2–4, tone 4–6. System audio: tone 0–3, silence 3–6.
  const mic = source('mic', speech([[2, true], [2, false], [2, true]]));
  const system = source('system', speech([[3, true], [3, false]]));
  // Music: tone throughout.
  const music = source('music', speech([[6, true]]));
  const screen = source('screen', null, 'video');
  const options = { ...DEFAULT_SILENCE_OPTIONS, padding: 0 };

  it("hears a music bed on a partner's row where the partner itself is absent", () => {
    // The system audio (linked) starts at 4 s on row Y; a music clip sits on
    // row Y before it, 0–2.5 s. Cutting the mic's pause would cut the music too.
    const clips = [
      clip('m', 'mic', 0, 0, 6, 'g', 'M'),
      clip('y', 'system', 4, 0, 2, 'g', 'Y'),
      clip('b', 'music', 0, 0, 2.5, undefined, 'Y'),
    ];
    const gaps = findTakeSilences(clips, [mic, system, music], 'm', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 2.5)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(gaps[0].end - 4)).toBeLessThanOrEqual(TOLERANCE);
    // Speaking through the whole pause, it leaves nothing to cut.
    const throughout = [...clips.slice(0, 2), clip('b', 'music', 0, 0, 3.9, undefined, 'Y')];
    expect(findTakeSilences(throughout, [mic, system, music], 'm', options)).toEqual([]);
  });

  it('hears an unlinked clip on a row only a later piece\'s link reaches', () => {
    // m (row M) and s (row S) are one group; s2 after s on row S is linked to
    // m2 on row C, so the cut moves row C as well (`linkedRows`). Music on row
    // C plays through the mic's pause.
    const clips = [
      clip('m', 'mic', 0, 0, 6, 'g1', 'M'),
      clip('s', 'screen', 0, 0, 6, 'g1', 'S'),
      clip('s2', 'screen', 6, 6, 8, 'g2', 'S'),
      clip('m2', 'system', 6, 0, 2, 'g2', 'C'),
      clip('x', 'music', 1, 0, 4, undefined, 'C'),
    ];
    expect(linkedRows(clips, clips[0]).has('C')).toBe(true);
    expect(findTakeSilences(clips, [mic, screen, system, music], 'm', options)).toEqual([]);
    // A row no link reaches is not cut, so its music does not stop the cut.
    const elsewhere = clips.map((c) => (c.id === 'x' ? { ...c, trackId: 'E' } : c));
    expect(findTakeSilences(elsewhere, [mic, screen, system, music], 'm', options)).toHaveLength(1);
  });

  it('is not stopped by a silent video-only clip on a touched row', () => {
    const clips = [clip('m', 'mic', 0, 0, 6, 'g', 'M'), clip('y', 'system', 4, 0, 2, 'g', 'Y'), clip('v', 'screen', 0, 0, 4, undefined, 'Y')];
    const gaps = findTakeSilences(clips, [mic, system, screen], 'm', options);
    expect(gaps).toHaveLength(1);
    expect(Math.abs(gaps[0].start - 2)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('cuts nothing over a clip on a touched row with sound it cannot read', () => {
    const unread: SourceVideo = { ...source('unread', null), hasAudio: true };
    const clips = [clip('m', 'mic', 0, 0, 6, 'g', 'M'), clip('y', 'system', 4, 0, 2, 'g', 'Y'), clip('u', 'unread', 1, 0, 3.5, undefined, 'Y')];
    expect(findTakeSilences(clips, [mic, system, unread], 'm', options)).toEqual([]);
  });

  it('never cuts where any audible clip on a touched row has sound (property)', () => {
    // Up to four rows of clips, some linked, each a 10 peaks-a-second source
    // of random loud and quiet buckets (or no sound, or sound it cannot read).
    const ROWS = ['A', 'B', 'C', 'D'];
    const PPS = 100;
    const level = Math.pow(10, DEFAULT_SILENCE_OPTIONS.thresholdDb / 20);
    const sourceArb = fc.record({
      kind: fc.constantFrom('peaks', 'peaks', 'peaks', 'mute', 'unread'),
      loud: fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
    });
    const clipArb = fc.record({
      row: fc.constantFrom(...ROWS),
      at: fc.integer({ min: 0, max: 60 }).map((n) => n / 10),
      length: fc.integer({ min: 5, max: 40 }).map((n) => n / 10),
      group: fc.option(fc.constantFrom('g1', 'g2', 'g3'), { nil: undefined }),
      source: sourceArb,
    });
    let cutSomething = 0;
    fc.assert(
      fc.property(fc.array(clipArb, { minLength: 1, maxLength: 8 }), fc.nat(), fc.integer({ min: 0, max: 10 }), (specs, pick, gap) => {
        const sources: SourceVideo[] = [];
        const clips: Clip[] = [];
        const ends = new Map<string, number>();
        specs.forEach((spec, i) => {
          // Rows never overlap: each clip starts after the last one on its row.
          const at = Math.max(spec.at, ends.get(spec.row) ?? 0);
          ends.set(spec.row, at + spec.length);
          // Each bucket of 0.1 s of source is loud or quiet, ten peaks a bucket.
          const peaks = spec.source.loud.flatMap((loud) => Array.from({ length: 10 }, () => (loud ? { min: -0.5, max: 0.5 } : { min: 0, max: 0 })));
          sources.push({
            ...source(`src${i}`, null),
            hasAudio: spec.source.kind !== 'mute',
            ...(spec.source.kind === 'peaks' ? { waveformData: peaks, waveformSecondsPerPeak: 1 / PPS } : {}),
          });
          clips.push(clip(`c${i}`, `src${i}`, at, 0, spec.length, spec.group, spec.row));
        });
        const target = clips[pick % clips.length];
        const options = { thresholdDb: DEFAULT_SILENCE_OPTIONS.thresholdDb, minGap: gap / 10, padding: 0 };
        const cuts = findTakeSilences(clips, sources, target.id, options);
        const rows = linkedRows(clips, target);
        if (cuts.length > 0) cutSomething++;
        for (const cut of cuts) {
          expect(cut.start).toBeGreaterThanOrEqual(target.timelinePosition - 1e-9);
          expect(cut.end).toBeLessThanOrEqual(target.timelinePosition + target.duration + 1e-9);
          for (const c of clips) {
            if (!rows.has(c.trackId)) continue;
            const from = Math.max(cut.start, c.timelinePosition) + 1e-7;
            const to = Math.min(cut.end, c.timelinePosition + c.duration) - 1e-7;
            if (to <= from) continue;
            const src = sources.find((s) => s.id === c.sourceVideoId)!;
            if (!src.hasAudio) continue;
            expect(src.waveformData, `cut ${cut.start}–${cut.end} crosses ${c.id}, whose sound is unknown`).toBeDefined();
            const shift = c.timelinePosition - c.startTime;
            for (let b = Math.floor((from - shift) * PPS); b < Math.ceil((to - shift) * PPS); b++) {
              const peak = src.waveformData![b];
              expect(Math.max(Math.abs(peak.min), Math.abs(peak.max)) < level, `cut ${cut.start}–${cut.end} cuts sound in ${c.id}`).toBe(true);
            }
          }
        }
      }),
      { seed: 0x403, numRuns: 300 }
    );
    // Not vacuous: a good share of scenarios find something to cut.
    expect(cutSomething).toBeGreaterThan(60);
  });
});
