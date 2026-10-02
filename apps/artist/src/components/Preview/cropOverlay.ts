// Crop mode's chrome (ESCSUITE-157): the clip's full source drawn dimmed
// outside the region the crop keeps, and that region's own edge.
//
// It draws where `selectionOverlay.ts` draws — on the chrome path, after the
// composited frame, on a pointer move or a store change — and like that module
// it is pure: the scene is a parameter and the canvas is passed in. **Not a
// per-frame path**: `PreviewPlayer`'s chrome callbacks are not called during
// playback, and `cropTarget` below returns null if they ever are.
//
// The eight handles themselves are NOT here. They are DOM buttons
// (`CropHandles.tsx`), because they have to be focusable, individually named
// and individually disable-able, and because a CSS-pixel size is the one thing
// ESCSUITE-90 asks of chrome and a DOM element gets for free.
import { croppedSourceRect } from '../../core/clipCrop';
import type { CropHandle } from '../../core/cropDrag';
import {
  getOverlayBounds,
  type CanvasContentBox,
  type OverlayBoundsOptions,
} from './previewGeometry';
import type { Clip, ClipCrop, SourceVideo, Track } from '../../store/types';
import type { DragMode, OverlayBounds, ProjectSize } from './types';

/** Everything crop mode's chrome reads out of the editor store. */
export interface CropOverlayScene {
  clips: Clip[];
  sourceVideos: SourceVideo[];
  /**
   * The timeline's tracks, so {@link cropTarget} can ask the question the
   * renderer asks before drawing a clip at all (ESCSUITE-171).
   *
   * `PreviewPlayer` already subscribes to them — it reads them for
   * `isTrackLocked` and `getActiveTransition` — so this costs the scene memo one
   * more dependency and nothing else.
   */
  tracks: Track[];
  /** The latch: the clip crop mode was opened on, or null. */
  cropClipId: string | null;
  selectedClipId: string | null;
  isPlaying: boolean;
}

/** The clip crop mode is open on, and the source frame it is cropping. */
export interface CropTarget {
  clip: Clip;
  source: SourceVideo;
}

/** The kept region's box in the canvas element's own CSS pixels. */
export interface CropFrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Degrees, for a CSS `rotate()`. */
  rotation: number;
}

/** How much of the cropped-away picture shows through the dim. */
export const CROP_DIM_ALPHA = 0.45;

/** The kept region's edge. */
export const CROP_FRAME_COLOR = '#2196F3';

/** What dims the ring when there is no media element to draw into it. */
export const CROP_VEIL_FILL = 'rgba(0, 0, 0, 0.55)';

/**
 * Which resize mode each handle behaves like, so the cursor comes from
 * `cursor.ts`'s existing table rather than a second copy of it. It inherits
 * that table's one limitation: a cursor keyword does not rotate with the clip,
 * exactly as the selection chrome's does not.
 */
export const CROP_HANDLE_MODES: Record<CropHandle, DragMode> = {
  nw: 'resize-nw',
  n: 'resize-n',
  ne: 'resize-ne',
  w: 'resize-w',
  e: 'resize-e',
  sw: 'resize-sw',
  s: 'resize-s',
  se: 'resize-se',
};

/**
 * Is crop mode on, and on what — leaving the playhead out of it?
 *
 * `cropClipId` is a latch that nothing clears, so the second condition is what
 * makes a selection change — or a delete, a project load, an undo — leave crop
 * mode: a latch that no longer names the selected clip is inert.
 *
 * An overlay needs no condition of its own: it carries `sourceVideoId: ''` and
 * fails the source lookup.
 *
 * **The clip's track has to be showing it** (ESCSUITE-171). `getClipsAtTime`
 * (`store/clipQueries.ts`) skips a clip whose track is missing or not `visible`,
 * so the frame draws nothing for it; without the same test here the chrome drew
 * a dim ghost of a hidden clip and the eight handles stayed live over it. The
 * condition is written the way that query writes it — no track, no picture — so
 * the two cannot drift.
 *
 * Callers want {@link visibleCropTarget} below, which adds the clip's own time
 * window. This half is separate only because the window needs the clip this one
 * resolves.
 */
export function cropTarget(scene: CropOverlayScene): CropTarget | null {
  const { clips, sourceVideos, tracks, cropClipId, selectedClipId, isPlaying } = scene;
  if (!cropClipId || cropClipId !== selectedClipId || isPlaying) return null;

  const clip = clips.find((c) => c.id === cropClipId);
  if (!clip) return null;

  const track = tracks.find((t) => t.id === clip.trackId);
  if (!track || !track.visible) return null;

  const source = sourceVideos.find((s) => s.id === clip.sourceVideoId);
  if (!source) return null;

  return { clip, source };
}

/**
 * Is crop mode on, on what, and is the playhead actually on that clip?
 *
 * The **one** definition, read by the chrome below and by `PreviewPlayer` for
 * whether to mount the eight DOM handles — so neither can show crop mode for a
 * frame the other is not showing it for, and (through `cropTarget`) neither
 * shows it for a frame the renderer is not drawing at all. Before this existed the chrome carried
 * the time comparison on its own and the handle layer carried none, which left
 * eight live, draggable buttons over an unrelated frame once the playhead
 * scrubbed off the cropped clip.
 *
 * The end is exclusive, exactly as `selectionOverlay.ts`' own window test is: a
 * clip ending where the next begins hands the frame over, it does not share it.
 */
export function visibleCropTarget(scene: CropOverlayScene, time: number): CropTarget | null {
  const target = cropTarget(scene);
  if (!target) return null;

  const { clip } = target;
  if (time < clip.timelinePosition || time >= clip.timelinePosition + clip.duration) return null;

  return target;
}

/**
 * Where the clip's **whole** source frame would be drawn, given the box its
 * kept region occupies — in the clip's own unrotated frame, relative to the
 * centre the caller has already translated to.
 *
 * The scale comes out of `bounds` rather than off the clip's transform, so an
 * animated scale is already baked in and this needs to know nothing about
 * keyframes: the kept region is `region.sw` source pixels drawn `bounds.width`
 * wide, and that ratio carries the rest of the frame.
 */
export function fullSourceBox(
  bounds: OverlayBounds,
  crop: ClipCrop | undefined,
  source: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const region = croppedSourceRect(source.width, source.height, crop);
  const scaleX = bounds.width / region.sw;
  const scaleY = bounds.height / region.sh;

  return {
    x: -bounds.width / 2 - region.sx * scaleX,
    y: -bounds.height / 2 - region.sy * scaleY,
    width: source.width * scaleX,
    height: source.height * scaleY,
  };
}

/**
 * The kept region's box in the canvas element's own CSS pixels — what the DOM
 * handle layer is positioned with.
 *
 * The same `object-fit: contain` mapping `InlineTextEditorAnchor` does for the
 * inline text editor, and for the same reason: the handles are DOM elements
 * over a canvas the browser has letterboxed to fit its box.
 */
export function cropFrameBox(bounds: OverlayBounds, content: CanvasContentBox): CropFrameBox {
  return {
    left: content.offsetX + (bounds.centerX - bounds.width / 2) * content.scaleX,
    top: content.offsetY + (bounds.centerY - bounds.height / 2) * content.scaleY,
    width: bounds.width * content.scaleX,
    height: bounds.height * content.scaleY,
    rotation: bounds.rotation,
  };
}

/**
 * Dim everything the crop throws away, and outline what it keeps.
 *
 * One `drawImage`: the ring between the full source's box and the kept
 * rectangle is clipped with `evenodd` and the source is drawn once across it at
 * {@link CROP_DIM_ALPHA}. The kept region is deliberately NOT redrawn — the
 * composited frame already drew it, cropped, which is the picture the user is
 * deciding about. With no media element to draw (a video mid-load, an image not
 * yet decoded) the same ring is veiled instead, so the kept region still reads
 * as the kept region.
 *
 * `screenScale` is project pixels per CSS pixel, as every other chrome function
 * here takes it (ESCSUITE-90): it sizes the pen and nothing else. Positions are
 * the clip's own geometry.
 *
 * `options` carries the transition active at `time` straight through to
 * `getOverlayBounds`, so the frame follows the picture rather than the clip's own
 * Animate Out preset when a transition has taken that side over (ESCSUITE-147).
 * A parameter rather than a field of {@link CropOverlayScene}, because the scene
 * is the time-independent half — `PreviewPlayer` memoises it and asks
 * {@link visibleCropTarget} about a playhead — while the transition is a function
 * of the time being drawn at, exactly as `selectionOverlay.ts`' caller derives
 * its own from the `time` it is handed.
 */
export function drawCropOverlay(
  canvas: HTMLCanvasElement,
  time: number,
  scene: CropOverlayScene,
  element: CanvasImageSource | undefined,
  project: ProjectSize = canvas,
  screenScale: number = 1,
  options?: OverlayBoundsOptions
): void {
  const target = visibleCropTarget(scene, time);
  if (!target) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { clip, source } = target;
  const bounds = getOverlayBounds(clip, canvas, time, scene.sourceVideos, project, options);
  if (!bounds) return;

  const full = fullSourceBox(bounds, clip.crop, source);
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY);
  ctx.rotate((bounds.rotation * Math.PI) / 180);

  ctx.save();
  ctx.beginPath();
  ctx.rect(full.x, full.y, full.width, full.height);
  ctx.rect(-halfW, -halfH, bounds.width, bounds.height);
  ctx.clip('evenodd');
  if (element) {
    ctx.globalAlpha = CROP_DIM_ALPHA;
    ctx.drawImage(element, full.x, full.y, full.width, full.height);
  } else {
    ctx.fillStyle = CROP_VEIL_FILL;
    ctx.fillRect(full.x, full.y, full.width, full.height);
  }
  ctx.restore();

  ctx.strokeStyle = CROP_FRAME_COLOR;
  ctx.lineWidth = 1 * screenScale;
  ctx.setLineDash([]);
  ctx.strokeRect(-halfW, -halfH, bounds.width, bounds.height);

  ctx.restore();
}
