// Direct manipulation on the preview canvas: the mouse state machine.
//
// One pointer does four different jobs here, and which one it is depends
// entirely on what was under it when the button went down:
//
//  - a transform handle of the selected clip → a drag (move, rotate, resize),
//    tracked on `window` so the pointer may leave the canvas mid-gesture;
//  - a clip body → the same, in `move` mode;
//  - empty canvas, dragged → a marquee that selects what it sweeps;
//  - empty canvas, released without moving → deselect.
//
// A drag writes through the throttled updaters, one store write per animation
// frame rather than one per mouse event, and commits once — the history entry —
// on release. With the keyframe panel open, the same gesture sets keyframes at
// the playhead instead of moving the clip outright.
//
// The store is read here with the same selectors the preview component uses,
// so the caller hands over only what a hook cannot reach: the canvas, the
// redraw functions, and the way in to inline text editing.
import { useCallback, useEffect, useState, type MouseEvent, type RefObject } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useThrottledDragUpdate } from '../../hooks';
import type { ClipTransform, TextOverlayData, ShapeOverlayData } from '../../store/types';
import * as geometry from './previewGeometry';
import * as hitTest from './hitTest';
import { clipsIntersectingMarquee, measureDragStart, textClipAtPoint } from './dragGeometry';
import { getCursorForMode } from './cursor';
import type { DragMode, ManipulableClipType } from './types';

// Drag state for overlay/clip manipulation
interface DragState {
  clipId: string;
  clipType: ManipulableClipType;
  mode: DragMode;
  startMouseX: number;
  startMouseY: number;
  startOverlayX: number;
  startOverlayY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  startScaleX: number;
  startScaleY: number;
}

const MARQUEE_THRESHOLD = 5; // pixels before starting marquee

/** What a transform gesture needs that the store cannot provide. */
export interface TransformHandlesDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Open the inline text editor on a clip (double-click). */
  setEditingTextClipId: (clipId: string | null) => void;
  drawFrame: (time: number, useCache?: boolean) => void;
  drawSelectionHandles: (time: number) => void;
  drawMultiSelectHandles: (time: number) => void;
}

/** The handlers and state the preview's canvas element binds to. */
export interface TransformHandles {
  /** CSS cursor for the canvas, following the handle under the pointer. */
  cursor: string;
  handleMouseDown: (e: MouseEvent<HTMLCanvasElement>) => void;
  /** onMouseMove: updates the cursor, then runs the drag/marquee move. */
  handleMouseMoveForCursor: (e: MouseEvent<HTMLCanvasElement>) => void;
  handleMouseUp: (e?: MouseEvent<HTMLCanvasElement>) => void;
  handleMouseLeave: () => void;
  handleDoubleClick: (e: MouseEvent<HTMLCanvasElement>) => void;
  /** Marquee rectangle in the canvas element's own CSS pixels, or null. */
  marqueeStart: { x: number; y: number } | null;
  marqueeCurrent: { x: number; y: number } | null;
  marqueeActive: boolean;
}

export function useTransformHandles({
  canvasRef,
  setEditingTextClipId,
  drawFrame,
  drawSelectionHandles,
  drawMultiSelectHandles,
}: TransformHandlesDeps): TransformHandles {
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const selectClipsInRange = useEditorStore((state) => state.selectClipsInRange);
  const clearMultiSelection = useEditorStore((state) => state.clearMultiSelection);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);

  // Keyframe mode: when keyframe panel is open, manipulations create keyframes
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);
  const setClipKeyframe = useEditorStore((state) => state.setClipKeyframe);

  // Drag state for overlay manipulation
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Marquee selection state
  const [marqueeStart, setMarqueeStart] = useState<{x: number; y: number} | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{x: number; y: number} | null>(null);
  const marqueeActive = marqueeStart !== null && marqueeCurrent !== null;

  // Track cursor for display
  const [cursor, setCursor] = useState('default');

  // Throttled updates for smooth drag performance
  // Updates are batched per animation frame to reduce store updates
  const throttledTextUpdate = useThrottledDragUpdate<{ id: string; data: Partial<TextOverlayData> }>();
  const throttledShapeUpdate = useThrottledDragUpdate<{ id: string; data: Partial<ShapeOverlayData> }>();
  const throttledTransformUpdate = useThrottledDragUpdate<{ id: string; transform: Partial<ClipTransform> }>();

  // Get mouse position relative to canvas in normalized coordinates (0-1)
  // Accepts any MouseEvent (canvas or window) so dragging works outside the canvas
  const getCanvasPosition = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return geometry.getCanvasPosition(canvas, e);
  }, [canvasRef]);

  // Hit test: find what's at the given position (handles take priority over overlay bodies)
  const hitTestHandles = useCallback((normalizedX: number, normalizedY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return hitTest.hitTestHandles(normalizedX, normalizedY, canvas, {
      clips,
      tracks,
      sourceVideos,
      currentTime,
      selectedClipId,
      keyframePanelOpen,
    });
  }, [canvasRef, clips, tracks, sourceVideos, currentTime, selectedClipId, keyframePanelOpen]);

  // Mouse event handlers for drag-and-drop
  const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return; // Don't allow dragging during playback

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y);

    if (hit) {
      e.preventDefault();
      const clip = clips.find(c => c.id === hit.clipId);
      if (!clip) return;

      // Check if we should use animated values (keyframe mode)
      const isKeyframeMode = keyframePanelOpen && clip.id === selectedClipId;
      const canvas = canvasRef.current;

      const {
        startX, startY, startWidth, startHeight, startRotation, startScaleX, startScaleY,
      } = measureDragStart(clip, hit.clipType, canvas, currentTime, isKeyframeMode, sourceVideos);

      setDragState({
        clipId: hit.clipId,
        clipType: hit.clipType,
        mode: hit.mode,
        startMouseX: pos.x,
        startMouseY: pos.y,
        startOverlayX: startX,
        startOverlayY: startY,
        startWidth,
        startHeight,
        startRotation,
        startScaleX,
        startScaleY,
      });

      // Select the clip
      setSelectedClipId(hit.clipId);
    } else {
      // Clicked on empty space - start tracking for marquee selection
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setMarqueeStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setMarqueeCurrent(null);
      }
    }
  }, [isPlaying, getCanvasPosition, hitTestHandles, clips, setSelectedClipId, sourceVideos, keyframePanelOpen, selectedClipId, currentTime, canvasRef]);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    // Handle marquee drag
    if (marqueeStart && !dragState) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        const dx = currentX - marqueeStart.x;
        const dy = currentY - marqueeStart.y;
        if (Math.sqrt(dx * dx + dy * dy) >= MARQUEE_THRESHOLD) {
          setMarqueeCurrent({ x: currentX, y: currentY });
        }
      }
      return;
    }

    if (!dragState) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = getCanvasPosition(e);

    // Check if we should create keyframes instead of updating overlay directly
    const clip = clips.find(c => c.id === dragState.clipId);
    const isKeyframeMode = keyframePanelOpen && clip && clip.id === selectedClipId;

    // Calculate keyframe time (relative to clip start)
    const keyframeTime = clip ? currentTime - clip.timelinePosition : 0;

    // Helper to create keyframe or update overlay
    const applyChange = (property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY', value: number) => {
      if (isKeyframeMode && clip) {
        setClipKeyframe(clip.id, property, {
          time: keyframeTime,
          value,
          easing: 'ease-in-out',
        });
      }
    };

    if (dragState.mode === 'move') {
      // Move mode
      const deltaX = pos.x - dragState.startMouseX;
      const deltaY = pos.y - dragState.startMouseY;
      const newX = Math.max(0, Math.min(1, dragState.startOverlayX + deltaX));
      const newY = Math.max(0, Math.min(1, dragState.startOverlayY + deltaY));

      if (isKeyframeMode) {
        applyChange('x', newX);
        applyChange('y', newY);
      } else {
        // Use throttled updates for smoother drag performance
        if (dragState.clipType === 'text') {
          throttledTextUpdate.scheduleUpdate(
            ({ id, data }) => updateTextOverlayData(id, data, true),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => updateShapeOverlayData(id, data, true),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => updateClipTransform(id, transform, true),
            { id: dragState.clipId, transform: { x: newX, y: newY } }
          );
        }
      }
    } else if (dragState.mode === 'rotate') {
      // Rotation mode - calculate angle from center to mouse
      const centerX = dragState.startOverlayX;
      const centerY = dragState.startOverlayY;
      const angle = Math.atan2(pos.y - centerY, pos.x - centerX);
      const startAngle = Math.atan2(
        dragState.startMouseY - centerY,
        dragState.startMouseX - centerX
      );
      const deltaAngle = ((angle - startAngle) * 180) / Math.PI;
      const newRotation = dragState.startRotation + deltaAngle;

      if (isKeyframeMode) {
        applyChange('rotation', newRotation);
      } else {
        // Use throttled updates for smoother drag performance
        if (dragState.clipType === 'text') {
          throttledTextUpdate.scheduleUpdate(
            ({ id, data }) => updateTextOverlayData(id, data, true),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => updateShapeOverlayData(id, data, true),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => updateClipTransform(id, transform, true),
            { id: dragState.clipId, transform: { rotation: newRotation } }
          );
        }
      }
    } else {
      // Resize modes
      const deltaX = pos.x - dragState.startMouseX;
      const deltaY = pos.y - dragState.startMouseY;

      let newWidth = dragState.startWidth;
      let newHeight = dragState.startHeight;
      let newX = dragState.startOverlayX;
      let newY = dragState.startOverlayY;

      // Handle different resize directions.
      // Match on the compass direction alone: the mode name itself contains
      // the 'e' and the 's' of "resize", so every handle would look like an
      // east/south one.
      const mode = dragState.mode;
      const direction = mode.startsWith('resize-') ? mode.slice('resize-'.length) : '';

      if (direction.includes('e')) {
        newWidth = Math.max(0.02, dragState.startWidth + deltaX);
      }
      if (direction.includes('w')) {
        const widthDelta = -deltaX;
        newWidth = Math.max(0.02, dragState.startWidth + widthDelta);
        newX = dragState.startOverlayX + deltaX / 2;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(0.02, dragState.startHeight + deltaY);
      }
      if (direction.includes('n')) {
        const heightDelta = -deltaY;
        newHeight = Math.max(0.02, dragState.startHeight + heightDelta);
        newY = dragState.startOverlayY + deltaY / 2;
      }

      // Corner handles: Shift toggles lock state. When locked, scale uniformly.
      if (mode === 'resize-nw' || mode === 'resize-ne' || mode === 'resize-sw' || mode === 'resize-se') {
        // Determine effective lock: Shift temporarily toggles the clip's scaleLocked setting
        const clipScaleLocked = clip?.transform.scaleLocked ?? true;
        const effectiveLock = e.shiftKey ? !clipScaleLocked : clipScaleLocked;

        const widthRatio = newWidth / dragState.startWidth;
        const heightRatio = newHeight / dragState.startHeight;

        if (isKeyframeMode) {
          // Calculate scale values for keyframes
          if (effectiveLock) {
            // Uniform scale: use the diagonal (larger ratio) for both axes
            const uniformRatio = Math.max(widthRatio, heightRatio);
            applyChange('scaleX', Math.max(0.1, uniformRatio * dragState.startScaleX));
            applyChange('scaleY', Math.max(0.1, uniformRatio * dragState.startScaleY));
          } else {
            applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
            applyChange('scaleY', Math.max(0.1, heightRatio * dragState.startScaleY));
          }
          applyChange('x', newX);
          applyChange('y', newY);
        } else {
          // For shapes, update width/height
          // For text, update scale
          // For images/videos, update scaleX/scaleY
          // Use throttled updates for smoother drag performance
          if (dragState.clipType === 'text') {
            // Calculate scale based on the larger dimension change
            const newScale = Math.max(0.1, dragState.startScaleX * Math.max(widthRatio, heightRatio));
            throttledTextUpdate.scheduleUpdate(
              ({ id, data }) => updateTextOverlayData(id, data, true),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            if (effectiveLock) {
              // Uniform scale for shapes: use the larger ratio for both dimensions
              const uniformRatio = Math.max(widthRatio, heightRatio);
              const uniformWidth = Math.max(0.02, dragState.startWidth * uniformRatio);
              const uniformHeight = Math.max(0.02, dragState.startHeight * uniformRatio);
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => updateShapeOverlayData(id, data, true),
                { id: dragState.clipId, data: { width: uniformWidth, height: uniformHeight, x: newX, y: newY } }
              );
            } else {
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => updateShapeOverlayData(id, data, true),
                { id: dragState.clipId, data: { width: newWidth, height: newHeight, x: newX, y: newY } }
              );
            }
          } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
            if (effectiveLock) {
              // Uniform scale: apply the same ratio to both axes,
              // preserving any existing difference between scaleX and scaleY
              const uniformRatio = Math.max(widthRatio, heightRatio);
              const newScaleX = Math.max(0.1, dragState.startScaleX * uniformRatio);
              const newScaleY = Math.max(0.1, dragState.startScaleY * uniformRatio);
              throttledTransformUpdate.scheduleUpdate(
                ({ id, transform }) => updateClipTransform(id, transform, true),
                { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
              );
            } else {
              const newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
              const newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
              throttledTransformUpdate.scheduleUpdate(
                ({ id, transform }) => updateClipTransform(id, transform, true),
                { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
              );
            }
          }
        }
      } else {
        // Side handles - single axis resize
        if (isKeyframeMode) {
          const widthRatio = newWidth / dragState.startWidth;
          const heightRatio = newHeight / dragState.startHeight;
          if (direction.includes('e') || direction.includes('w')) {
            applyChange('scaleX', Math.max(0.1, widthRatio * dragState.startScaleX));
          }
          if (direction.includes('n') || direction.includes('s')) {
            applyChange('scaleY', Math.max(0.1, heightRatio * dragState.startScaleY));
          }
          applyChange('x', newX);
          applyChange('y', newY);
        } else {
          // Use throttled updates for smoother drag performance
          if (dragState.clipType === 'text') {
            // For text, side handles also scale
            const widthRatio = newWidth / dragState.startWidth;
            const heightRatio = newHeight / dragState.startHeight;
            const scaleRatio = direction.includes('e') || direction.includes('w') ? widthRatio : heightRatio;
            const newScale = Math.max(0.1, dragState.startScaleX * scaleRatio);
            throttledTextUpdate.scheduleUpdate(
              ({ id, data }) => updateTextOverlayData(id, data, true),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            throttledShapeUpdate.scheduleUpdate(
              ({ id, data }) => updateShapeOverlayData(id, data, true),
              { id: dragState.clipId, data: { width: newWidth, height: newHeight, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
            const widthRatio = newWidth / dragState.startWidth;
            const heightRatio = newHeight / dragState.startHeight;
            let newScaleX = dragState.startScaleX;
            let newScaleY = dragState.startScaleY;
            if (direction.includes('e') || direction.includes('w')) {
              newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
            }
            if (direction.includes('n') || direction.includes('s')) {
              newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
            }
            throttledTransformUpdate.scheduleUpdate(
              ({ id, transform }) => updateClipTransform(id, transform, true),
              { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
            );
          }
        }
      }
    }

    // Redraw selection handles after update
    requestAnimationFrame(() => {
      drawFrame(currentTime);
      drawSelectionHandles(currentTime);
      drawMultiSelectHandles(currentTime);
    });
  }, [dragState, getCanvasPosition, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, currentTime, drawFrame, drawSelectionHandles, drawMultiSelectHandles, keyframePanelOpen, selectedClipId, clips, setClipKeyframe, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart, canvasRef]);

  const handleMouseUp = useCallback((e?: MouseEvent<HTMLCanvasElement>) => {
    // Handle marquee selection completion
    if (marqueeStart) {
      if (marqueeActive && canvasRef.current) {
        const canvas = canvasRef.current;

        const intersecting = clipsIntersectingMarquee(
          canvas, marqueeStart, marqueeCurrent!, clips, currentTime, sourceVideos
        );

        const nativeEvent = e as unknown as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
        if (nativeEvent?.ctrlKey || nativeEvent?.metaKey) {
          // Add to existing selection
          const existing = Array.from(selectedClipIds);
          const combined = [...new Set([...existing, ...intersecting])];
          selectClipsInRange(combined);
        } else {
          selectClipsInRange(intersecting);
        }
      } else {
        // No drag happened - just a click on empty space: deselect
        clearMultiSelection();
        setSelectedClipId(null);
      }

      setMarqueeStart(null);
      setMarqueeCurrent(null);
      return;
    }

    if (dragState) {
      // Flush any pending throttled updates to ensure state is current
      throttledTextUpdate.flush();
      throttledShapeUpdate.flush();
      throttledTransformUpdate.flush();

      const clip = clips.find(c => c.id === dragState.clipId);
      const isKeyframeMode = keyframePanelOpen && clip && clip.id === selectedClipId;

      // Only commit changes to history when NOT in keyframe mode
      // (In keyframe mode, we're creating keyframes instead)
      if (!isKeyframeMode && clip) {
        if (dragState.clipType === 'text' && clip.textData) {
          updateTextOverlayData(dragState.clipId, {
            x: clip.textData.x,
            y: clip.textData.y,
            rotation: clip.textData.rotation,
            scale: clip.textData.scale,
          });
        } else if (dragState.clipType === 'shape' && clip.shapeData) {
          updateShapeOverlayData(dragState.clipId, {
            x: clip.shapeData.x,
            y: clip.shapeData.y,
            width: clip.shapeData.width,
            height: clip.shapeData.height,
            rotation: clip.shapeData.rotation,
          });
        } else if ((dragState.clipType === 'image' || dragState.clipType === 'video') && clip.transform) {
          updateClipTransform(dragState.clipId, {
            x: clip.transform.x,
            y: clip.transform.y,
            scaleX: clip.transform.scaleX,
            scaleY: clip.transform.scaleY,
            rotation: clip.transform.rotation,
          });
        }
      }
    }
    setDragState(null);
  }, [dragState, clips, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, keyframePanelOpen, selectedClipId, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart, marqueeActive, marqueeCurrent, currentTime, sourceVideos, selectedClipIds, selectClipsInRange, clearMultiSelection, setSelectedClipId, canvasRef]);

  const handleMouseLeave = useCallback(() => {
    // Don't cancel drag when mouse leaves canvas — window listeners handle it
    if (dragState) return;

    // Only cancel non-drag operations
    setMarqueeStart(null);
    setMarqueeCurrent(null);
  }, [dragState]);

  // Window-level mouse listeners during drag — allows dragging outside the canvas
  useEffect(() => {
    if (!dragState) return;

    const onWindowMouseMove = (e: globalThis.MouseEvent) => {
      handleMouseMove(e as unknown as MouseEvent<HTMLCanvasElement>);
    };

    const onWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Double-click handler to enter inline text editing
  // Works even in keyframe mode — double-click always opens text editor
  const handleDoubleClick = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return;

    // Cancel any drag that started from the first click of the double-click
    if (dragState) {
      setDragState(null);
    }

    const pos = getCanvasPosition(e);

    // Check all active text clips, not just via hitTestHandles (which is keyframe-restricted)
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mouseX = pos.x * canvas.width;
    const mouseY = pos.y * canvas.height;

    const clip = textClipAtPoint(mouseX, mouseY, canvas, clips, tracks, currentTime, sourceVideos);
    if (clip) {
      e.preventDefault();
      e.stopPropagation();
      setEditingTextClipId(clip.id);
      setSelectedClipId(clip.id);
    }
  }, [isPlaying, dragState, getCanvasPosition, clips, tracks, currentTime, sourceVideos, setSelectedClipId, canvasRef, setEditingTextClipId]);

  // Determine cursor based on hover state
  const getCursor = useCallback((e: MouseEvent<HTMLCanvasElement>): string => {
    if (isPlaying) return 'default';
    if (dragState) return getCursorForMode(dragState.mode);

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y);
    return hit ? getCursorForMode(hit.mode) : 'default';
  }, [isPlaying, dragState, getCanvasPosition, hitTestHandles]);

  const handleMouseMoveForCursor = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    setCursor(getCursor(e));
    handleMouseMove(e);
  }, [getCursor, handleMouseMove]);

  return {
    cursor,
    handleMouseDown,
    handleMouseMoveForCursor,
    handleMouseUp,
    handleMouseLeave,
    handleDoubleClick,
    marqueeStart,
    marqueeCurrent,
    marqueeActive,
  };
}
