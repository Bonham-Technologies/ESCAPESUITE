/**
 * Tests for waveform extraction utilities
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractWaveformData, resamplePeaks, getPeaksForRange } from './waveform';
import type { WaveformPeak } from '../store/types';
import {
  createAudioBufferDouble,
  installAudioContextDouble,
  type AudioContextDoubles,
} from '../test/doubles/audio';
import { removeGlobal } from '../test/doubles/globals';

describe('waveform utilities', () => {
  describe('resamplePeaks', () => {
    it('returns empty array for empty input', () => {
      expect(resamplePeaks([], 10)).toEqual([]);
    });

    it('returns empty array for zero target samples', () => {
      const peaks: WaveformPeak[] = [{ min: -0.5, max: 0.5 }];
      expect(resamplePeaks(peaks, 0)).toEqual([]);
    });

    it('returns original array when target equals source length', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.3 },
        { min: -0.7, max: 0.7 },
      ];
      expect(resamplePeaks(peaks, 3)).toEqual(peaks);
    });

    it('downsamples by combining peaks', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.2, max: 0.2 },
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.8 },
        { min: -0.7, max: 0.1 },
      ];
      const result = resamplePeaks(peaks, 2);

      expect(result).toHaveLength(2);
      // First sample combines peaks 0-1
      expect(result[0].min).toBe(-0.5);
      expect(result[0].max).toBe(0.5);
      // Second sample combines peaks 2-3
      expect(result[1].min).toBe(-0.7);
      expect(result[1].max).toBe(0.8);
    });

    it('upsamples by repeating peaks', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.5, max: 0.5 },
        { min: -0.3, max: 0.3 },
      ];
      const result = resamplePeaks(peaks, 4);

      expect(result).toHaveLength(4);
      // Each original peak should be used for 2 output samples
      expect(result[0]).toEqual({ min: -0.5, max: 0.5 });
      expect(result[1]).toEqual({ min: -0.5, max: 0.5 });
      expect(result[2]).toEqual({ min: -0.3, max: 0.3 });
      expect(result[3]).toEqual({ min: -0.3, max: 0.3 });
    });

    it('handles single sample downsampling', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.2, max: 0.3 },
        { min: -0.5, max: 0.5 },
        { min: -0.1, max: 0.8 },
      ];
      const result = resamplePeaks(peaks, 1);

      expect(result).toHaveLength(1);
      expect(result[0].min).toBe(-0.5);
      expect(result[0].max).toBe(0.8);
    });
  });

  describe('getPeaksForRange', () => {
    it('returns empty array for empty input', () => {
      expect(getPeaksForRange([], 10, 0, 5)).toEqual([]);
    });

    it('returns empty array for zero duration', () => {
      const peaks: WaveformPeak[] = [{ min: -0.5, max: 0.5 }];
      expect(getPeaksForRange(peaks, 0, 0, 5)).toEqual([]);
    });

    it('returns all peaks when range covers full duration', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      const result = getPeaksForRange(peaks, 5, 0, 5);
      expect(result).toEqual(peaks);
    });

    it('returns subset for partial range from start', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      // 5 peaks over 5 seconds = 1 peak per second
      // Range 0-2 should get peaks 0-1 (indices 0,1)
      const result = getPeaksForRange(peaks, 5, 0, 2);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]).toEqual({ min: -0.1, max: 0.1 });
    });

    it('returns subset for partial range from middle', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
        { min: -0.4, max: 0.4 },
        { min: -0.5, max: 0.5 },
      ];
      // 5 peaks over 5 seconds = 1 peak per second
      // Range 2-4 should get peaks at seconds 2-4 (indices 2,3)
      const result = getPeaksForRange(peaks, 5, 2, 4);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ min: -0.3, max: 0.3 });
      expect(result[1]).toEqual({ min: -0.4, max: 0.4 });
    });

    it('clamps to valid indices', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
        { min: -0.3, max: 0.3 },
      ];
      // Request range beyond duration
      const result = getPeaksForRange(peaks, 3, 2, 10);
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ min: -0.3, max: 0.3 });
    });

    it('returns empty for range entirely beyond duration', () => {
      const peaks: WaveformPeak[] = [
        { min: -0.1, max: 0.1 },
        { min: -0.2, max: 0.2 },
      ];
      const result = getPeaksForRange(peaks, 2, 5, 10);
      expect(result).toEqual([]);
    });
  });
});

describe('extractWaveformData', () => {
  let audio: AudioContextDoubles;

  afterEach(() => {
    audio?.uninstall();
    vi.restoreAllMocks();
  });

  /** A one-second mono buffer at 100 Hz, so 100 samples map to 100 peaks/s. */
  const oneSecond = (values: number[]) =>
    createAudioBufferDouble([Float32Array.from(values)], values.length);

  it('extracts one peak per requested sample, each the min/max of its bucket', async () => {
    // 4 samples at 4 Hz = 1 second; 2 peaks/s means 2 samples per peak.
    audio = installAudioContextDouble(oneSecond([0.5, -0.25, 0.125, -0.875]));

    const result = await extractWaveformData(new Blob(['audio']), 2);

    expect(result.peaks).toEqual([
      { min: -0.25, max: 0.5 },
      { min: -0.875, max: 0.125 },
    ]);
    expect(result.hasAudio).toBe(true);
    // The blob really was read and the context really was closed.
    expect(audio.decodeCalls).toHaveLength(1);
    expect(audio.closed).toBe(1);
  });

  it('averages the two channels of a stereo buffer', async () => {
    audio = installAudioContextDouble(
      createAudioBufferDouble(
        [Float32Array.from([1, 0]), Float32Array.from([0, -1])],
        2
      )
    );

    const result = await extractWaveformData(new Blob(['audio']), 2);

    // (1+0)/2 = 0.5 and (0+-1)/2 = -0.5
    expect(result.peaks).toEqual([
      { min: 0, max: 0.5 },
      { min: -0.5, max: 0 },
    ]);
  });

  it('reports hasAudio false for a silent track, while still returning peaks', async () => {
    audio = installAudioContextDouble(oneSecond([0, 0.00048828125, -0.00048828125, 0]));

    const result = await extractWaveformData(new Blob(['audio']), 2);

    expect(result.peaks).toHaveLength(2);
    expect(result.hasAudio).toBe(false);
  });

  it('returns no peaks and closes the context when the media has no decodable audio', async () => {
    audio = installAudioContextDouble(null);

    const result = await extractWaveformData(new Blob(['video-without-audio']));

    expect(result).toEqual({ peaks: [], hasAudio: false });
    expect(audio.closed).toBe(1);
  });

  it('defaults to 100 peaks per second of audio', async () => {
    audio = installAudioContextDouble(
      createAudioBufferDouble([new Float32Array(4800)], 4800)
    );

    const result = await extractWaveformData(new Blob(['audio']));

    // 1 second of audio at the default rate
    expect(result.peaks).toHaveLength(100);
  });

  it('warns and returns nothing when the audio pipeline throws outright', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = removeGlobal('AudioContext');
    try {
      const result = await extractWaveformData(new Blob(['audio']));

      expect(result).toEqual({ peaks: [], hasAudio: false });
      expect(warn).toHaveBeenCalledWith('Failed to extract waveform data:', expect.any(Error));
    } finally {
      restore();
    }
  });
});
