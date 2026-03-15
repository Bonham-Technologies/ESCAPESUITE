// Shared types, constants, and utility functions for the export pipeline

import type { Clip, Track, ExportOptions, ExportProgress, BlendMode } from '../store/types';

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
 * Get resolution dimensions.
 * When resolution is 'project', uses projectResolution if provided.
 * When resolution is 'original', uses the source video dimensions.
 * Preset resolutions (1080p, 720p, 480p) scale based on the source aspect ratio.
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

  if (resolution === 'original' || resolution === 'project') {
    // Fall back to original if 'project' but no projectResolution provided
    return {
      width: originalWidth % 2 === 0 ? originalWidth : originalWidth + 1,
      height: originalHeight % 2 === 0 ? originalHeight : originalHeight + 1
    };
  }

  const targetHeights: Record<string, number> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
  };

  const targetHeight = targetHeights[resolution] || originalHeight;
  const aspectRatio = originalWidth / originalHeight;
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

// Track last seek position per video (used by playback sync functions)
const lastSeekPositions = new Map<string, number>();

/**
 * Clear seek position tracking (call at start of export)
 * Exported for testing
 */
export function clearSeekPositions(): void {
  lastSeekPositions.clear();
}

/**
 * Get the current seek positions map size (for testing)
 */
export function getSeekPositionsCount(): number {
  return lastSeekPositions.size;
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
