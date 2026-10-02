// The blue chrome drawn over the composited frame: the selected clip's
// bounding box with its resize and rotation handles, and a dashed box for
// everything else in a multi-selection.
//
// Pure: the scene is a parameter and the canvas is passed in, so these draw
// wherever they are pointed — the preview, or a test's recording double.
import {
  getOverlayBounds,
  isManipulableClip,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry';
import type { PreviewSceneContext, ProjectSize } from './types';

/** The slice of the scene the full selection handles read. */
export type SelectionOverlayContext = Pick<
  PreviewSceneContext,
  'clips' | 'sourceVideos' | 'selectedClipId' | 'isPlaying' | 'keyframePanelOpen' | 'transition'
>;

/** The slice of the scene the multi-selection boxes read. */
export type MultiSelectOverlayContext = Pick<
  PreviewSceneContext,
  'clips' | 'sourceVideos' | 'selectedClipId' | 'selectedClipIds' | 'isPlaying' | 'transition'
>;

/**
 * Draw selection handles for the selected overlay or media clip.
 *
 * Drawn in project pixels, on top of whatever transform the frame left on the
 * context — so the box, the handles and the grip land on the clip wherever the
 * frame put it. Wherever: `scene.transition` is the transition active at `time`,
 * and a clip that is one side of it is boxed with the preset that side owns left
 * out, exactly as the frame drew it (ESCSUITE-147). `project` defaults to the
 * canvas' own size for a canvas that is its own project.
 *
 * `screenScale` is **project pixels per CSS pixel** — how much bigger the
 * project's grid is than the box the viewer actually sees it in. Every constant
 * below that is a *screen* size (the handle squares, the grip, its offset above
 * the box, the pen width, the dash lengths) is multiplied by it, so the chrome
 * is the same size under the pointer whatever the project's resolution: a 4K
 * project in a 700px preview would otherwise draw 1.5px handles. Positions are
 * the clip's own geometry and are never scaled. A caller with a laid-out
 * element gets the number as `1 / contentBox(canvas, box, project).scaleX`; it
 * defaults to 1 for a canvas that is its own screen (the exporters, the tests
 * that build one) and for a preview that has not been measured yet.
 */
export function drawSelectionHandles(
  canvas: HTMLCanvasElement,
  time: number,
  scene: SelectionOverlayContext,
  project: ProjectSize = canvas,
  screenScale: number = 1
): void {
  const { clips, sourceVideos, selectedClipId, isPlaying, transition } = scene;
  if (!selectedClipId || isPlaying) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Find the selected clip
  const selectedClip = clips.find(c => c.id === selectedClipId);
  if (!selectedClip || !isManipulableClip(selectedClip, sourceVideos)) return;

  // Check if clip is visible at current time
  const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
  if (time < selectedClip.timelinePosition || time >= clipEnd) return;

  // A clip carrying custom keyframes is only manipulable from the keyframe
  // panel outside of which it is picked but never dragged (ESCSUITE-3) — the
  // same way a clip on a locked track is picked but never dragged. Neither
  // case is hidden by the condition that makes it inert: the full box and
  // handles are drawn either way, at the clip's **animated** position for
  // keyframes (ESCSUITE-155; `getOverlayBounds` below reads the same
  // `getAnimatedValues` `hitTest.ts` does), simply unresponsive to a drag once
  // drawn.
  const bounds = getOverlayBounds(selectedClip, canvas, time, sourceVideos, project, { transition });
  if (!bounds) return;

  const { centerX, centerY, width, height, rotation } = bounds;
  const halfW = width / 2;
  const halfH = height / 2;

  ctx.save();

  // Apply rotation
  ctx.translate(centerX, centerY);
  ctx.rotate((rotation * Math.PI) / 180);

  // Draw bounding box
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 2 * screenScale;
  ctx.setLineDash([]);
  ctx.strokeRect(-halfW, -halfH, width, height);

  // Draw corner handles
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 2 * screenScale;
  const handleSize = HANDLE_SIZE * screenScale;
  const halfHandle = handleSize / 2;

  // Corner positions (relative to center)
  const corners = [
    { x: -halfW, y: -halfH }, // NW
    { x: halfW, y: -halfH },  // NE
    { x: -halfW, y: halfH },  // SW
    { x: halfW, y: halfH },   // SE
  ];

  // Side positions
  const sides = [
    { x: 0, y: -halfH },      // N
    { x: 0, y: halfH },       // S
    { x: -halfW, y: 0 },      // W
    { x: halfW, y: 0 },       // E
  ];

  // Draw corner handles (squares)
  for (const corner of corners) {
    ctx.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
    ctx.strokeRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
  }

  // Draw side handles (smaller squares)
  const sideHandleSize = handleSize * 0.8;
  const halfSideHandle = sideHandleSize / 2;
  for (const side of sides) {
    ctx.fillRect(side.x - halfSideHandle, side.y - halfSideHandle, sideHandleSize, sideHandleSize);
    ctx.strokeRect(side.x - halfSideHandle, side.y - halfSideHandle, sideHandleSize, sideHandleSize);
  }

  // Draw rotation handle (circle above the bounding box)
  const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET * screenScale;

  // Line connecting to rotation handle
  ctx.beginPath();
  ctx.setLineDash([4 * screenScale, 4 * screenScale]);
  ctx.moveTo(0, -halfH);
  ctx.lineTo(0, rotationHandleY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rotation handle circle
  ctx.beginPath();
  ctx.arc(0, rotationHandleY, handleSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw lightweight bounding boxes for multi-selected overlay clips (no resize
 * handles). `screenScale` is project pixels per CSS pixel, exactly as
 * {@link drawSelectionHandles} takes it: it sizes the pen and the dashes, not
 * the boxes.
 */
export function drawMultiSelectHandles(
  canvas: HTMLCanvasElement,
  time: number,
  scene: MultiSelectOverlayContext,
  project: ProjectSize = canvas,
  screenScale: number = 1
): void {
  const { clips, sourceVideos, selectedClipId, selectedClipIds, isPlaying, transition } = scene;
  if (selectedClipIds.size <= 1 || isPlaying) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  for (const clipId of selectedClipIds) {
    // Skip the primary selected clip - it already has full handles
    if (clipId === selectedClipId) continue;

    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isManipulableClip(clip, sourceVideos)) continue;

    // Check if clip is visible at current time
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time < clip.timelinePosition || time >= clipEnd) continue;

    const bounds = getOverlayBounds(clip, canvas, time, sourceVideos, project, { transition });
    if (!bounds) continue;

    const { centerX, centerY, width, height, rotation } = bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw dashed bounding box for multi-selected clips
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2 * screenScale;
    ctx.setLineDash([6 * screenScale, 4 * screenScale]);
    ctx.strokeRect(-halfW, -halfH, width, height);

    ctx.restore();
  }
}
