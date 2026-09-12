// One composited preview frame, drawn from the timeline as it stands.
//
// The drawing itself is the export pipeline's — `core/canvasRenderer` — so a
// frame in the editor and the same frame in an export come out of the same
// code. What lives here is the preview's own arrangement of it: track order,
// which clips a transition takes over, the legacy overlay arrays, and the
// decisions about what is drawable at all mid-scrub.
//
// Everything it reads is a parameter. The component owns the canvas, the
// cached 2D context and the frame cache; this owns none of them, which is why
// the whole of it can be exercised without a React render.
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawShapeOverlayToCanvasAnimated,
  drawTextOverlayToCanvasAnimated,
  drawTransition,
  shapeBlursBackground,
} from '../../core/canvasRenderer';
import type { MediaDrawOptions, TransitionModifiers } from '../../core/exportTypes';
import { getClipsAtTime } from '../../store/projectStore';
import { getAnimatedValues } from '../../utils/animation';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import type { Clip, ShapeOverlay, SourceVideo, TextOverlay, Track } from '../../store/types';
import { getActiveTransition } from './transitions';

/**
 * How the preview draws media clips, as against how an export does.
 *
 * `uncachedAnimation`: the export memo cache is keyed by clip id and clip time
 * and only cleared when an export starts, so an editor that redraws the same
 * clip at the same time after every edit would keep drawing pre-edit values.
 * `quiet`: media that is not ready yet is ordinary mid-scrub, and this frame
 * is redrawn sixty times a second — the exporter's one-off warning would be a
 * console flood here.
 */
export const PREVIEW_DRAW_OPTIONS: MediaDrawOptions = {
  uncachedAnimation: true,
  quiet: true,
};

/** Everything on the timeline that a preview frame is drawn from. */
export interface PreviewFrameScene {
  clips: Clip[];
  tracks: Track[];
  sourceVideos: SourceVideo[];
  textOverlays: TextOverlay[];
  shapeOverlays: ShapeOverlay[];
  /** The text clip the inline editor has taken over, which the canvas must not draw. */
  editingTextClipId: string | null;
}

/** The decoded media a frame draws with, and the scratch canvas blur borrows. */
export interface PreviewFrameMedia {
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  /**
   * Holds the one scratch canvas a blur shape captures the frame so far into.
   * A ref rather than a canvas because the preview redraws continuously: a
   * fresh full-size canvas per frame would cost 8MB+ each time. Starts null —
   * a timeline with nothing that blurs never allocates one.
   */
  blurScratch: { current: HTMLCanvasElement | null };
}

/**
 * The scratch canvas for this frame, allocated or resized only when it has to be.
 */
function blurScratchFor(
  blurScratch: { current: HTMLCanvasElement | null },
  canvas: HTMLCanvasElement
): HTMLCanvasElement {
  const scratch = blurScratch.current;
  if (!scratch || scratch.width !== canvas.width || scratch.height !== canvas.height) {
    const replacement = document.createElement('canvas');
    replacement.width = canvas.width;
    replacement.height = canvas.height;
    blurScratch.current = replacement;
    return replacement;
  }
  return scratch;
}

/**
 * Draw a single media clip, with optional transition modifiers.
 *
 * The drawing is the export pipeline's — same geometry, same blend, same
 * transition modifiers. What is the preview's own is the decision about
 * *whether* a clip can be drawn at all: an audio clip has nothing to show, and
 * a video or image the browser has not decoded yet would paint a black flash
 * mid-scrub if it were drawn at a fallback size.
 */
function drawClip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  scene: Pick<PreviewFrameScene, 'sourceVideos'>,
  media: Pick<PreviewFrameMedia, 'videoElements' | 'imageElements'>,
  transitionModifiers?: TransitionModifiers
): void {
  // Check media type
  const sourceMedia = scene.sourceVideos.find(s => s.id === clip.sourceVideoId);
  const isImage = sourceMedia?.mediaType === 'image';
  const isAudio = sourceMedia?.mediaType === 'audio';

  // Audio clips don't render visually - skip drawing
  if (isAudio) return;

  if (isImage) {
    const img = media.imageElements.get(clip.sourceVideoId);
    if (!img || !img.complete) return;
    drawImageToCanvasWithModifiers(
      ctx, img, clip, clipTime, canvas.width, canvas.height, transitionModifiers, PREVIEW_DRAW_OPTIONS
    );
    return;
  }

  const video = media.videoElements.get(clip.sourceVideoId);
  // Allow drawing if video has any data (readyState >= 1 means metadata loaded)
  // During seeking, readyState may temporarily drop, but we can still draw the current frame
  // This prevents black flashes during scrubbing
  if (!video || video.readyState < 1) return;
  // If video dimensions aren't available yet, skip
  if (!video.videoWidth || !video.videoHeight) return;
  drawClipToCanvas(
    ctx, video, clip, clipTime, canvas.width, canvas.height, transitionModifiers, PREVIEW_DRAW_OPTIONS
  );
}

/** Draw one overlay clip with its animated transform. */
function drawOverlayClip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  clip: Clip,
  time: number,
  editingTextClipId: string | null,
  blurScratch: { current: HTMLCanvasElement | null }
): void {
  const overlayClipTime = time - clip.timelinePosition;

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

  // Get animated values using overlay's properties as base
  const animated = getAnimatedValues(
    overlayClipTime,
    clip.duration,
    clip.animation,
    baseTransform,
    clip.effects || DEFAULT_EFFECTS
  );

  // Draw overlay with animated transform values
  // Skip drawing text that is currently being inline-edited (to avoid duplicate)
  if (clip.overlayType === 'shape' && clip.shapeData) {
    // A blur shape captures the frame so far from the canvas itself, into
    // the one scratch canvas this preview reuses across frames. Shapes
    // that cannot blur ask for neither.
    const blurs = shapeBlursBackground(clip.shapeData);
    drawShapeOverlayToCanvasAnimated(
      ctx,
      clip.shapeData,
      canvas.width,
      canvas.height,
      animated,
      blurs ? canvas : undefined,
      blurs ? blurScratchFor(blurScratch, canvas) : undefined
    );
  } else if (clip.overlayType === 'text' && clip.textData) {
    if (clip.id !== editingTextClipId) {
      drawTextOverlayToCanvasAnimated(ctx, clip.textData, canvas.width, canvas.height, animated);
    }
  }
}

/**
 * Composite the timeline at `time` onto the canvas.
 *
 * The caller owns the frame cache: this always draws, and always draws the
 * whole frame, starting from a reset context and a black fill.
 */
export function drawPreviewFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  time: number,
  scene: PreviewFrameScene,
  media: PreviewFrameMedia
): void {
  const { clips, tracks, textOverlays, shapeOverlays, editingTextClipId } = scene;

  // Reset all canvas state to defaults before drawing
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform matrix

  // Clear canvas
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Check for active transitions
  const activeTransition = getActiveTransition(clips, tracks, time);

  // Get active clips at this time
  const activeClips = getClipsAtTime(clips, tracks, time);

  // Sort ALL clips by track index (lower = bottom, rendered first)
  // This ensures proper z-ordering: blur overlays only affect content below them
  const sortedClips = [...activeClips].sort((a, b) => {
    return (a.track?.index || 0) - (b.track?.index || 0);
  });

  // Draw all clips in track order (media and overlays interleaved for proper z-order)
  for (const { clip } of sortedClips) {
    if (clip.overlayType) {
      // Draw overlay clip
      drawOverlayClip(ctx, canvas, clip, time, editingTextClipId, media.blurScratch);
    } else {
      // Draw media clip - check if it's part of an active transition
      if (activeTransition &&
          (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
        // This clip will be drawn as part of the transition
        continue;
      }
      // Draw clip normally
      drawClip(ctx, canvas, clip, time - clip.timelinePosition, scene, media);
    }
  }

  // Draw transition if active
  if (activeTransition) {
    drawTransition(
      ctx,
      media.videoElements,
      media.imageElements,
      activeTransition,
      time,
      canvas.width,
      canvas.height,
      PREVIEW_DRAW_OPTIONS
    );
  }

  // Draw shape and text overlays from the legacy arrays (for backwards
  // compatibility). A legacy overlay has no animation of its own: its stored
  // position, rotation and opacity *are* the values it draws with.
  for (const shape of shapeOverlays) {
    if (time < shape.startTime || time >= shape.endTime) continue;

    drawShapeOverlayToCanvasAnimated(ctx, shape, canvas.width, canvas.height, {
      x: shape.x,
      y: shape.y,
      scaleX: 1,
      scaleY: 1,
      rotation: shape.rotation,
      opacity: shape.opacity,
      blur: 0,
    });
  }

  for (const overlay of textOverlays) {
    if (time < overlay.startTime || time >= overlay.endTime) continue;

    drawTextOverlayToCanvasAnimated(ctx, overlay, canvas.width, canvas.height, {
      x: overlay.x,
      y: overlay.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: overlay.opacity,
      blur: 0,
    });
  }
}
