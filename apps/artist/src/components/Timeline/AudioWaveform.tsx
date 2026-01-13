/**
 * AudioWaveform component
 * Renders audio waveform visualization within timeline clips
 * Uses canvas for efficient rendering at various zoom levels
 */

import { useRef, useEffect, useMemo } from 'react';
import type { WaveformPeak } from '../../store/types';
import { resamplePeaks, getPeaksForRange } from '../../utils/waveform';
import styles from './AudioWaveform.module.css';

interface AudioWaveformProps {
  /** Peak data from the source media */
  peaks: WaveformPeak[];
  /** Total duration of the source media (seconds) */
  sourceDuration: number;
  /** Start time within source (for trimmed clips) */
  startTime: number;
  /** End time within source (for trimmed clips) */
  endTime: number;
  /** Width of the clip in pixels */
  width: number;
  /** Height of the clip in pixels */
  height: number;
  /** Waveform color */
  color?: string;
  /** Whether this is an audio-only clip (affects color) */
  isAudioClip?: boolean;
  /** Whether the clip is selected (affects color for visibility) */
  isSelected?: boolean;
}

export function AudioWaveform({
  peaks,
  sourceDuration,
  startTime,
  endTime,
  width,
  height,
  color,
  isAudioClip = false,
  isSelected = false,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Get peaks for the visible range (respecting trim points)
  const visiblePeaks = useMemo(() => {
    if (!peaks || peaks.length === 0) return [];
    return getPeaksForRange(peaks, sourceDuration, startTime, endTime);
  }, [peaks, sourceDuration, startTime, endTime]);

  // Resample to fit display width
  const displayPeaks = useMemo(() => {
    if (visiblePeaks.length === 0 || width <= 0) return [];
    // Use 1 sample per pixel for crisp rendering, max 2000 samples
    const targetSamples = Math.min(Math.ceil(width), 2000);
    return resamplePeaks(visiblePeaks, targetSamples);
  }, [visiblePeaks, width]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayPeaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size (use device pixel ratio for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.floor(width);
    const canvasHeight = Math.floor(height);

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Waveform color - use high contrast white when selected, otherwise purple for audio, blue tint for video
    const defaultColor = isAudioClip ? 'rgba(138, 43, 226, 0.6)' : 'rgba(74, 158, 255, 0.5)';
    const selectedColor = 'rgba(255, 255, 255, 0.85)';
    const waveformColor = color || (isSelected ? selectedColor : defaultColor);
    ctx.fillStyle = waveformColor;

    const centerY = canvasHeight / 2;
    const amplitude = (canvasHeight / 2) * 0.85; // Leave some padding

    const samplesPerPixel = displayPeaks.length / canvasWidth;

    for (let x = 0; x < canvasWidth; x++) {
      const peakIndex = Math.floor(x * samplesPerPixel);
      const peak = displayPeaks[peakIndex];

      if (!peak) continue;

      // Calculate Y positions
      const minY = centerY - peak.max * amplitude;
      const maxY = centerY - peak.min * amplitude;

      // Draw vertical bar from min to max
      const barHeight = Math.max(1, maxY - minY);
      ctx.fillRect(x, minY, 1, barHeight);
    }
  }, [displayPeaks, width, height, color, isAudioClip, isSelected]);

  if (!peaks || peaks.length === 0 || width <= 0 || height <= 0) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={styles.waveform}
      aria-hidden="true"
    />
  );
}
