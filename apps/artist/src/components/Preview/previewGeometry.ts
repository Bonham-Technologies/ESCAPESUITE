// Where things are on the preview canvas.
//
// Pure functions: everything they read is a parameter, so the same maths backs
// the component's rendering, its mouse handling and its tests without a ref, a
// store subscription or a React render in sight.
import { getAnimatedValues } from '../../utils/animation';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import type { Clip, SourceVideo } from '../../store/types';
import type { ManipulableClipType, NormalizedPoint, OverlayBounds, ProjectSize } from './types';

/** The project size the preview assumes when a project records none. */
export const DEFAULT_PROJECT_WIDTH = 1920;
export const DEFAULT_PROJECT_HEIGHT = 1080;

// Handle size in pixels (for hit detection and drawing)
export const HANDLE_SIZE = 8;
export const ROTATION_HANDLE_OFFSET = 25; // Distance above the bounding box

/**
 * Get overlay bounds in project pixels for a given clip.
 * Uses animated values from keyframes when available.
 *
 * Text is measured through the canvas' own 2D context, so the caller has to
 * pass the canvas the bounds are for rather than just its dimensions. The
 * measurement is transform-independent — `measureText` reports user-space
 * units, and the font is set in project pixels — so the bounds come out in
 * project space however the canvas happens to be rasterised.
 *
 * `project` defaults to the canvas' own pixel size, which is right only where
 * the canvas *is* the project (the exporters' canvases, and the tests that
 * build one). The preview rasterises at its displayed size and passes its
 * project resolution explicitly.
 */
export function getOverlayBounds(
  clip: Clip,
  canvas: HTMLCanvasElement,
  time: number | undefined,
  sourceVideos: SourceVideo[],
  project: ProjectSize = canvas
): OverlayBounds | null {
  // Calculate animated values if time is provided
  let animatedX: number | undefined;
  let animatedY: number | undefined;
  let animatedScaleX: number | undefined;
  let animatedScaleY: number | undefined;
  let animatedRotation: number | undefined;

  if (time !== undefined && clip.animation) {
    const clipTime = time - clip.timelinePosition;
    if (clipTime >= 0 && clipTime <= clip.duration) {
      // Build base transform from overlay properties
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
        clipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      animatedX = animated.x;
      animatedY = animated.y;
      animatedScaleX = animated.scaleX;
      animatedScaleY = animated.scaleY;
      animatedRotation = animated.rotation;
    }
  }

  if (clip.overlayType === 'shape' && clip.shapeData) {
    const x = animatedX ?? clip.shapeData.x;
    const y = animatedY ?? clip.shapeData.y;
    const scaleX = animatedScaleX ?? 1;
    const scaleY = animatedScaleY ?? 1;
    const rotation = animatedRotation ?? clip.shapeData.rotation;

    return {
      centerX: x * project.width,
      centerY: y * project.height,
      width: clip.shapeData.width * project.width * scaleX,
      height: clip.shapeData.height * project.height * scaleY,
      rotation,
    };
  } else if (clip.overlayType === 'text' && clip.textData) {
    // For text, we need to measure it
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const textData = clip.textData;
    const baseScale = textData.scale ?? 1;
    const scaleX = animatedScaleX ?? baseScale;
    const scaleY = animatedScaleY ?? baseScale;
    const scale = Math.max(scaleX, scaleY);
    const x = animatedX ?? textData.x;
    const y = animatedY ?? textData.y;
    const rotation = animatedRotation ?? (textData.rotation ?? 0);

    const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
    // The context is the preview's own, and the next frame draws through it:
    // the measuring font has to come back off again.
    ctx.save();
    ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
    const lines = textData.text.split('\n');
    const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    ctx.restore();
    const lineHeight = textData.fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const textWidth = maxLineWidth * scale;
    const textHeight = totalHeight * scale;

    // Adjust center based on text alignment
    let centerX = x * project.width;
    if (textData.textAlign === 'left') {
      centerX += textWidth / 2;
    } else if (textData.textAlign === 'right') {
      centerX -= textWidth / 2;
    }

    return {
      centerX,
      centerY: y * project.height,
      width: textWidth,
      height: textHeight,
      rotation,
    };
  } else if (!clip.overlayType && clip.sourceVideoId) {
    // Image or video clip - use transform properties
    const transform = clip.transform || DEFAULT_TRANSFORM;
    const x = animatedX ?? transform.x;
    const y = animatedY ?? transform.y;
    const scaleX = animatedScaleX ?? transform.scaleX;
    const scaleY = animatedScaleY ?? transform.scaleY;
    const rotation = animatedRotation ?? (transform.rotation ?? 0);

    // Get the source media dimensions
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return null;

    // Base dimensions = native source pixels (matches drawClip)
    return {
      centerX: x * project.width,
      centerY: y * project.height,
      width: sourceMedia.width * scaleX,
      height: sourceMedia.height * scaleY,
      rotation,
    };
  }
  return null;
}

/** Helper to determine if a clip is manipulable (overlays, images, videos - not audio) */
export function isManipulableClip(clip: Clip, sourceVideos: SourceVideo[]): boolean {
  // Overlays are always manipulable
  if (clip.overlayType) return true;
  // Media clips are manipulable if they're not audio. A source that is not in
  // the list has no dimensions to draw handles around, so it is not one either.
  if (clip.sourceVideoId) {
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return false;
    return sourceMedia.mediaType !== 'audio';
  }
  return false;
}

/** Get the manipulable clip type */
export function getClipType(clip: Clip, sourceVideos: SourceVideo[]): ManipulableClipType | null {
  if (clip.overlayType === 'text') return 'text';
  if (clip.overlayType === 'shape') return 'shape';
  if (clip.sourceVideoId) {
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return null;
    if (sourceMedia.mediaType === 'image') return 'image';
    if (sourceMedia.mediaType === 'audio') return null;
    return 'video';
  }
  return null;
}

/** Check if a clip has custom keyframes (not just presets) */
export function hasCustomKeyframes(clip: Clip): boolean {
  if (!clip.animation?.keyframes) return false;
  const properties: ('x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'blur')[] =
    ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur'];
  for (const prop of properties) {
    const kfs = clip.animation.keyframes[prop];
    if (kfs && kfs.length > 0) return true;
  }
  return false;
}

/**
 * A point in project pixels, expressed in a clip's own unrotated frame.
 *
 * Every box on the preview is axis-aligned before its rotation is applied, so
 * a hit test rotates the point backwards around the box's centre rather than
 * rotating the box's four corners forwards. `x`/`y` are then offsets from the
 * centre, and a point is inside the box when both are within its half extents.
 */
export function toLocalPoint(bounds: OverlayBounds, x: number, y: number): { x: number; y: number } {
  const rad = (-bounds.rotation * Math.PI) / 180;
  const dx = x - bounds.centerX;
  const dy = y - bounds.centerY;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/**
 * Where the canvas' drawn content sits inside the element that shows it.
 *
 * The preview canvas is laid out with `object-fit: contain`, so the drawing is
 * scaled to fit and letterboxed on whichever axis has room to spare. Anything
 * that maps between the element's CSS pixels and the project's own pixels — the
 * mouse, a marquee rectangle, the inline text editor — needs these numbers.
 */
export interface CanvasContentBox {
  /** Size of the drawn content in the element's CSS pixels. */
  width: number;
  height: number;
  /** Size of the letterbox bar on each side, in the element's CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** CSS pixels per project pixel. Equal on both axes, up to rounding. */
  scaleX: number;
  scaleY: number;
}

/**
 * Measure the object-fit: contain box for a canvas.
 *
 * The element box is a parameter so a caller that already has the rect — the
 * mouse handlers read it for `left`/`top` as well — does not measure twice.
 *
 * The aspect that decides the letterboxing is the *project's*, not the backing
 * store's: the preview rasterises at its displayed size, and rounding that to
 * whole device pixels would otherwise nudge the mapping by a fraction of a
 * pixel every time the window changed size. `project` defaults to the canvas
 * itself for the canvases that are their own project.
 */
export function contentBox(
  canvas: HTMLCanvasElement,
  rect: { width: number; height: number } = canvas.getBoundingClientRect(),
  project: ProjectSize = canvas
): CanvasContentBox {
  const canvasAspect = project.width / project.height;
  const elementAspect = rect.width / rect.height;

  let width: number;
  let height: number;
  let offsetX: number;
  let offsetY: number;

  if (canvasAspect > elementAspect) {
    // Canvas is wider than element - letterboxed top/bottom
    width = rect.width;
    height = rect.width / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - height) / 2;
  } else {
    // Canvas is taller than element - letterboxed left/right
    height = rect.height;
    width = rect.height * canvasAspect;
    offsetX = (rect.width - width) / 2;
    offsetY = 0;
  }

  return {
    width,
    height,
    offsetX,
    offsetY,
    scaleX: width / project.width,
    scaleY: height / project.height,
  };
}

/**
 * Get mouse position relative to canvas in normalized coordinates (0-1).
 * Accounts for object-fit: contain which letterboxes the canvas content.
 * Accepts any MouseEvent (canvas or window) so dragging works outside the canvas.
 */
export function getCanvasPosition(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number },
  project: ProjectSize = canvas
): NormalizedPoint {
  const rect = canvas.getBoundingClientRect();
  const content = contentBox(canvas, rect, project);

  // Convert mouse position to be relative to the actual canvas content area
  const mouseX = e.clientX - rect.left - content.offsetX;
  const mouseY = e.clientY - rect.top - content.offsetY;

  // Return normalized coordinates — NOT clamped, so dragging outside canvas works
  return {
    x: mouseX / content.width,
    y: mouseY / content.height,
  };
}

/**
 * The backing store a preview canvas should carry, and the scale that gets a
 * project-space frame onto it.
 *
 * The canvas element is laid out at `width: 100%; height: 100%` with
 * `object-fit: contain`, so what the viewer sees is the project letterboxed
 * into `box`. Rasterising at `project.resolution` and letting CSS shrink the
 * result means a 4K project paints 8.3 megapixels to show maybe 0.1 — the cost
 * of a preview frame is proportional to the pixels it touches, and those are
 * the ones nobody sees. So the backing store is the *contained* box in device
 * pixels instead, and one `setTransform(scale, 0, 0, scale, 0, 0)` per frame
 * carries the unchanged project-space drawing onto it.
 *
 * Two deliberate limits:
 *
 * - the raster never exceeds the project. A small project in a large box would
 *   otherwise be rasterised sharper than it is — a different picture — and
 *   cost more than it does today, which is the opposite of the point.
 * - with no box yet (before the first ResizeObserver callback) it is the
 *   project, so the first frame after mount is drawn exactly as it always was
 *   and the resize that follows corrects it.
 *
 * The height is rounded off the *width's* scale rather than its own, so the
 * one scale factor is exactly `width / project.width` and a frame drawn under
 * it lands on whole device pixels horizontally.
 */
export function previewRaster(
  project: ProjectSize,
  box: { width: number; height: number } | null,
  devicePixelRatio: number
): { width: number; height: number; scale: number } {
  const unscaled = { width: project.width, height: project.height, scale: 1 };
  if (!box || box.width <= 0 || box.height <= 0) return unscaled;
  if (project.width <= 0 || project.height <= 0) return unscaled;

  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const fit = Math.min(
    (box.width * dpr) / project.width,
    (box.height * dpr) / project.height,
    1
  );
  if (fit >= 1) return unscaled;

  const width = Math.max(1, Math.round(project.width * fit));
  const scale = width / project.width;
  return { width, height: Math.max(1, Math.round(project.height * scale)), scale };
}

/**
 * The project's pixel grid, as the preview should read it.
 *
 * Every number in this directory is in project space (see {@link ProjectSize}),
 * so both the component that sizes the canvas and the hook that measures
 * pointer positions against it have to derive that space the same way — from
 * `project.resolution` and nothing else. They used to derive it separately, and
 * the hook fell back to the canvas element when a project carried no
 * resolution: the canvas is the *backing store*, which since the display-size
 * raster landed is not the project at all, so that fallback would have mixed
 * the two spaces. It is dead today — the store always records a resolution —
 * and this is how it stays dead.
 */
export function projectSizeOf(
  resolution: { width?: number; height?: number } | null | undefined
): ProjectSize {
  return {
    width: resolution?.width || DEFAULT_PROJECT_WIDTH,
    height: resolution?.height || DEFAULT_PROJECT_HEIGHT,
  };
}
