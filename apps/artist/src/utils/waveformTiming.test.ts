/**
 * ESCSUITE-418: the timeline's waveform must sit where the sound is, at any
 * sample rate and any length, however long the clip.
 *
 * The peaks used to be `floor(L / ceil(L / q))` samples each (q = sampleRate /
 * 100): one sample short of 10 ms on any track that is not a whole number of
 * 10 ms long, while `getPeaksForRange` drew each as `duration / peaks.length`.
 * The waveform then drifted from the sound by ~0.2 % of the clip (0.6 s at
 * five minutes at 48 kHz), so a pause drawn on the timeline was not where the
 * audio's pause is.
 *
 * Each case here goes the way a real import does: PCM through the streaming
 * reducer (or the whole-buffer path), the timing stored beside the peaks
 * (`waveformSecondsPerPeak`), read back the way `TimelineTrack` reads it
 * (`drawnSecondsPerPeak`, `peakTimingOf`'s estimate: the timing silence
 * detection reads), and the window the timeline would draw cut by
 * `getPeaksForRange`. The window is drawn
 * stretched across its time range, so a peak's place in it is its time.
 */

import { describe, expect, it } from 'vitest';
import type { SourceVideo, WaveformPeak } from '../store/types';
import { getPeaksForRange } from './waveform';
import { PeakReducer, peakSecondsFor, peaksFromPcm } from './waveformPeaks';
import { drawnSecondsPerPeak, peakTimingOf } from './peakTiming';

const CLIP_SECONDS = 300.013;
const CLICK_AT = 290;
/** How far either side of the click the drawn window reaches. */
const WINDOW = 0.1;

/** A silent track `seconds` long with a short full-scale click at `clickAt`. */
function clickTrack(rate: number, seconds: number, clickAt: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * rate));
  const at = Math.round(clickAt * rate);
  pcm.fill(0.9, at, at + 3);
  return pcm;
}

/** `pcm` fed to the streaming reducer a second at a time, as a decoder hands it over. */
function streamed(pcm: Float32Array, rate: number): { peaks: WaveformPeak[]; secondsPerPeak: number | undefined } {
  const reducer = new PeakReducer(rate, 100);
  for (let at = 0; at < pcm.length; at += rate) reducer.push([pcm.subarray(at, at + rate)]);
  const peaks = reducer.finish();
  return { peaks, secondsPerPeak: reducer.secondsPerPeak };
}

type Timed = Pick<SourceVideo, 'duration' | 'waveformData' | 'waveformSecondsPerPeak'>;

/**
 * Where the timeline draws the loudest peak of `[at - WINDOW, at + WINDOW]`
 * of `source`'s waveform, in source seconds: the window's peaks are spread
 * evenly over its time range, so peak j of n sits at `start + (j + ½) · span / n`.
 */
function drawnLoudestNear(source: Timed, at: number): { time: number; level: number } {
  const start = at - WINDOW;
  const end = at + WINDOW;
  const window = getPeaksForRange(source.waveformData!, source.duration, start, end, drawnSecondsPerPeak(source));
  let loudest = 0;
  for (let j = 1; j < window.length; j++) if (window[j].max > window[loudest].max) loudest = j;
  return { time: start + ((loudest + 0.5) * (end - start)) / window.length, level: window[loudest]?.max ?? 0 };
}

describe('ESCSUITE-418: the waveform is drawn where the sound is', () => {
  for (const rate of [48_000, 44_100]) {
    it(`draws a click 290 s into a ${CLIP_SECONDS} s track at ${rate / 1000} kHz within 10 ms of it (streamed)`, () => {
      const pcm = clickTrack(rate, CLIP_SECONDS, CLICK_AT);
      const { peaks, secondsPerPeak } = streamed(pcm, rate);
      const source: Timed = { duration: pcm.length / rate, waveformData: peaks, waveformSecondsPerPeak: secondsPerPeak };

      const drawn = drawnLoudestNear(source, CLICK_AT);
      expect(drawn.level, 'the click is in the window drawn around it').toBeGreaterThan(0.5);
      expect(Math.abs(drawn.time - CLICK_AT), `the click is drawn at ${drawn.time} s`).toBeLessThanOrEqual(0.01);
    });

    it(`draws the same click within 10 ms at ${rate / 1000} kHz through the whole-buffer path`, () => {
      const pcm = clickTrack(rate, CLIP_SECONDS, CLICK_AT);
      const source: Timed = {
        duration: pcm.length / rate,
        waveformData: peaksFromPcm(pcm, rate, 100),
        waveformSecondsPerPeak: peakSecondsFor(pcm.length, rate, 100),
      };

      const drawn = drawnLoudestNear(source, CLICK_AT);
      expect(drawn.level).toBeGreaterThan(0.5);
      expect(Math.abs(drawn.time - CLICK_AT), `the click is drawn at ${drawn.time} s`).toBeLessThanOrEqual(0.01);
    });
  }

  it('draws a click within 10 ms at a rate 100 does not divide (22.05 kHz) and at 16 kHz', () => {
    for (const rate of [22_050, 16_000, 11_025]) {
      const pcm = clickTrack(rate, CLIP_SECONDS, CLICK_AT);
      const { peaks, secondsPerPeak } = streamed(pcm, rate);
      const drawn = drawnLoudestNear({ duration: pcm.length / rate, waveformData: peaks, waveformSecondsPerPeak: secondsPerPeak }, CLICK_AT);
      expect(drawn.level, `${rate} Hz`).toBeGreaterThan(0.5);
      expect(Math.abs(drawn.time - CLICK_AT), `${rate} Hz: the click is drawn at ${drawn.time} s`).toBeLessThanOrEqual(0.01);
    }
  });

  it('reads peaks cached with the old bucketing by the length stored beside them', () => {
    // What a build between ESCSUITE-403 and this ticket stored: 479-sample
    // buckets at 48 kHz, the last ~0.2 % of the track dropped, and that
    // bucket recorded as the peaks' length.
    const rate = 48_000;
    const pcm = clickTrack(rate, CLIP_SECONDS, CLICK_AT);
    const count = Math.ceil((pcm.length / rate) * 100);
    const size = Math.floor(pcm.length / count);
    expect(size, 'the old bucket is one sample short of 10 ms').toBe(479);
    const legacy: WaveformPeak[] = [];
    for (let i = 0; i < count; i++) {
      let max = 0;
      for (let j = i * size; j < (i + 1) * size; j++) if (pcm[j] > max) max = pcm[j];
      legacy.push({ min: 0, max });
    }

    const drawn = drawnLoudestNear({ duration: pcm.length / rate, waveformData: legacy, waveformSecondsPerPeak: size / rate }, CLICK_AT);
    expect(drawn.level).toBeGreaterThan(0.5);
    expect(Math.abs(drawn.time - CLICK_AT), `the click is drawn at ${drawn.time} s`).toBeLessThanOrEqual(0.01);
  });

  it('every peak lasts exactly 10 ms, however long the track, so the peaks cover all of it', () => {
    for (const rate of [48_000, 44_100, 22_050, 16_000, 8_000]) {
      for (const seconds of [0.004, 1.005, 4.999, 60.013, 300.013]) {
        const length = Math.round(seconds * rate);
        expect(peakSecondsFor(length, rate, 100), `${rate} Hz, ${seconds} s`).toBe(0.01);
        const peaks = peaksFromPcm(new Float32Array(length), rate, 100);
        expect(peaks.length, `${rate} Hz, ${seconds} s`).toBe(Math.ceil((length * 100) / rate));
      }
    }
  });

  it('draws by the timing silence detection reads (one timing, no separate constant)', () => {
    const rate = 48_000;
    const pcm = clickTrack(rate, 12.345, 10);
    const { peaks, secondsPerPeak } = streamed(pcm, rate);
    const source: Timed = { duration: pcm.length / rate, waveformData: peaks, waveformSecondsPerPeak: secondsPerPeak };
    expect(drawnSecondsPerPeak(source)).toBe(peakTimingOf(source).estimate);
    expect(drawnSecondsPerPeak(source)).toBe(0.01);
  });
});

describe('drawnSecondsPerPeak: peaks with no recorded length (ESCSUITE-418)', () => {
  const legacyPeaks = (count: number): WaveformPeak[] => Array.from({ length: count }, () => ({ min: 0, max: 0 }));

  it('draws legacy extractor peaks (~100 a second) at the estimate silence detection uses', () => {
    const source: Timed = { duration: 300.013, waveformData: legacyPeaks(30_002) };
    expect(drawnSecondsPerPeak(source)).toBe(peakTimingOf(source).estimate);
  });

  it('spreads peaks over the duration when the estimate cannot account for it, or there is nothing to time', () => {
    // A thousand a second: not the extractor's, so its timing is not the estimate.
    expect(drawnSecondsPerPeak({ duration: 60, waveformData: legacyPeaks(60_000) })).toBeUndefined();
    expect(drawnSecondsPerPeak({ duration: 60, waveformData: [] })).toBeUndefined();
    expect(drawnSecondsPerPeak({ duration: 60 })).toBeUndefined();
    expect(drawnSecondsPerPeak({ duration: 0, waveformData: legacyPeaks(10) })).toBeUndefined();
    expect(drawnSecondsPerPeak({ duration: Infinity, waveformData: legacyPeaks(10) })).toBeUndefined();
  });

  it('trusts a recorded length whatever the count', () => {
    expect(drawnSecondsPerPeak({ duration: 60, waveformData: legacyPeaks(3), waveformSecondsPerPeak: 0.01 })).toBe(0.01);
  });
});

describe('getPeaksForRange with the peaks\' own timing (ESCSUITE-418)', () => {
  const peaks: WaveformPeak[] = Array.from({ length: 100 }, (_, i) => ({ min: -i / 100, max: i / 100 }));

  it('maps time to peaks by their length, not by duration / peaks.length', () => {
    // 100 peaks of 10 ms over a 1.002 s source: peak 50 starts at 0.5 s.
    expect(getPeaksForRange(peaks, 1.002, 0.5, 0.52, 0.01)).toEqual([peaks[50], peaks[51]]);
  });

  it('reads a time on a peak boundary as that boundary, despite float division', () => {
    // 0.29 / 0.01 is 28.999999999999996.
    expect(getPeaksForRange(peaks, 1, 0.29, 0.3, 0.01)).toEqual([peaks[29]]);
  });

  it('fills a range past the last peak with silence up to the duration, rather than stretching the peaks over it', () => {
    const tail = getPeaksForRange(peaks, 1.03, 0.98, 1.1, 0.01);
    expect(tail).toEqual([peaks[98], peaks[99], { min: 0, max: 0 }, { min: 0, max: 0 }, { min: 0, max: 0 }]);
    // No duration to fill to: just the peaks there are.
    expect(getPeaksForRange(peaks, Infinity, 0.98, 1.1, 0.01)).toEqual([peaks[98], peaks[99]]);
  });

  it('ignores a timing that is not a length', () => {
    for (const bad of [0, -0.01, Number.NaN, Infinity]) {
      expect(getPeaksForRange(peaks, 1, 0.5, 0.52, bad), String(bad)).toEqual(getPeaksForRange(peaks, 1, 0.5, 0.52));
    }
  });
});
