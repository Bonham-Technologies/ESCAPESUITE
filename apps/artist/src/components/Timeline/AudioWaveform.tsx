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
export const MAX_BACKING_DIMENSION = 16000;

/**
 * The floor on how few samples a window is ever resampled to, so long as the
 * window's own source data can support it — **not** a separate "fallback
 * mode" (ESCSUITE-13 round 2, MINOR-3). Before round 2 this was a hard cap
 * used only when the whole clip was on screen, and a clip scrolled one pixel
 * past "fully visible" jumped straight to the device-pixel-resolution
 * formula below — a 2000 → ~5000 sample discontinuity for a 1px scroll, with
 * the envelope visibly flattening at the exact moment a clip's edge crossed
 * the viewport edge. {@link targetSamplesFor} now applies the same formula
 * everywhere: request at least this many samples (never more than the
 * window's own peak count — see {@link MAX_BACKING_DIMENSION}'s sibling
 * concern, overshoot, below), and *more* than this only when the window's
 * own pixel width asks for more. The quantity that decides which regime
 * applies is a **sample count**, not a pixel threshold, so there is no
 * boundary left to be discontinuous across.
 */
export const FALLBACK_SAMPLE_FLOOR = 2000;

/**
 * Scroll quantisation (ESCSUITE-13 round 2, MAJOR-1(a)): the visible window
 * is rounded outward to this many CSS pixels before anything downstream reads
 * it, so a scroll that moves by less than one bucket's width changes nothing
 * — not the memo's dependencies, not the cache key, not the canvas's size or
 * position — and costs no resample at all. A real scroll gesture crosses many
 * buckets, so this only removes work a human could never perceive: no frame
 * of a scroll shows a window merely 1px different from the frame before, and
 * rounding *outward* (floor the start, ceil the end) means the bucketed
 * window always contains the actually-visible one, which also hides a frame
 * or two of render lag behind the scroll (see `TimelineTrack.waveform.perf.test.ts`
 * and this ticket's round-2 report, MINOR-6).
 */
export const WINDOW_BUCKET_PX = 64;

/**
 * Sample budget for a single `AudioWaveform` instance's resample cache
 * (ESCSUITE-13 round 2, MINOR-2): the combined length of every entry
 * currently held, evicted least-recently-*touched* first — a cache hit moves
 * its entry to the most-recently-used end, so a window the user keeps
 * scrolling back to is never the one that gets evicted. 2,000,000 peaks is a
 * generous circuit breaker rather than a tight budget: now that a window's
 * own sample count is capped at the source's actual peak count for that
 * window ({@link targetSamplesFor}) rather than an arbitrary per-pixel
 * request, a realistic session's worth of distinct windows for one clip
 * comes nowhere near this, and the bound exists only against a pathological
 * case (a corrupted `sourceDuration` inflating a window's apparent peak
 * count, say).
 */
export const MAX_CACHE_SAMPLES = 2_000_000;

/**
 * How many evicted resample arrays one instance keeps on hand to hand back to
 * {@link resamplePeaks} instead of letting the next miss allocate fresh
 * (MAJOR-1(d)). Small and arbitrary — it only needs to be big enough that a
 * burst of evictions (a long continuous scroll through all-new windows)
 * doesn't immediately run the pool dry.
 */
const MAX_FREE_BUFFERS = 16;

interface WaveformCache {
  /** The `peaks` array this cache's entries were resampled from. */
  peaksRef: WaveformPeak[];
  /**
   * Resample results, **least-recently-touched first**. A hit deletes and
   * re-inserts its key, which `Map` places at the end — true LRU, so
   * eviction (always from the front) never removes the entry being
   * repeatedly revisited.
   */
  entries: Map<string, WaveformPeak[]>;
  /** Sum of every entry's length — what {@link MAX_CACHE_SAMPLES} bounds. */
  totalSamples: number;
  /** Evicted entries' arrays, ready for `resamplePeaks` to reuse (MAJOR-1(d)). */
  freeBuffers: WaveformPeak[][];
}

/**
 * Round a window outward to the nearest {@link WINDOW_BUCKET_PX} grid line,
 * clamped into `[0, maxWidth]`. The result always contains
 * `[rawOffset, rawOffset + rawWidth]` — rounding the start down and the end
 * up can only widen the window, never narrow it past what was asked for.
 */
function bucketWindow(
  rawOffset: number,
  rawWidth: number,
  maxWidth: number
): { offset: number; width: number } {
  // `rawOffset` arrives already clamped into `[0, maxWidth]` (its one caller
  // is the component, right after its own `clamp` call), so flooring it can
  // never go negative — there is no `Math.max(0, …)` here to guard that.
  const rawEnd = rawOffset + rawWidth;
  const start = Math.floor(rawOffset / WINDOW_BUCKET_PX) * WINDOW_BUCKET_PX;
  const end = Math.min(maxWidth, Math.ceil(rawEnd / WINDOW_BUCKET_PX) * WINDOW_BUCKET_PX);
  return { offset: start, width: Math.max(0, end - start) };
}

/**
 * How many samples to resample a window to: at least {@link FALLBACK_SAMPLE_FLOOR}
 * when the window's own data supports it, otherwise one sample per device
 * pixel of the window's width — but never more samples than the window
 * actually contains (ESCSUITE-13 round 2, MAJOR-1(b)). Production peaks are
 * extracted at 100/s (`utils/waveform.ts`), so a 6s window holds 600 of them;
 * asking `resamplePeaks` for more than that only has it duplicate real peaks
 * to pad the request; every duplicate is a wasted allocation and a wasted
 * `fillRect` carrying no information the browser didn't already have.
 */
function targetSamplesFor(visibleWidthPx: number, dpr: number, windowPeakCount: number): number {
  const pixelCandidate = Math.ceil(visibleWidthPx * dpr);
  return Math.min(Math.max(FALLBACK_SAMPLE_FLOOR, pixelCandidate), windowPeakCount, MAX_BACKING_DIMENSION);
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
   * follows the window's own (device-pixel) width.
   *
   * Omitted — or covering the whole clip — is simply the smallest possible
   * window: the whole clip. There is no separate "fallback mode" any more
   * (round 2, MINOR-3) — the same formula ({@link targetSamplesFor}) runs
   * either way, so a caller with no viewport to report (a direct render, a
   * test) gets exactly what `TimelineTrack` would ask for if it, too, could
   * see the whole clip without scrolling.
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

/**
 * `window.devicePixelRatio`, read defensively — 0 and NaN both fold to 1. No
 * `typeof window` guard: ESCAPEARTIST is browser-only (no SSR anywhere in
 * this codebase — `PreviewPlayer.tsx` reads the same global unguarded), so
 * that check has no caller that could ever take its other side.
 */
function readDevicePixelRatio(): number {
  const dpr = window.devicePixelRatio;
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

  // The requested slice, clamped into [0, fullWidthPx], then quantised to the
  // scroll bucket — see `bucketWindow`. Omitted (or covering the whole clip)
  // is unaffected: bucketing an offset of 0 and a width of `fullWidthPx` is a
  // no-op, since the end is clamped to `fullWidthPx` either way.
  const rawOffsetPx = clamp(visibleRangePx?.offset ?? 0, 0, fullWidthPx);
  const rawVisibleWidthPx = clamp(
    visibleRangePx?.width ?? fullWidthPx - rawOffsetPx,
    0,
    fullWidthPx - rawOffsetPx
  );
  const { offset: offsetPx, width: visibleWidthPx } = bucketWindow(
    rawOffsetPx,
    rawVisibleWidthPx,
    fullWidthPx
  );

  const dpr = readDevicePixelRatio();

  // Resample only the visible window's source-time range, at a resolution
  // that follows the window's own (device-pixel) width — see
  // `targetSamplesFor`. Memoised on primitives only (never `visibleRangePx`'s
  // object identity), so a render that leaves the bucketed window unchanged
  // — a drag elsewhere on the row, a playback tick, a scroll that stayed
  // inside one 64px bucket — costs nothing here.
  const displayPeaks = useMemo(() => {
    if (!peaks || peaks.length === 0 || visibleWidthPx <= 0 || fullWidthPx <= 0) return [];

    // `fullWidthPx > 0` here implies `endTime > startTime`: both are derived
    // from the same clip (`width = duration * pixelsPerSecond`,
    // `duration = endTime - startTime` — see `TimelineTrack.tsx`), so no
    // caller that reaches this line can have a non-positive time span.
    const localPxPerSecond = fullWidthPx / (endTime - startTime);
    const windowStartTime = startTime + pixelsToTime(offsetPx, localPxPerSecond);
    const windowEndTime = startTime + pixelsToTime(offsetPx + visibleWidthPx, localPxPerSecond);

    // One cache per (clip, zoom, window, trim): a `peaks` array identifies
    // the clip's source media, and the cache is thrown away — not patched —
    // the moment that reference changes, so a clip that gets new waveform
    // data never reads a stale resample back. `startTime`/`endTime`/
    // `sourceDuration` are in the key (not just the window's own pixels)
    // because they are what `getPeaksForRange` actually reads — a trim that
    // changes them without moving the clip's pixel window must still miss.
    if (!cacheRef.current || cacheRef.current.peaksRef !== peaks) {
      cacheRef.current = { peaksRef: peaks, entries: new Map(), totalSamples: 0, freeBuffers: [] };
    }
    const cache = cacheRef.current;
    const cacheKey = `${Math.round(fullWidthPx)}:${Math.round(offsetPx)}-${Math.round(offsetPx + visibleWidthPx)}:${dpr}:${startTime}:${endTime}:${sourceDuration}`;

    const cached = cache.entries.get(cacheKey);
    if (cached) {
      // Touch: delete-then-set moves this key to the end of the map, so the
      // next eviction pass (oldest-first) leaves it alone — true LRU.
      cache.entries.delete(cacheKey);
      cache.entries.set(cacheKey, cached);
      return cached;
    }

    const windowPeaks = getPeaksForRange(peaks, sourceDuration, windowStartTime, windowEndTime);
    const targetSamples = targetSamplesFor(visibleWidthPx, dpr, windowPeaks.length);

    const buffer = cache.freeBuffers.pop() ?? [];
    const resampled = resamplePeaks(windowPeaks, targetSamples, buffer);

    cache.entries.set(cacheKey, resampled);
    cache.totalSamples += resampled.length;

    // Evict oldest-touched-first until back under budget. `cache.entries` is
    // in LRU order (oldest first) by construction, so a plain forward
    // iteration visits exactly the entries eviction should consider, in the
    // order it should consider them, and `totalSamples` reaching 0 when the
    // map empties means this can never read past the end of it.
    for (const [key, value] of cache.entries) {
      if (cache.totalSamples <= MAX_CACHE_SAMPLES) break;
      cache.entries.delete(key);
      cache.totalSamples -= value.length;
      if (cache.freeBuffers.length < MAX_FREE_BUFFERS) cache.freeBuffers.push(value);
    }

    return resampled;
  }, [peaks, sourceDuration, startTime, endTime, fullWidthPx, offsetPx, visibleWidthPx, dpr]);

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
    // The window's own offset, not 0 — this is what makes a scrolled window's
    // canvas line up with the slice of the clip it actually drew (ESCSUITE-13
    // round 2, MAJOR-3). Deleting this line draws the right audio in the
    // wrong place: the middle of a long clip's waveform, painted over its
    // beginning.
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

    // One bar per *sample*, not per pixel: at a 1-sample-per-pixel window
    // this draws exactly as before, but once a window resamples to more
    // entries than the canvas has CSS pixels (the device-pixel-resolution
    // case), each bar is a fraction of a CSS pixel wide — which the
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
  }, [displayPeaks, visibleWidthPx, offsetPx, height, color, isAudioClip, isSelected, dpr]);

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
