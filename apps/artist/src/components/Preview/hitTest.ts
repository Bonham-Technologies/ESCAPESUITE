// What is under the pointer on the preview canvas.
//
// Handles take priority over overlay bodies, and the keyframe panel narrows
// interaction to the selected clip alone. Pure: the scene is a parameter.
import { getClipsAtTime } from '../../store/projectStore';
import {
  getClipOpacity,
  getClipType,
  getOverlayBounds,
  hasCustomKeyframes,
  isManipulableClip,
  toLocalPoint,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry';
import type { DragMode, HandleHit, PreviewSceneContext, ProjectSize } from './types';

/** The slice of the scene a hit test reads. */
export type HitTestContext = Pick<
  PreviewSceneContext,
  | 'clips'
  | 'tracks'
  | 'sourceVideos'
  | 'currentTime'
  | 'selectedClipId'
  | 'keyframePanelOpen'
  | 'transition'
>;

/** How a pass narrows the handle cascade below. */
export interface HandleCascadeOptions {
  /**
   * Skip a clip that carries custom keyframes. Outside keyframe mode such a
   * clip is only movable from the keyframe panel, so its handles are not live.
   */
  skipKeyframed: boolean;
  /** Count a hit inside the clip's box, away from every handle, as a move. */
  includeBody: boolean;
}

/**
 * The handle cascade on one clip: the rotation handle above it, then the four
 * corners, then the four edges — each edge live along its whole length, not
 * just at its midpoint handle — and then, where the caller counts it, the body.
 *
 * Both of hitTestHandles' passes ask exactly this of the selected clip; they
 * differ only in the two options. Null when the clip is gone, is not
 * manipulable, is not on screen at this time, has no measurable bounds, or
 * simply is not under the point.
 *
 * `screenScale` is project pixels per CSS pixel, the same number
 * `drawSelectionHandles` is given: the chrome is drawn at a constant size on
 * screen, so the zones that test it have to grow with the project's grid or the
 * pointer would miss what it can see. The body test is the clip's own box and
 * is not scaled. A caller with a laid-out element gets the number as
 * `1 / contentBox(canvas, box, project).scaleX`; it defaults to 1 for a canvas
 * that is its own screen.
 */
export function hitHandlesOnClip(
  clipId: string,
  mouseX: number,
  mouseY: number,
  canvas: HTMLCanvasElement,
  scene: Pick<HitTestContext, 'clips' | 'sourceVideos' | 'currentTime' | 'transition'>,
  options: HandleCascadeOptions,
  project: ProjectSize = canvas,
  screenScale: number = 1
): HandleHit | null {
  const { clips, sourceVideos, currentTime, transition } = scene;

  const clip = clips.find(c => c.id === clipId);
  const clipType = clip ? getClipType(clip, sourceVideos) : null;
  if (!clip || !clipType) return null;
  if (options.skipKeyframed && hasCustomKeyframes(clip)) return null;

  const clipEnd = clip.timelinePosition + clip.duration;
  if (currentTime < clip.timelinePosition || currentTime >= clipEnd) return null;

  const bounds = getOverlayBounds(clip, canvas, currentTime, sourceVideos, project, { transition });
  if (!bounds) return null;

  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;
  const local = toLocalPoint(bounds, mouseX, mouseY);

  const handleHitSize = HANDLE_SIZE * 1.5 * screenScale;
  const edgeHitSize = HANDLE_SIZE * 1.2 * screenScale; // Narrower zone for edge detection
  const hit = (mode: DragMode): HandleHit => ({ clipId, clipType, mode });

  // Rotation handle, above the top edge
  const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET * screenScale;
  if (Math.abs(local.x) < handleHitSize && Math.abs(local.y - rotationHandleY) < handleHitSize) {
    return hit('rotate');
  }

  // Corner handles (small zones right at the corners)
  const corners: { x: number; y: number; mode: DragMode }[] = [
    { x: -halfW, y: -halfH, mode: 'resize-nw' },
    { x: halfW, y: -halfH, mode: 'resize-ne' },
    { x: -halfW, y: halfH, mode: 'resize-sw' },
    { x: halfW, y: halfH, mode: 'resize-se' },
  ];
  for (const corner of corners) {
    if (Math.abs(local.x - corner.x) < handleHitSize && Math.abs(local.y - corner.y) < handleHitSize) {
      return hit(corner.mode);
    }
  }

  // Edges, each one a hit zone along its full length
  if (Math.abs(local.y - (-halfH)) < edgeHitSize && Math.abs(local.x) <= halfW) return hit('resize-n');
  if (Math.abs(local.y - halfH) < edgeHitSize && Math.abs(local.x) <= halfW) return hit('resize-s');
  if (Math.abs(local.x - (-halfW)) < edgeHitSize && Math.abs(local.y) <= halfH) return hit('resize-w');
  if (Math.abs(local.x - halfW) < edgeHitSize && Math.abs(local.y) <= halfH) return hit('resize-e');

  // The body, for a move
  if (options.includeBody && Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH) {
    return hit('move');
  }

  return null;
}

/**
 * Hit test: find what's at the given position (handles take priority over
 * overlay bodies). The position is in the canvas' normalized 0-1 space, as
 * {@link getCanvasPosition} returns it, and the test itself runs in project
 * pixels — `project` defaults to the canvas for a canvas that is its own
 * project (see {@link getOverlayBounds}). `screenScale` is project pixels per
 * CSS pixel and sizes the handle zones alone; see {@link hitHandlesOnClip}.
 */
export function hitTestHandles(
  normalizedX: number,
  normalizedY: number,
  canvas: HTMLCanvasElement,
  scene: HitTestContext,
  project: ProjectSize = canvas,
  screenScale: number = 1
): HandleHit | null {
  const {
    clips, tracks, sourceVideos, currentTime, selectedClipId, keyframePanelOpen, transition,
  } = scene;

  const mouseX = normalizedX * project.width;
  const mouseY = normalizedY * project.height;

  // RESTRICTION 1: When keyframe panel is open, ONLY allow interaction with the
  // selected clip. This prevents accidentally clicking through and grabbing
  // something else — a click outside the selected clip does nothing at all.
  if (keyframePanelOpen && selectedClipId) {
    return hitHandlesOnClip(
      selectedClipId,
      mouseX,
      mouseY,
      canvas,
      scene,
      { skipKeyframed: false, includeBody: true },
      project,
      screenScale
    );
  }

  // Get all active manipulable clips sorted by z-order (highest on top first)
  const activeClips = getClipsAtTime(clips, tracks, currentTime);
  const manipulableClips = activeClips
    .filter(c => isManipulableClip(c.clip, sourceVideos))
    .sort((a, b) => {
      // Overlays on top of media clips
      if (a.clip.overlayType && !b.clip.overlayType) return 1;
      if (!a.clip.overlayType && b.clip.overlayType) return -1;
      // Text overlays on top of shape overlays
      if (a.clip.overlayType === 'text' && b.clip.overlayType === 'shape') return 1;
      if (a.clip.overlayType === 'shape' && b.clip.overlayType === 'text') return -1;
      return (a.track?.index ?? 0) - (b.track?.index ?? 0);
    })
    .reverse(); // Now highest z-order first

  // First pass: handles ONLY on the selected clip, and only if it is visible
  // and free of custom keyframes (RESTRICTION 2 — those are keyframe-mode
  // only, and keyframe mode has already returned above). A body hit is left to
  // the second pass, which considers every clip in z-order rather than this one.
  if (selectedClipId) {
    const handle = hitHandlesOnClip(
      selectedClipId,
      mouseX,
      mouseY,
      canvas,
      scene,
      { skipKeyframed: true, includeBody: false },
      project,
      screenScale
    );
    if (handle) return handle;
  }

  // Second pass: Check body hit on ALL clips in z-order (highest first),
  // keyframed ones included. A keyframed clip is only *manipulable* from the
  // keyframe panel (RESTRICTION 2 above skips it in the handle passes), but it
  // still occupies the pixels it is drawn at — at its *animated* position,
  // since getOverlayBounds below takes currentTime and evaluates the same
  // getAnimatedValues the preview draws with, under the same preset suppression
  // an active transition imposes on it (ESCSUITE-147). Reporting a hit here, rather
  // than skipping to whatever is underneath, is what stops a click from
  // falling through a keyframed clip to the one on the lower track. The
  // caller (handleMouseDown in useTransformHandles.ts) is the one that turns
  // this `move` into a refusal — selecting the clip without starting a drag —
  // the same way it already does for a clip on a locked track.
  //
  // A clip evaluated fully transparent at this instant — statically, or by a
  // keyframe or an Animate Out preset — is skipped instead: it is invisible,
  // so it does not stand between the pointer and whatever is drawn beneath it
  // (ESCSUITE-155). `getClipOpacity` reads the same base `transform.opacity`
  // and the same `getAnimatedValues` call `getOverlayBounds` below already
  // makes for position — under the same transition suppression, which is what
  // keeps a clip the transition is *fading in* clickable (ESCSUITE-147) — so
  // the two agree about what is actually on screen.
  for (const { clip } of manipulableClips) {
    const clipType = getClipType(clip, sourceVideos);
    if (!clipType) continue;
    if (getClipOpacity(clip, currentTime, { transition }) <= 0) continue;

    const bounds = getOverlayBounds(clip, canvas, currentTime, sourceVideos, project, { transition });
    if (!bounds) continue;

    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;

    const local = toLocalPoint(bounds, mouseX, mouseY);

    if (Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH) {
      return { clipId: clip.id, clipType, mode: 'move' };
    }
  }

  return null;
}
