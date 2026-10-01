// Shared types, constants, and utility functions for the export pipeline

import type { Clip, Track, ExportOptions, ExportProgress, BlendMode, SourceVideo } from '../store/types';
import type { PresetSide } from '../utils/animation';

/**
 * A drawable media source that can be used with canvas drawImage.
 * Includes VideoFrame (from WebCodecs), HTMLVideoElement, and HTMLImageElement.
 */
export type DrawableMediaSource = VideoFrame | HTMLVideoElement | HTMLImageElement;

/**
 * Get dimensions from a drawable source
 */
export function getSourceDimensions(source: DrawableMediaSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || 1920, height: source.videoHeight || 1080 };
  } else if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || 1920, height: source.naturalHeight || 1080 };
  } else if ('displayWidth' in source) {
    // VideoFrame
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: 1920, height: 1080 };
}

// Helper to get transition info between clips
export interface TransitionInfo {
  outgoingClip: Clip;
  incomingClip: Clip;
  progress: number; // 0 = start of transition, 1 = end
  type: import('../store/types').TransitionType;
}

export function getActiveTransition(clips: Clip[], tracks: Track[], time: number): TransitionInfo | null {
  // Find clips that are in a transition period
  for (const clip of clips) {
    if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue;

    const track = tracks.find(t => t.id === clip.trackId);
    if (!track || !track.visible) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    const transitionStart = clipEnd - clip.transition.duration;

    // Check if we're in the transition period
    if (time >= transitionStart && time < clipEnd) {
      // Find the incoming clip - first check same track, then look at other tracks
      // The incoming clip should be the one that will be visible when this clip ends

      // First, try to find a clip on the same track that starts at/near the end of this clip
      let incomingClip = clips
        .filter(c => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      // If no same-track clip, find the topmost clip that will be visible at the end time
      // (excluding the current clip and overlays)
      if (!incomingClip) {
        const clipsAtEnd = clips
          .filter(c => {
            if (c.id === clip.id) return false;
            if (c.overlayType) return false; // Skip overlays
            const cEnd = c.timelinePosition + c.duration;
            return c.timelinePosition <= clipEnd && cEnd > clipEnd;
          })
          .map(c => {
            const t = tracks.find(tr => tr.id === c.trackId);
            return { clip: c, track: t };
          })
          .filter(({ track: t }) => t && t.visible)
          .sort((a, b) => (b.track?.index ?? 0) - (a.track?.index ?? 0)); // Higher index = on top

        if (clipsAtEnd.length > 0) {
          incomingClip = clipsAtEnd[0].clip;
        }
      }

      if (incomingClip) {
        const progress = (time - transitionStart) / clip.transition.duration;
        return {
          outgoingClip: clip,
          incomingClip,
          progress: Math.min(1, Math.max(0, progress)),
          type: clip.transition.type,
        };
      }
    }
  }
  return null;
}

/**
 * The clip-relative time to evaluate the incoming clip's *animation* at,
 * during a transition (ESCSUITE-133).
 *
 * The same-track case `getActiveTransition` looks for first places the
 * incoming clip's `timelinePosition` at or after the outgoing clip's end, so
 * a plain `currentTime - incomingClip.timelinePosition` is negative for the
 * whole transition — the renderer was asking for the clip's animated state
 * (opacity, transform, blur) at a time the *frame* it was handed does not
 * correspond to: the frame fetch (`exportMP4.ts`'s `inSourceTime`) already
 * clamps to the incoming clip's first frame in this same case. Shared by
 * `drawTransition` and `drawTransitionWithFrames` — the two functions the
 * preview and both exporters draw a transition's incoming side through — so
 * the clamp can't drift between them.
 *
 * This does not, on its own, make a `fade` in-preset visible during the
 * transition: `interpolateKeyframes` already floors any time at or before a
 * property's first keyframe to that keyframe's own value, so 0 and any more
 * negative time read identically for every preset in this codebase (all of
 * which place their first keyframe at time 0 or later). What it fixes is the
 * inconsistency the finding names — the animated state and the frame it is
 * drawn onto now agree on which instant of the clip they are both showing.
 */
export function getIncomingClipTime(transition: TransitionInfo, currentTime: number): number {
  return Math.max(0, currentTime - transition.incomingClip.timelinePosition);
}

export type ProgressCallback = (progress: ExportProgress) => void;

/**
 * Error thrown when export is cancelled by user
 */
export class ExportAbortedError extends Error {
  constructor() {
    super('Export was cancelled');
    this.name = 'ExportAbortedError';
  }
}

/**
 * Structured log entry for export diagnostics
 */
export interface ExportLogEntry {
  phase: string;
  detail: string;
  timestamp: number;
}

/**
 * Error class that carries the export diagnostic log for debugging. Lives
 * here (rather than in exportMP4.ts, where it was first written) so both
 * exporters can throw and catch it without one importing from the other;
 * exportMP4.ts re-exports it so every existing caller and test import is
 * untouched.
 */
export class ExportError extends Error {
  public readonly exportLog: ExportLogEntry[];
  public readonly frameIndex: number | undefined;
  public readonly totalFrames: number | undefined;

  constructor(message: string, exportLog: ExportLogEntry[], frameIndex?: number, totalFrames?: number) {
    super(message);
    this.name = 'ExportError';
    this.exportLog = exportLog;
    this.frameIndex = frameIndex;
    this.totalFrames = totalFrames;
  }
}

/**
 * Check if abort was requested and throw if so
 */
export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ExportAbortedError();
  }
}

// Map blend modes to canvas globalCompositeOperation
export const blendModeToCanvas: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  add: 'lighter',
};

/**
 * Check if WebCodecs export is supported
 */
export function isMP4ExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/**
 * Check if WebM export via WebCodecs is supported
 */
export function isWebMExportSupported(): boolean {
  return isMP4ExportSupported();
}

/**
 * Get quality settings based on quality option
 */
export function getQualitySettings(quality: ExportOptions['quality']) {
  switch (quality) {
    case 'low':
      return { videoBitrate: 2_000_000, audioBitrate: 128_000 };
    case 'medium':
      return { videoBitrate: 5_000_000, audioBitrate: 192_000 };
    case 'high':
      return { videoBitrate: 10_000_000, audioBitrate: 256_000 };
  }
}

/**
 * Base (pre-scaling) dimensions for an export: the source dimensions of the
 * bottom-most media clip (lowest track index). Overlay clips are skipped.
 * Falls back to 1080p for overlay-only timelines. Shared by the MP4 and WebM
 * exporters and by the headless renderer's output metadata.
 */
export function getBaseDimensions(
  clips: Clip[],
  tracks: Track[],
  sourceVideos: SourceVideo[]
): { width: number; height: number } {
  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  const trackIndex = (trackId: string) => tracks.find(t => t.id === trackId)?.index ?? 0;
  const sortedClips = [...clips].sort((a, b) => trackIndex(a.trackId) - trackIndex(b.trackId));
  for (const clip of sortedClips) {
    if (clip.overlayType) continue;
    const source = sourceMap.get(clip.sourceVideoId);
    if (source && source.width && source.height) {
      return { width: source.width, height: source.height };
    }
  }
  return { width: 1920, height: 1080 };
}

/**
 * Get resolution dimensions.
 * When resolution is 'project', uses projectResolution if provided, falling
 * back to the source video's own dimensions otherwise.
 *
 * A preset (1080p, 720p, 480p) is a **height**, and the box it fills is the
 * **project's** shape: width = round-to-even(height x project aspect). It used
 * to take that aspect from `getBaseDimensions` — the bottom clip's source — so a
 * 16:9 project whose bottom clip happened to be 4:3 exported 960x720 for "720p"
 * (ESCSUITE-94). Only a caller with no project resolution at all falls back to
 * the source aspect, which is the same fallback 'project' itself takes.
 *
 * There used to be a fourth option, 'original', which took the source video's
 * dimensions regardless of the project's own shape — the one case that could
 * still letterbox after ESCSUITE-94, and one no UI ever offered (only a
 * hand-built headless job spec could reach it). ESCSUITE-111 dropped it rather
 * than fix it: every reachable resolution now follows the project's aspect.
 *
 * `resolution` is exactly `'project' | '1080p' | '720p' | '480p'` now, so a
 * preset name outside that list can only reach this function by bypassing the
 * type system — there is no longer a typed caller (the export dialog, both
 * exporters, or a validated headless job spec) that can construct one. That
 * used to fall back silently to `originalHeight`, which produced a
 * plausible-looking but meaningless size; it now throws instead (review round
 * 1, ESCSUITE-111).
 */
export function getResolution(
  resolution: ExportOptions['resolution'],
  originalWidth: number,
  originalHeight: number,
  projectResolution?: { width: number; height: number }
): { width: number; height: number } {
  if (resolution === 'project' && projectResolution) {
    return {
      width: projectResolution.width % 2 === 0 ? projectResolution.width : projectResolution.width + 1,
      height: projectResolution.height % 2 === 0 ? projectResolution.height : projectResolution.height + 1,
    };
  }

  if (resolution === 'project') {
    // No projectResolution provided: fall back to the source's own dimensions.
    return {
      width: originalWidth % 2 === 0 ? originalWidth : originalWidth + 1,
      height: originalHeight % 2 === 0 ? originalHeight : originalHeight + 1
    };
  }

  const targetHeights: Partial<Record<'1080p' | '720p' | '480p', number>> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
  };

  const targetHeight = targetHeights[resolution];
  if (targetHeight === undefined) {
    throw new Error(`getResolution: unknown resolution "${String(resolution)}"`);
  }
  const aspectSource =
    projectResolution && projectResolution.width > 0 && projectResolution.height > 0
      ? projectResolution
      : { width: originalWidth, height: originalHeight };
  const aspectRatio = aspectSource.width / aspectSource.height;
  const width = Math.round(targetHeight * aspectRatio);

  return {
    width: width % 2 === 0 ? width : width + 1,
    height: targetHeight % 2 === 0 ? targetHeight : targetHeight + 1,
  };
}

/**
 * Load a video blob and create an HTMLVideoElement
 */
export async function loadVideoElement(blob: Blob): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.muted = true;

    const url = URL.createObjectURL(blob);
    video.src = url;

    video.onloadeddata = () => {
      resolve(video);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };
  });
}

/**
 * Load an image blob and create an HTMLImageElement
 */
export async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(blob);
    img.src = url;

    img.onload = () => {
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
  });
}

/**
 * Yield to allow other tasks to run without being throttled in background tabs.
 * Uses MessageChannel which is not subject to the same throttling as setTimeout.
 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

// Transition modifiers for drawing clips during transitions
export interface TransitionModifiers {
  opacity?: number;
  offsetX?: number;
  offsetY?: number;
  clipRegion?: { x: number; y: number; width: number; height: number };
  /**
   * The clip's own animation preset this transition takes over (ESCSUITE-139):
   * `'in'` for the incoming side, `'out'` for the outgoing one. Handed straight
   * to `getAnimatedValues`' `suppressPreset`, so the side arriving under a fade
   * is not also faded in by its own fade-in preset, and the side leaving is not
   * faded out twice.
   *
   * Unlike every other field here it is not geometry: it applies to a side of
   * *any* active transition, including a type with no geometry of its own, and
   * it is the one field a caller outside `drawTransition` /
   * `drawTransitionWithFrames` never sets. An ordinary (non-transition) draw
   * passes no modifiers at all, which is why a preset outside a transition
   * window is untouched.
   */
  suppressPreset?: PresetSide;
}

/**
 * Per-call overrides for drawing a media clip. Every default reproduces the
 * export pipeline's own behaviour: the exporters pass none of these, the live
 * preview passes the two it needs.
 */
export interface MediaDrawOptions {
  /**
   * Say nothing about media that is not ready to draw. An export reports it
   * once per frame and a frame is drawn once; a preview redraws the same frame
   * on every animation frame, and would repeat the same warning sixty times a
   * second for as long as the playhead sat there.
   */
  quiet?: boolean;
  /**
   * Device pixels per drawing unit, for the lengths that are not in drawing
   * units at all.
   *
   * `ctx.filter` is the exception to everything else on a 2D context: a
   * `blur(4px)` is four pixels of the *output bitmap* and the current transform
   * does not touch it (verified in Chromium — the same filter over a halved
   * transform blurs across exactly as many device pixels). Everywhere the
   * canvas is the project — every export — that distinction does not exist and
   * this stays 1. The preview rasterises at the size it is displayed at, so a
   * blur the project calls 4px has to be asked for in the device pixels that
   * many project pixels currently occupy, or the picture in the editor would
   * blur harder than the file it exports.
   */
  filterScale?: number;
}

/**
 * Calculate total timeline duration from clips
 */
export function calculateTimelineDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map(c => c.timelinePosition + c.duration));
}

// Animated values type for overlays
export interface AnimatedOverlayValues {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blur: number;
}
