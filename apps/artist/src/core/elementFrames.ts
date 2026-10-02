// The per-frame machinery an exporter that draws media *elements* needs
// (ESCSUITE-34).
//
// `exportWebM.ts` had all of this inline: load each unique source into a
// `<video>` or `<img>`, rewind them once, seek the live ones to their clip time
// each frame, draw every live clip in one track-ordered pass, draw the
// transition if one is running, and revoke the object URLs at the end. GIF
// export needs exactly the same thing with a different encoder at the end of the
// frame, so it was lifted here rather than copied — a per-frame drawing
// behaviour one pipeline has to remember to reproduce is a behaviour that
// drifts, which is the same argument `core/outputTransform.ts` was written on.
//
// `exportMP4.ts` is NOT a caller: it decodes through `VideoDecodeManager` and
// `frameSource.ts` and draws `VideoFrame`s, so it shares the renderer but not
// this. There are two element-drawing pipelines, not three.
//
// Lifted unchanged, deliberately — the same `console.warn` strings, the same
// 500 ms seek fallback and 300 ms readiness fallback, the same `readyState >= 2`
// gate. A move that also tidies is a move whose regressions cannot be
// attributed, and `exportWebM.perf.test.ts` is byte-identical across it.
import type { Clip, SourceVideo, Track } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValues } from '../utils/animation';
import { openOutputFrame, type PixelSize } from './outputTransform';
import {
  getActiveTransition,
  loadVideoElement,
  loadImageElement,
  type MediaDrawOptions,
} from './exportTypes';
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawTransition,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';

/** The `<video>` and `<img>` elements an export draws its media clips from, by source id. */
export interface ElementSources {
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
}

/** Whether each loaded `<video>` is playing, and where it was last asked to be. */
export type VideoPlaybackState = Map<string, { playing: boolean; targetTime: number }>;

/**
 * Load every unique media source the clips reference into an element.
 *
 * A source with no bytes in storage, an audio-only source, and a clip with no
 * source id at all (every overlay) are all skipped rather than failing the
 * export: a timeline that references something missing renders without it, the
 * way the editor's own preview does.
 */
export async function loadElementSources(
  clips: Clip[],
  sourceMap: Map<string, SourceVideo>
): Promise<ElementSources> {
  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video (skip audio-only files for visual rendering)
        try {
          const video = await loadVideoElement(blob);
          videoElements.set(sourceId, video);
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  return { videoElements, imageElements };
}

/**
 * Pause and rewind every loaded `<video>`: the one-time setup a frame loop does
 * before its first frame. The returned map is the state the composer keeps.
 *
 * These are the seeks `exportWebM.perf.test.ts` discounts as `initSeeks` — one
 * per element, never part of the per-frame cost.
 */
export function rewindElementSources(sources: ElementSources): VideoPlaybackState {
  const playbackState: VideoPlaybackState = new Map();
  for (const [sourceId, video] of sources.videoElements) {
    video.pause();
    video.currentTime = 0;
    playbackState.set(sourceId, { playing: false, targetTime: 0 });
  }
  return playbackState;
}

/** Pause every `<video>` and revoke every element's object URL. */
export function releaseElementSources(sources: ElementSources): void {
  sources.videoElements.forEach((v) => {
    v.pause();
    URL.revokeObjectURL(v.src);
  });
  sources.imageElements.forEach((img) => {
    URL.revokeObjectURL(img.src);
  });
}

/**
 * Sync a video to a target time. Always seeks to the exact time for
 * frame-accurate export, skipping the seek when the element is already within
 * (a little under) half an output frame of it.
 */
async function syncVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  frameRate: number
): Promise<void> {
  // Always seek to exact time for frame-accurate export.
  // Skip if already within half a frame of the target.
  const frameDuration = 1 / frameRate;
  if (Math.abs(video.currentTime - targetTime) > frameDuration * 0.4) {
    video.currentTime = targetTime;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      setTimeout(resolve, 500);
    });
  }

  // Ensure frame data is decoded (readyState >= 2 = HAVE_CURRENT_DATA)
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (video.readyState >= 2) resolve();
        else requestAnimationFrame(check);
      };
      check();
      setTimeout(resolve, 300);
    });
  }
}

export interface FrameComposerParams {
  ctx: CanvasRenderingContext2D;
  /** The same canvas `ctx` belongs to — a background-blurring shape overlay reads it back. */
  canvas: HTMLCanvasElement;
  clips: Clip[];
  tracks: Track[];
  sources: ElementSources;
  playbackState: VideoPlaybackState;
  projectSize: PixelSize;
  outputSize: PixelSize;
  drawOptions: MediaDrawOptions;
  /** Output frame rate — the seek tolerance is a little under half a frame of it. */
  frameRate: number;
}

/** Draw the whole timeline at one instant onto `ctx`. Resolves once the frame is complete. */
export type FrameComposer = (currentTime: number) => Promise<void>;

/**
 * One frame of the timeline, drawn with media *elements*.
 *
 * The first call every frame makes is `openOutputFrame` — the project-to-output
 * transform followed immediately by the full-raster black fill — which is also
 * how both export perf files split their recorded canvas calls into frames. It
 * stays first here so that splitter holds for every element-drawing pipeline.
 */
export function createFrameComposer({
  ctx,
  canvas,
  clips,
  tracks,
  sources,
  playbackState,
  projectSize,
  outputSize,
  drawOptions,
  frameRate,
}: FrameComposerParams): FrameComposer {
  const { videoElements, imageElements } = sources;

  return async function composeFrame(currentTime: number): Promise<void> {
    // Check for active transition
    const activeTransition = getActiveTransition(clips, tracks, currentTime);

    // Get all clips at current time
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    // Clear the raster to black and put the context in project pixels: every
    // draw below is project-space, exactly as the preview's is.
    openOutputFrame(ctx, projectSize, outputSize);

    // Media clips need their source video synced to time (below) before
    // anything can be drawn; overlays don't. `activeClips` itself —
    // `getClipsAtTime`'s result — is already sorted by track index, and
    // stays the single source of composite order: see the draw loop below.
    const mediaClips: typeof activeClips = [];

    for (const clipData of activeClips) {
      if (!clipData.clip.overlayType) {
        mediaClips.push(clipData);
      }
    }

    // Sync all active videos to their target times
    const syncPromises: Promise<void>[] = [];
    const activeVideoIds = new Set<string>();

    for (const { clip, clipTime } of mediaClips) {
      const video = videoElements.get(clip.sourceVideoId);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      activeVideoIds.add(clip.sourceVideoId);
      syncPromises.push(syncVideoToTime(video, sourceTime, frameRate));
    }

    // Also sync transition clips
    if (activeTransition) {
      const incomingVideo = videoElements.get(activeTransition.incomingClip.sourceVideoId);
      if (incomingVideo) {
        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const incomingClipTime = currentTime - clipEnd;
        const sourceTime = incomingClipTime >= 0
          ? activeTransition.incomingClip.startTime + incomingClipTime
          : activeTransition.incomingClip.startTime;
        activeVideoIds.add(activeTransition.incomingClip.sourceVideoId);
        syncPromises.push(syncVideoToTime(incomingVideo, sourceTime, frameRate));
      }
    }

    // Pause videos that are no longer active
    for (const [sourceId, video] of videoElements) {
      if (!activeVideoIds.has(sourceId)) {
        const state = playbackState.get(sourceId)!;
        if (state.playing) {
          video.pause();
          state.playing = false;
        }
      }
    }

    await Promise.all(syncPromises);

    // Helper to calculate clip time
    const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

    // Composite media and overlay clips in one pass, in `activeClips`' own
    // track order — the same single interleaved pass the preview draws
    // (`components/Preview/drawFrame.ts`), so an overlay on a lower track
    // than a media clip is exactly as hidden behind it here as it is on
    // screen, and a blur shape only reaches the content actually below it.
    for (const { clip } of activeClips) {
      // Skip clips that are part of an active transition
      if (activeTransition &&
          (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
        continue;
      }

      if (!clip.overlayType) {
        const clipTime = getClipTime(clip);

        // Try video first, then image - require readyState >= 2 (frame data available)
        const video = videoElements.get(clip.sourceVideoId);
        if (video && video.readyState >= 2) {
          drawClipToCanvas(
            ctx, video, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
          );
          continue;
        }

        const image = imageElements.get(clip.sourceVideoId);
        if (image) {
          drawImageToCanvasWithModifiers(
            ctx, image, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
          );
        }
        continue;
      }

      const overlayClipTime = getClipTime(clip);

      // Build base transform from overlay's own properties
      let baseTransform = clip.transform || DEFAULT_TRANSFORM;

      if (clip.overlayType === 'text' && clip.textData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.textData.x,
          y: clip.textData.y,
          scaleX: clip.textData.scale ?? 1,
          scaleY: clip.textData.scale ?? 1,
          rotation: clip.textData.rotation ?? 0,
        };
      } else if (clip.overlayType === 'shape' && clip.shapeData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.shapeData.x,
          y: clip.shapeData.y,
          rotation: clip.shapeData.rotation,
        };
      }

      const animated = getAnimatedValues(
        overlayClipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      if (clip.overlayType === 'shape' && clip.shapeData) {
        drawShapeOverlayToCanvasAnimated(
          ctx, clip.shapeData, projectSize.width, projectSize.height, animated, canvas,
          undefined, drawOptions.filterScale
        );
      } else if (clip.overlayType === 'text' && clip.textData) {
        drawTextOverlayToCanvasAnimated(
          ctx, clip.textData, projectSize.width, projectSize.height, animated, drawOptions.filterScale
        );
      }
    }

    // Draw transition if active
    if (activeTransition) {
      drawTransition(
        ctx, videoElements, imageElements, activeTransition, currentTime,
        projectSize.width, projectSize.height, drawOptions
      );
    }
  };
}
