// What is under the pointer on the preview canvas.
//
// Handles take priority over overlay bodies, and the keyframe panel narrows
// interaction to the selected clip alone. Pure: the scene is a parameter.
import { getClipsAtTime } from '../../store/projectStore';
import {
  getClipType,
  getOverlayBounds,
  hasCustomKeyframes,
  isManipulableClip,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry';
import type { DragMode, HandleHit, PreviewSceneContext } from './types';

/** The slice of the scene a hit test reads. */
export type HitTestContext = Pick<
  PreviewSceneContext,
  'clips' | 'tracks' | 'sourceVideos' | 'currentTime' | 'selectedClipId' | 'keyframePanelOpen'
>;

/**
 * Hit test: find what's at the given position (handles take priority over
 * overlay bodies). The position is in the canvas' normalized 0-1 space, as
 * {@link getCanvasPosition} returns it.
 */
export function hitTestHandles(
  normalizedX: number,
  normalizedY: number,
  canvas: HTMLCanvasElement,
  scene: HitTestContext
): HandleHit | null {
  const { clips, tracks, sourceVideos, currentTime, selectedClipId, keyframePanelOpen } = scene;

  const mouseX = normalizedX * canvas.width;
  const mouseY = normalizedY * canvas.height;

  // RESTRICTION 1: When keyframe panel is open, ONLY allow interaction with the selected clip
  // This prevents accidentally clicking through and grabbing something else
  if (keyframePanelOpen && selectedClipId) {
    const selectedClip = clips.find(c => c.id === selectedClipId);
    const selectedClipType = selectedClip ? getClipType(selectedClip, sourceVideos) : null;
    if (selectedClip && selectedClipType) {
      const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
      if (currentTime >= selectedClip.timelinePosition && currentTime < clipEnd) {
        const bounds = getOverlayBounds(selectedClip, canvas, currentTime, sourceVideos);
        if (bounds) {
          const { centerX, centerY, width, height, rotation } = bounds;
          const halfW = width / 2;
          const halfH = height / 2;

          const rad = (-rotation * Math.PI) / 180;
          const dx = mouseX - centerX;
          const dy = mouseY - centerY;
          const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
          const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

          const handleHitSize = HANDLE_SIZE * 1.5;
          const edgeHitSize = HANDLE_SIZE * 1.2; // Narrower zone for edge detection

          // Check rotation handle
          const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;
          if (Math.abs(localX) < handleHitSize && Math.abs(localY - rotationHandleY) < handleHitSize) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'rotate' };
          }

          // Check corner handles (small zones right at corners)
          const corners: { x: number; y: number; mode: DragMode }[] = [
            { x: -halfW, y: -halfH, mode: 'resize-nw' },
            { x: halfW, y: -halfH, mode: 'resize-ne' },
            { x: -halfW, y: halfH, mode: 'resize-sw' },
            { x: halfW, y: halfH, mode: 'resize-se' },
          ];
          for (const corner of corners) {
            if (Math.abs(localX - corner.x) < handleHitSize && Math.abs(localY - corner.y) < handleHitSize) {
              return { clipId: selectedClipId, clipType: selectedClipType, mode: corner.mode };
            }
          }

          // Check edges — entire edge is a hit zone, not just the midpoint handle
          // Top edge: along the full width, near the top border
          if (Math.abs(localY - (-halfH)) < edgeHitSize && Math.abs(localX) <= halfW) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-n' };
          }
          // Bottom edge
          if (Math.abs(localY - halfH) < edgeHitSize && Math.abs(localX) <= halfW) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-s' };
          }
          // Left edge
          if (Math.abs(localX - (-halfW)) < edgeHitSize && Math.abs(localY) <= halfH) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-w' };
          }
          // Right edge
          if (Math.abs(localX - halfW) < edgeHitSize && Math.abs(localY) <= halfH) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-e' };
          }

          // Check body for move
          if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'move' };
          }
        }
      }
    }
    // In keyframe mode, clicking outside the selected clip does nothing
    return null;
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

  // First pass: Check handles ONLY on the selected clip (if visible and doesn't have keyframes)
  if (selectedClipId) {
    const selectedClip = clips.find(c => c.id === selectedClipId);
    const selectedClipType = selectedClip ? getClipType(selectedClip, sourceVideos) : null;

    // RESTRICTION 2: If clip has custom keyframes, only allow interaction in keyframe mode
    // This is already handled since keyframePanelOpen check is above, and here we're NOT in keyframe mode
    if (selectedClip && selectedClipType && !hasCustomKeyframes(selectedClip)) {
      const clipEnd = selectedClip.timelinePosition + selectedClip.duration;
      if (currentTime >= selectedClip.timelinePosition && currentTime < clipEnd) {
        const bounds = getOverlayBounds(selectedClip, canvas, currentTime, sourceVideos);
        if (bounds) {
          const { centerX, centerY, width, height, rotation } = bounds;
          const halfW = width / 2;
          const halfH = height / 2;

          const rad = (-rotation * Math.PI) / 180;
          const dx = mouseX - centerX;
          const dy = mouseY - centerY;
          const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
          const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

          const handleHitSize = HANDLE_SIZE * 1.5;
          const edgeHitSize = HANDLE_SIZE * 1.2;

          // Check rotation handle
          const rotationHandleY = -halfH - ROTATION_HANDLE_OFFSET;
          if (Math.abs(localX) < handleHitSize && Math.abs(localY - rotationHandleY) < handleHitSize) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'rotate' };
          }

          // Check corner handles
          const corners: { x: number; y: number; mode: DragMode }[] = [
            { x: -halfW, y: -halfH, mode: 'resize-nw' },
            { x: halfW, y: -halfH, mode: 'resize-ne' },
            { x: -halfW, y: halfH, mode: 'resize-sw' },
            { x: halfW, y: halfH, mode: 'resize-se' },
          ];
          for (const corner of corners) {
            if (Math.abs(localX - corner.x) < handleHitSize && Math.abs(localY - corner.y) < handleHitSize) {
              return { clipId: selectedClipId, clipType: selectedClipType, mode: corner.mode };
            }
          }

          // Check edges — entire edge is a hit zone
          if (Math.abs(localY - (-halfH)) < edgeHitSize && Math.abs(localX) <= halfW) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-n' };
          }
          if (Math.abs(localY - halfH) < edgeHitSize && Math.abs(localX) <= halfW) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-s' };
          }
          if (Math.abs(localX - (-halfW)) < edgeHitSize && Math.abs(localY) <= halfH) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-w' };
          }
          if (Math.abs(localX - halfW) < edgeHitSize && Math.abs(localY) <= halfH) {
            return { clipId: selectedClipId, clipType: selectedClipType, mode: 'resize-e' };
          }
        }
      }
    }
  }

  // Second pass: Check body hit on ALL clips in z-order (highest first)
  // Skip clips that have custom keyframes (they can only be manipulated in keyframe mode)
  for (const { clip } of manipulableClips) {
    // RESTRICTION 2: Skip clips with custom keyframes when not in keyframe mode
    if (hasCustomKeyframes(clip)) continue;

    const clipType = getClipType(clip, sourceVideos);
    if (!clipType) continue;

    const bounds = getOverlayBounds(clip, canvas, currentTime, sourceVideos);
    if (!bounds) continue;

    const { centerX, centerY, width, height, rotation } = bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    const rad = (-rotation * Math.PI) / 180;
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

    if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
      return { clipId: clip.id, clipType, mode: 'move' };
    }
  }

  return null;
}
