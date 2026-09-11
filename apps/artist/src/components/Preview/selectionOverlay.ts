// The blue chrome drawn over the composited frame: the selected clip's
// bounding box with its resize and rotation handles, and a dashed box for
// everything else in a multi-selection.
//
// Pure: the scene is a parameter and the canvas is passed in, so these draw
// wherever they are pointed — the preview, or a test's recording double.
import {
  getOverlayBounds,
  hasCustomKeyframes,
  isManipulableClip,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry';
import type { PreviewSceneContext } from './types';

/** The slice of the scene the full selection handles read. */
export type SelectionOverlayContext = Pick<
  PreviewSceneContext,
  'clips' | 'sourceVideos' | 'selectedClipId' | 'isPlaying' | 'keyframePanelOpen'
>;

/** The slice of the scene the multi-selection boxes read. */
export type MultiSelectOverlayContext = Pick<
  PreviewSceneContext,
  'clips' | 'sourceVideos' | 'selectedClipId' | 'selectedClipIds' | 'isPlaying'
>;

/** Draw selection handles for the selected overlay or media clip. */
export function drawSelectionHandles(
  canvas: HTMLCanvasElement,
  time: number,
  scene: SelectionOverlayContext
): void {
  const { clips, sourceVideos, selectedClipId, isPlaying, keyframePanelOpen } = scene;
  if (!selectedClipId || isPlaying) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Find the selected clip
  const selectedClip = clips.find(c => c.id === selectedClipId);
  if (!selectedClip || !isManipulableClip(selectedClip, sourceVideos)) return;

  // Check if clip is visible at current time
  const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
  if (time < selectedClip.timelinePosition || time >= clipEnd) return;

  // Don't draw handles if the clip can't be interacted with
  // Case 1: Clip has custom keyframes but we're not in keyframe mode
  if (hasCustomKeyframes(selectedClip) && !keyframePanelOpen) return;

  const bounds = getOverlayBounds(selectedClip, canvas, time, sourceVideos);
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
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(-halfW, -halfH, width, height);

  // Draw corner handles
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 2;
  const handleSize = HANDLE_SIZE;
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
  const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;

  // Line connecting to rotation handle
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
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

/** Draw lightweight bounding boxes for multi-selected overlay clips (no resize handles). */
export function drawMultiSelectHandles(
  canvas: HTMLCanvasElement,
  time: number,
  scene: MultiSelectOverlayContext
): void {
  const { clips, sourceVideos, selectedClipId, selectedClipIds, isPlaying } = scene;
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

    const bounds = getOverlayBounds(clip, canvas, time, sourceVideos);
    if (!bounds) continue;

    const { centerX, centerY, width, height, rotation } = bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw dashed bounding box for multi-selected clips
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-halfW, -halfH, width, height);

    ctx.restore();
  }
}
