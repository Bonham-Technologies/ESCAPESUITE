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
import { elementSeekTarget } from './elementSeek';
import { countWedgedSeek } from './seekWedge';
import {
  getActiveTransition,
  loadVideoElement,
  loadVideoElementFromUrl,
  loadImageElement,
  type MediaDrawOptions,
} from './exportTypes';
import { assignElementSlots, videoForSlot } from './elementSlots';
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawTransition,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';

/** The `<video>` and `<img>` elements an export draws its media clips from, by source id. */
export interface ElementSources {
  /** Each video source's own element: slot 0 (`core/elementSlots.ts`). */
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  /**
   * Each video source's further elements, slot 1 onwards (ESCSUITE-313): one
   * per clip of that source live in the same frame beyond the first, made the
   * first time a frame needs it, over the source's one object URL, and kept
   * for the rest of the export. `null` is a slot whose element would not load;
   * its clip is left out rather than retried every frame. Every loaded video
   * source has an entry, empty until a frame needs a second element.
   */
  extraVideoElements: Map<string, (HTMLVideoElement | null)[]>;
  /**
   * The name each loaded `<video>`'s source is known by — its `SourceVideo.name`,
   * or its id when the export was not handed its record — for the refusal a
   * source whose seeks never complete fails the export with (ESCSUITE-305).
   */
  sourceNames: Map<string, string>;
}

/**
 * Whether each `<video>` is playing, and where it was last asked to be — by
 * element, since a source can have more than one (ESCSUITE-313).
 */
export type VideoPlaybackState = Map<HTMLVideoElement, { playing: boolean; targetTime: number }>;

/** Every `<video>` an export holds, each source's further elements included. */
function forEachVideoElement(sources: ElementSources, visit: (video: HTMLVideoElement) => void): void {
  sources.videoElements.forEach((video) => visit(video));
  sources.extraVideoElements.forEach((extras) => {
    for (const video of extras) {
      if (video) visit(video);
    }
  });
}

/**
 * Load every unique media source the clips reference into an element.
 *
 * A source with no bytes in storage, an audio-only source, a clip with no
 * source id at all (every overlay) and — since ESCSUITE-156 — a file that will
 * not decode as either a video or an image are all skipped rather than failing
 * the export: a timeline that references something missing renders without it,
 * the way the editor's own preview does.
 *
 * The loader owns every element it has created until it returns, and nothing
 * else can: a caller only ever gets the map, so a rejection partway through —
 * a storage read that fails on the fourth source, say — would strand the three
 * before it with no handle left to free them by (ESCSUITE-156).
 */
export async function loadElementSources(
  clips: Clip[],
  sourceMap: Map<string, SourceVideo>
): Promise<ElementSources> {
  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();
  const extraVideoElements: Map<string, (HTMLVideoElement | null)[]> = new Map();
  const sourceNames: Map<string, string> = new Map();

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  try {
    for (const sourceId of uniqueSourceIds) {
      const source = sourceMap.get(sourceId);
      const blob = await getVideoBlob(sourceId);

      if (blob) {
        if (source?.mediaType === 'image') {
          // Load as image. A corrupt or unsupported image is warned about and
          // skipped, exactly as a video that loads as neither is below
          // (ESCSUITE-156): one bad file in the library degrades the export
          // rather than failing it.
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        } else if (source?.mediaType !== 'audio') {
          // Load as video (skip audio-only files for visual rendering)
          try {
            const video = await loadVideoElement(blob);
            videoElements.set(sourceId, video);
            extraVideoElements.set(sourceId, []);
            sourceNames.set(sourceId, source?.name ?? sourceId);
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
  } catch (e) {
    // Nothing reaches a caller, so nothing else could free what is already
    // loaded. Both media branches warn and skip, so the only way here is a
    // failed storage read.
    releaseElementSources({ videoElements, imageElements, extraVideoElements, sourceNames });
    throw e;
  }

  return { videoElements, imageElements, extraVideoElements, sourceNames };
}

/**
 * Pause and rewind every loaded `<video>`: the one-time setup a frame loop does
 * before its first frame. The returned map is the state the composer keeps.
 *
 * These are the seeks `exportWebM.perf.test.ts` discounts as `initSeeks` — one
 * per element, never part of the per-frame cost. An element the composer makes
 * later for a second live clip of a source (ESCSUITE-313) is not rewound: it
 * arrives freshly loaded, already paused at 0, and the composer enters it here
 * itself.
 */
export function rewindElementSources(sources: ElementSources): VideoPlaybackState {
  const playbackState: VideoPlaybackState = new Map();
  forEachVideoElement(sources, (video) => {
    video.pause();
    video.currentTime = 0;
    playbackState.set(video, { playing: false, targetTime: 0 });
  });
  return playbackState;
}

/**
 * Pause every `<video>` and revoke every object URL — once per source: a
 * source's further elements read the URL its own element holds.
 */
export function releaseElementSources(sources: ElementSources): void {
  sources.videoElements.forEach((v) => {
    URL.revokeObjectURL(v.src);
  });
  forEachVideoElement(sources, (v) => v.pause());
  sources.imageElements.forEach((img) => {
    URL.revokeObjectURL(img.src);
  });
}

/**
 * A release that runs at most once (ESCSUITE-159).
 *
 * Both element exporters release at the end of a successful export *and* in the
 * `catch` that owns everything built after the media load (ESCSUITE-156) — and
 * the two are not exclusive: anything that throws between them reaches both. The
 * caller's own `onProgress({ phase: 'complete' })` callback is one such thing,
 * and the WebM "no data was written to buffer" refusal is another, so one export
 * could revoke every object URL twice. The browser does not mind; a reader does
 * — a handle freed twice looks like a handle something else still holds — and a
 * release that is only correct because nothing after it throws is a release
 * waiting for the next line of code.
 */
export function createElementSourceRelease(sources: ElementSources): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseElementSources(sources);
  };
}

/**
 * Sync a video to a target time. Seeks to just past the target
 * (`elementSeekTarget`, ESCSUITE-265) for frame-accurate export, skipping the
 * seek when the element is already within (a little under) half an output
 * frame of it.
 *
 * Resolves to whether a seek it issued landed ('seeked' fired) — what the
 * wedge count reads alongside the element's state once both waits are over
 * (`seekWedge.ts`, ESCSUITE-305). A skipped seek did not land.
 */
async function syncVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  frameRate: number
): Promise<boolean> {
  let seekLanded = false;
  // Skip if already within (a little under) half a frame of the target.
  const frameDuration = 1 / frameRate;
  if (Math.abs(video.currentTime - targetTime) > frameDuration * 0.4) {
    // Just past the target: a target on a frame's exact start would otherwise
    // show the frame before it a third of the time (ESCSUITE-265).
    video.currentTime = elementSeekTarget(targetTime);
    // Two waits race here as well, and — ESCSUITE-159 — whichever settles the
    // wait cancels the other, exactly as the readiness poll below now does. The
    // seek used to leave its 500 ms fallback pending, to resolve an
    // already-settled promise half a second later (a frame apiece, for a whole
    // export's worth of frames), and a fallback that won used to leave its
    // `{ once: true }` 'seeked' listener on an element whose object URL the
    // export is about to revoke.
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        clearTimeout(fallback);
        seekLanded = true;
        resolve();
      };
      const fallback = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 500);
      video.addEventListener('seeked', onSeeked, { once: true });
    });
  }

  // Ensure frame data is decoded (readyState >= 2 = HAVE_CURRENT_DATA).
  //
  // Two waits race: a `requestAnimationFrame` poll on `readyState` and a 300 ms
  // fallback that gives up. Whichever settles the wait cancels the other
  // (ESCSUITE-156) — the poll used to keep re-queueing itself after the
  // fallback had already resolved, so a source that never becomes ready cost an
  // animation frame per frame for the life of the page, long outliving the
  // export that started it.
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      let pollHandle = 0;
      const fallback = setTimeout(() => {
        cancelAnimationFrame(pollHandle);
        resolve();
      }, 300);
      const check = () => {
        if (video.readyState >= 2) {
          clearTimeout(fallback);
          resolve();
        } else {
          pollHandle = requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  return seekLanded;
}

export interface FrameComposerParams {
  ctx: CanvasRenderingContext2D;
  /** The same canvas `ctx` belongs to — a background-blurring shape overlay reads it back. */
  canvas: HTMLCanvasElement;
  clips: Clip[];
  tracks: Track[];
  sources: ElementSources;
  /** Must be the map `rewindElementSources(sources)` returned for the same `sources`. */
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
 * transform followed immediately by the full-raster black fill — and that pair
 * is also how both export perf files split their recorded canvas calls into
 * frames. Those files pin **one open per frame**, not its position: their
 * splitter buckets on the pair wherever it falls, so moving this call to the end
 * of the frame leaves every one of their medians green. What pins it *first* is
 * `elementFrames.test.ts`'s "opens the frame by clearing the whole raster to
 * black", which asserts the order over `ctx.calls` — and first is load-bearing
 * for a pipeline that reads the frame back (a GIF frame captured with
 * `ctx.getImageData` after a late clear would be black).
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
  const { videoElements, imageElements, extraVideoElements, sourceNames } = sources;
  // Consecutive wedged seeks per element (ESCSUITE-305): one integer per
  // element, compared once per seek, on a path that already waits on it. Keyed
  // by element, not by source — a source's further elements (ESCSUITE-313) each
  // have a playhead of their own, so each wedges, or recovers, on its own — and
  // the refusal names the source the element reads.
  const wedgedSeeks = new Map<HTMLVideoElement, number>();

  /** Sync one element and count it against the wedge limit; throws by name at the limit. */
  const syncCounted = async (sourceId: string, video: HTMLVideoElement, sourceTime: number) => {
    const seekLanded = await syncVideoToTime(video, sourceTime, frameRate);
    wedgedSeeks.set(
      video,
      countWedgedSeek(wedgedSeeks.get(video) ?? 0, video, seekLanded, sourceNames.get(sourceId)!)
    );
  };

  /**
   * Make a source's further elements up to `slot` (ESCSUITE-313), each over the
   * URL its own element reads. One that will not load is warned about once and
   * kept as `null`, so its clip is left out instead of retried every frame.
   */
  const growSlots = async (sourceId: string, extras: (HTMLVideoElement | null)[], slot: number) => {
    const url = videoElements.get(sourceId)!.src;
    while (extras.length < slot) {
      try {
        const video = await loadVideoElementFromUrl(url);
        playbackState.set(video, { playing: false, targetTime: 0 });
        extras.push(video);
      } catch {
        console.warn(`Could not load a second element for video ${sourceId}; the clip it was for is left out`);
        extras.push(null);
      }
    }
  };

  // Which of its source's elements each live clip draws from: the k-th live
  // clip of a source is that source's k-th element, so two clips of one
  // source — a split clip crossfading into itself, a picture-in-picture
  // copy — are two playheads, not one moved twice (ESCSUITE-313). A source
  // with one live clip uses its own element and nothing else. One map for the
  // composer's life, refilled every frame, and the lookups that read it built
  // here once: the slot arithmetic costs a frame no allocation.
  const slots = new Map<string, number>();
  const videoFor = (clip: Clip) =>
    videoForSlot(videoElements, extraVideoElements, clip.sourceVideoId, slots.get(clip.id)!);
  // The further elements a clip's slot needs and its source does not have yet.
  const missingSlots = (clip: Clip) => {
    const extras = extraVideoElements.get(clip.sourceVideoId);
    return extras && extras.length < slots.get(clip.id)! ? extras : undefined;
  };
  // The elements this frame seeks, cleared each frame rather than rebuilt.
  const activeVideos = new Set<HTMLVideoElement>();
  const pauseIfIdle = (video: HTMLVideoElement) => {
    if (activeVideos.has(video)) return;
    const state = playbackState.get(video)!;
    if (state.playing) {
      video.pause();
      state.playing = false;
    }
  };

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

    assignElementSlots(activeClips, activeTransition, slots);
    // The further elements this frame needs and does not have yet, made before
    // any seek so the seeks below still run together.
    for (const { clip } of mediaClips) {
      const extras = missingSlots(clip);
      if (extras) await growSlots(clip.sourceVideoId, extras, slots.get(clip.id)!);
    }
    const incomingExtras = activeTransition && missingSlots(activeTransition.incomingClip);
    if (incomingExtras) {
      await growSlots(activeTransition.incomingClip.sourceVideoId, incomingExtras, slots.get(activeTransition.incomingClip.id)!);
    }

    // Sync all active videos to their target times
    const syncPromises: Promise<void>[] = [];
    activeVideos.clear();

    for (const { clip, clipTime } of mediaClips) {
      const video = videoFor(clip);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      activeVideos.add(video);
      syncPromises.push(syncCounted(clip.sourceVideoId, video, sourceTime));
    }

    // Also sync transition clips
    if (activeTransition) {
      const incomingVideo = videoFor(activeTransition.incomingClip);
      if (incomingVideo) {
        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const incomingClipTime = currentTime - clipEnd;
        const sourceTime = incomingClipTime >= 0
          ? activeTransition.incomingClip.startTime + incomingClipTime
          : activeTransition.incomingClip.startTime;
        activeVideos.add(incomingVideo);
        syncPromises.push(syncCounted(activeTransition.incomingClip.sourceVideoId, incomingVideo, sourceTime));
      }
    }

    // Pause videos that are no longer active. Two plain loops rather than
    // `forEachVideoElement` and a callback: this runs every frame.
    for (const video of videoElements.values()) pauseIfIdle(video);
    for (const extras of extraVideoElements.values()) {
      for (const video of extras) {
        if (video) pauseIfIdle(video);
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
        const video = videoFor(clip);
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
        ctx, videoFor(activeTransition.outgoingClip), videoFor(activeTransition.incomingClip),
        imageElements, activeTransition, currentTime,
        projectSize.width, projectSize.height, drawOptions
      );
    }
  };
}
