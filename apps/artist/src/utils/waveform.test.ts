/**
 * Tests for waveform extraction utilities
 */

import { describe, it, expect } from 'vitest';
import { resamplePeaks, getPeaksForRange } from './waveform';
import type { WaveformPeak } from '../store/types';

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
  // Note: extractWaveformData requires AudioContext which is not available in jsdom
  // These tests would need to mock AudioContext or run in a browser environment

  // Placeholder for integration tests
  it.todo('extracts peaks from audio blob');
  it.todo('handles video with audio track');
  it.todo('returns hasAudio: false for video without audio');
  it.todo('handles decoding errors gracefully');
  it.todo('averages stereo channels');
});
