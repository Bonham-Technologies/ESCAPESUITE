/**
 * AudioWaveform component
 * Renders audio waveform visualization within timeline clips
 * Uses canvas for efficient rendering at various zoom levels
 */

import { useRef, useEffect, useMemo } from 'react';
import { clamp, pixelsToTime } from '../../utils/timeUtils';
import type { WaveformPeak } from '../../store/types';
import { resamplePeaks, getPeaksForRange } from '../../utils/waveform';
import styles from './AudioWaveform.module.css';

/**
 * A number of CSS pixels' worth of bitmap the backing store will hold before
 * `devicePixelRatio` scaling, independent of how wide the clip's box is. This
 * is a real browser limit (a canvas is capped at roughly 32,767px per
 * dimension) rather than a quality choice, and it is now applied to the CSS
 * size too (see the draw effect below) — ESCSUITE-13 found the old
 * code clamping only the backing store and stretching `canvas.style.width` to
 * the clip's full (unclamped) width, which bought zooming in nothing: a
 * fixed-size bitmap smeared across a growing CSS box loses resolution, it
 * does not gain it. A canvas can no longer disagree with its own backing
 * store about how many pixels it holds.
 */
const MAX_BACKING_DIMENSION = 16000;

/**
 * The sample count used when the **whole clip** is on screen — nothing to
 * scroll, so there is no "visible window" narrower than the clip itself. This
 * is the pre-ESCSUITE-13 cap, kept as the cheap, zoomed-out fallback: at this
 * size the clip's own box is small enough that detail is rarely the
 * bottleneck, and skipping the windowed math below avoids recomputing a
 * sub-range on every render for a clip that never needs one.
 */
const FALLBACK_SAMPLE_CAP = 2000;

/**
 * How many distinct (clip, zoom, window) resamples a single `AudioWaveform`
 * instance remembers before evicting the oldest. Bounds memory for a clip the
 * user scrubs back and forth over for a long time; one instance lives exactly
 * as long as its clip is mounted (see {@link WaveformCache}), so there is
 * nothing to evict on a *clip* change beyond letting React unmount it.
 */
const MAX_CACHE_ENTRIES = 50;

interface WaveformCache {
  /** The `peaks` array this cache's entries were resampled from. */
  peaksRef: WaveformPeak[];
  entries: Map<string, WaveformPeak[]>;
}

interface AudioWaveformProps {
  /** Peak data from the source media */
  peaks: WaveformPeak[];
  /** Total duration of the source media (seconds) */
  sourceDuration: number;
  /** Start time within source (for trimmed clips) */
  startTime: number;
  /** End time within source (for trimmed clips) */
  endTime: number;
  /**
   * Width of the clip's **whole box** in pixels, used only to map pixels to
   * source time (`width` / (`endTime` - `startTime`) is the clip's local
   * pixels-per-second). It is **not** necessarily how wide the canvas this
   * component draws is — see {@link visibleRangePx}.
   */
  width: number;
  /**
   * The slice of the clip's box that is actually scrolled into view, in the
   * same pixel units as {@link width} and 0 at the clip's own left edge.
   *
   * ESCSUITE-13: a clip's box can be far wider than any viewport once zoomed
   * in, and resampling the *whole* box into a capped-size array throws detail
   * away that zooming in should have revealed — the sample that would have
   * shown it was averaged together with thousands of others outside the
   * window ever being scrolled into. Passing the visible slice instead means
   * only the audio actually on screen is resampled, at a resolution that
   * follows the window's own (device-pixel) width rather than the clip's.
   *
   * Omitted — or covering the whole clip — selects the **zoomed-out
   * fallback**: the pre-ESCSUITE-13 behaviour of resampling the entire clip
   * to at most {@link FALLBACK_SAMPLE_CAP} samples, which is exactly right
   * when there is no scrolling to speak of. `TimelineTrack` computes this
   * from `Timeline`'s scroll position and container width; a caller with no
   * viewport to report (a direct render, a test) gets the fallback.
   */
  visibleRangePx?: { offset: number; width: number };
  /**
   * Height of the clip **box** in pixels — not of the track row.
   *
   * The canvas is `height: 100%` of `.clip` (`AudioWaveform.module.css`) and
   * `.clip` is inset inside its row, so this is what the caller's
   * `clipBoxHeight` computes (`TimelineTrack.tsx`). It is written to **both** the
   * backing store and the CSS height below, so those two can never disagree and
   * nothing here is ever rescaled vertically. What this number has to get right
   * is whether it **fits**: `.clip` is `overflow: hidden`, so a canvas taller
   * than the box has its bottom cut off, and the centreline the peaks are drawn
   * around — the middle of the canvas — then sits below the middle of the box.
   * Until ESCSUITE-76 the caller passed `track.height - 4`, five pixels too many
   * at a 60px row, and the lower peaks were clipped away.
   */
  height: number;
  /** Waveform color */
  color?: string;
  /** Whether this is an audio-only clip (affects color) */
  isAudioClip?: boolean;
  /** Whether the clip is selected (affects color for visibility) */
  isSelected?: boolean;
}

/** `window.devicePixelRatio`, read defensively — 0 and NaN both fold to 1. */
function readDevicePixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return dpr && dpr > 0 ? dpr : 1;
}

export function AudioWaveform({
  peaks,
  sourceDuration,
  startTime,
  endTime,
  width,
  visibleRangePx,
  height,
  color,
  isAudioClip = false,
  isSelected = false,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<WaveformCache | null>(null);

  // The full clip box, in local (clip-relative) pixels — used only to map
  // pixels to source time, never to size the canvas (see `visibleRangePx`).
  const fullWidthPx = Math.max(0, Math.floor(width));

  // The slice actually on screen, clamped into [0, fullWidthPx]. Omitted (or
  // covering the whole clip) is the zoomed-out fallback — see the prop doc.
  const offsetPx = clamp(visibleRangePx?.offset ?? 0, 0, fullWidthPx);
  const visibleWidthPx = clamp(
    visibleRangePx?.width ?? fullWidthPx - offsetPx,
    0,
    fullWidthPx - offsetPx
  );
  // Whether the *caller* is reporting a window at all, not whether that
  // window happens to cover the whole clip — a caller who knows it is windowed
  // and asks for the whole clip anyway (an ultra-wide viewport, say) still
  // gets the device-pixel-resolution formula below, because there genuinely
  // is a viewport bounding it, even if nothing is scrolled off today.
  const isWindowed = visibleRangePx != null;

  const dpr = readDevicePixelRatio();

  // Resample only the visible window's source-time range, at a resolution
  // that follows the window's own (device-pixel) width when it is narrower
  // than the clip — the zoomed-out fallback keeps the old whole-clip cap.
  const displayPeaks = useMemo(() => {
    if (!peaks || peaks.length === 0 || visibleWidthPx <= 0 || fullWidthPx <= 0) return [];

    const clipTimeSpan = endTime - startTime;
    const localPxPerSecond = clipTimeSpan > 0 ? fullWidthPx / clipTimeSpan : 0;
    const windowStartTime =
      localPxPerSecond > 0 ? startTime + pixelsToTime(offsetPx, localPxPerSecond) : startTime;
    const windowEndTime =
      localPxPerSecond > 0
        ? startTime + pixelsToTime(offsetPx + visibleWidthPx, localPxPerSecond)
        : endTime;

    const targetSamples = isWindowed
      ? Math.max(1, Math.min(Math.ceil(visibleWidthPx * dpr), MAX_BACKING_DIMENSION))
      : Math.min(Math.ceil(visibleWidthPx), FALLBACK_SAMPLE_CAP);

    // One cache per (clip, zoom bucket, window): a `peaks` array identifies
    // the clip's source media, and the cache is thrown away — not patched —
    // the moment that reference changes, so a clip that gets new waveform
    // data never reads a stale resample back.
    if (!cacheRef.current || cacheRef.current.peaksRef !== peaks) {
      cacheRef.current = { peaksRef: peaks, entries: new Map() };
    }
    const cache = cacheRef.current.entries;
    const zoomBucket = Math.round(fullWidthPx);
    const windowBucket = isWindowed
      ? `${Math.round(offsetPx)}-${Math.round(offsetPx + visibleWidthPx)}`
      : 'full';
    const cacheKey = `${zoomBucket}:${windowBucket}:${dpr}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const windowPeaks = getPeaksForRange(peaks, sourceDuration, windowStartTime, windowEndTime);
    const resampled = resamplePeaks(windowPeaks, targetSamples);

    cache.set(cacheKey, resampled);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    return resampled;
  }, [
    peaks,
    sourceDuration,
    startTime,
    endTime,
    fullWidthPx,
    offsetPx,
    visibleWidthPx,
    isWindowed,
    dpr,
  ]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayPeaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The backing store and the CSS size are derived from the *same* clamped
    // number on both dimensions, so they can never disagree — the ESCSUITE-13
    // bug was exactly this pair drifting apart (CSS stretched past what the
    // bitmap actually held).
    const maxCssDimension = MAX_BACKING_DIMENSION / dpr;
    const canvasWidth = Math.min(visibleWidthPx, maxCssDimension);
    const canvasHeight = Math.min(Math.max(0, Math.floor(height)), maxCssDimension);

    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    canvas.style.left = `${offsetPx}px`;
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

    // One bar per *sample*, not per pixel: at the fallback's whole-clip
    // resolution this draws exactly as before, but once a window resamples to
    // more entries than the canvas has CSS pixels (ESCSUITE-13's device-pixel
    // resolution), each bar is a fraction of a CSS pixel wide — which the
    // `scale(dpr)` above turns into a whole device pixel, giving the window
    // genuinely more distinct bars rather than the same ones stretched wider.
    const barWidth = canvasWidth / displayPeaks.length;

    for (let i = 0; i < displayPeaks.length; i++) {
      const peak = displayPeaks[i];
      const x = i * barWidth;

      // Calculate Y positions
      const minY = centerY - peak.max * amplitude;
      const maxY = centerY - peak.min * amplitude;

      // Draw a bar spanning this sample's slice of the canvas
      const barHeight = Math.max(1, maxY - minY);
      ctx.fillRect(x, minY, barWidth, barHeight);
    }
  }, [
    displayPeaks,
    visibleWidthPx,
    offsetPx,
    height,
    color,
    isAudioClip,
    isSelected,
    dpr,
  ]);

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
