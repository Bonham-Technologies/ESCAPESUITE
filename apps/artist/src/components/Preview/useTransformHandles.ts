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
// frame rather than one per mouse event. With the keyframe panel open, the same
// gesture sets keyframes at the playhead instead of moving the clip outright.
//
// Either way the gesture is ONE undo entry, and it is the gesture's first
// store write *that lands* that pushes it: `pushToHistory` snapshots the state
// it is handed, so only a write that has not happened yet leaves the pre-drag
// state on the stack. Every write after that one passes `skipHistory: true`, and
// release writes nothing at all — see `gestureHistory` and `handleMouseUp`.
//
// "That lands" is ESCSUITE-87's word, and it is why the bookkeeping is
// `hooks/useGestureHistory.ts` rather than a ref of this hook's own, shared with
// the inspector's sliders and the timeline's trim: a clip on a locked row refuses
// the write and pushes nothing (ESCSUITE-84), so every write here goes through
// `gestureHistory.commit`, which hands the flag over and takes the "already
// pushed" mark back if the store says the write did not happen.
//
// The store is read here with the same selectors the preview component uses,
// so the caller hands over only what a hook cannot reach: the canvas, the
// redraw functions, and the way in to inline text editing.
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useGestureHistory, useThrottledDragUpdate } from '../../hooks';
import type { ClipTransform, TextOverlayData, ShapeOverlayData } from '../../store/types';
import * as geometry from './previewGeometry';
import * as hitTest from './hitTest';
import { clipsIntersectingMarquee, measureDragStart, textClipAtPoint } from './dragGeometry';
import { getActiveTransition } from './transitions';
import { clipOnLockedTrack, isTrackLocked } from '../../store/trackLock';
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

  // The project's pixel grid: every measurement below is in it, and it is not
  // the canvas' backing store, which follows the size the preview is displayed
  // at. `projectSizeOf` is the one derivation, shared with `PreviewPlayer`.
  const resolution = useEditorStore((state) => state.project.resolution);
  const projectSize = useMemo(() => geometry.projectSizeOf(resolution), [resolution]);

  /**
   * The transition active at the playhead, or null.
   *
   * Every measurement below reads a clip's animation, and the renderer leaves out
   * whichever preset side an active transition owns (ESCSUITE-139) — so the box a
   * pointer is tested against, the rectangle a marquee sweeps, the text a
   * double-click lands on and the position a keyframe drag seeds from all have to
   * be measured under the same suppression, or they describe a picture nobody can
   * see (ESCSUITE-147). Derived once here rather than at each of the four call
   * sites: it is a function of three things every one of them already depends on,
   * and one answer cannot disagree with itself.
   *
   * `null` wherever there is no transition, which is almost always — so the memo,
   * and every callback that takes it as a dependency, stays referentially stable
   * through an ordinary scrub and only churns inside a window.
   */
  const activeTransition = useMemo(
    () => getActiveTransition(clips, tracks, currentTime),
    [clips, tracks, currentTime]
  );

  // Drag state for overlay manipulation
  const [dragState, setDragState] = useState<DragState | null>(null);

  /**
   * The gesture's "has its undo entry been pushed yet?" bookkeeping. Not state:
   * it is read and written inside the throttled updaters' callbacks, which run
   * after the render that scheduled them.
   *
   * Every store write below runs through its `commit`, *inside* the updater the
   * throttler runs and never at the mousemove that schedules one: the throttler
   * coalesces a frame's moves into a single write, so "first" has to mean the
   * first write that actually reaches the store, not the first move that asked
   * for one. `commit` also takes the mark back when the store refuses a write
   * (ESCSUITE-87), so the entry follows the first write that lands.
   */
  const gestureHistory = useGestureHistory();

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
  // Accepts any MouseEvent (canvas or window) so dragging works outside the canvas.
  //
  // `scale` comes out with the point: CSS pixels per project pixel, measured off
  // the same rect this call already read. Its inverse is what the handle hit
  // test needs (ESCSUITE-90), and taking it from here is what keeps a pointer
  // move to one forced layout instead of two.
  const getCanvasPosition = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, scale: 1 };
    return geometry.getCanvasPosition(canvas, e, projectSize);
  }, [canvasRef, projectSize]);

  // Hit test: find what's at the given position (handles take priority over
  // overlay bodies). `screenScale` is project pixels per CSS pixel — the chrome
  // is drawn at a constant size on screen, so its hit zones are that size in
  // project pixels (ESCSUITE-90); it is `1 / pos.scale` from the position the
  // caller has already measured.
  /**
   * Project pixels per CSS pixel for a hit test, from the position's own
   * `scale` (CSS per project). A collapsed box reports 0, and dividing by it
   * would make every tolerance infinite and every point a rotate handle — the
   * same fallback the draw path takes: treat it as 1.
   */
  const screenScaleOf = (pos: { scale: number }): number => (pos.scale > 0 ? 1 / pos.scale : 1);

  const hitTestHandles = useCallback((
    normalizedX: number,
    normalizedY: number,
    screenScale: number
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return hitTest.hitTestHandles(normalizedX, normalizedY, canvas, {
      clips,
      tracks,
      sourceVideos,
      currentTime,
      selectedClipId,
      keyframePanelOpen,
      transition: activeTransition,
    }, projectSize, screenScale);
  }, [canvasRef, clips, tracks, sourceVideos, currentTime, selectedClipId, keyframePanelOpen,
      projectSize, activeTransition]);

  // Mouse event handlers for drag-and-drop
  const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    if (isPlaying) return; // Don't allow dragging during playback

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y, screenScaleOf(pos));

    if (hit) {
      e.preventDefault();
      const clip = clips.find(c => c.id === hit.clipId);
      if (!clip) return;

      // A clip on a locked row can be picked, not moved (ESCSUITE-88). The
      // selection still happens, so the inspector can show the clip and say why
      // it is read-only; the gesture does not start at all — no undo entry owed,
      // no drag state, and nothing bound to the window — because every write it
      // would make is one the store refuses in silence. `getCursor` says the same
      // thing before the press.
      if (clipOnLockedTrack(clips, tracks, hit.clipId)) {
        setSelectedClipId(hit.clipId);
        return;
      }

      // Check if we should use animated values (keyframe mode)
      const isKeyframeMode = keyframePanelOpen && clip.id === selectedClipId;

      // A clip carrying custom keyframes (ESCSUITE-3) is picked the same way,
      // *outside* keyframe mode: the body hit itself is what stops the click
      // falling through to whatever is on the track below (hitTest.ts's second
      // pass no longer skips it), and the gesture stops here rather than
      // starting a drag the keyframe panel owns. Inside keyframe mode, for the
      // clip the panel has open, a drag is exactly how a keyframe gets set —
      // `isKeyframeMode` is what the panel is for — so it is exempted.
      if (geometry.hasCustomKeyframes(clip) && !isKeyframeMode) {
        setSelectedClipId(hit.clipId);
        return;
      }

      const canvas = canvasRef.current;

      const {
        startX, startY, startWidth, startHeight, startRotation, startScaleX, startScaleY,
      } = measureDragStart(
        clip, hit.clipType, canvas, currentTime, isKeyframeMode, sourceVideos, projectSize,
        activeTransition
      );

      // A fresh gesture owes the undo stack one entry, which its first store
      // write will push. A press released without a move writes nothing and so
      // pushes nothing.
      gestureHistory.begin();

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
  }, [isPlaying, getCanvasPosition, hitTestHandles, clips, tracks, setSelectedClipId, sourceVideos, keyframePanelOpen, selectedClipId, currentTime, canvasRef, projectSize, gestureHistory, activeTransition]);

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
        gestureHistory.commit((skipHistory) => setClipKeyframe(clip.id, property, {
          time: keyframeTime,
          value,
          easing: 'ease-in-out',
        }, skipHistory));
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
            ({ id, data }) => gestureHistory.commit((skipHistory) => updateTextOverlayData(id, data, skipHistory)),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => gestureHistory.commit((skipHistory) => updateShapeOverlayData(id, data, skipHistory)),
            { id: dragState.clipId, data: { x: newX, y: newY } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => gestureHistory.commit((skipHistory) => updateClipTransform(id, transform, skipHistory)),
            { id: dragState.clipId, transform: { x: newX, y: newY } }
          );
        }
      }
    } else if (dragState.mode === 'rotate') {
      // Rotation mode - calculate angle from center to mouse.
      //
      // In project pixels, not in the normalised 0-1 space the positions arrive
      // in: normalised x spans the project's width and normalised y its height,
      // so on any non-square project an angle read off them is measured in a
      // stretched space and the clip lags the pointer (45° on screen reads as
      // atan(720/1280) = 29.4° on a 1280x720 frame). The preview is displayed
      // with the project's own aspect ratio — object-fit: contain, no stretch —
      // so a project-pixel angle *is* the angle on screen.
      const centerX = dragState.startOverlayX * projectSize.width;
      const centerY = dragState.startOverlayY * projectSize.height;
      const angle = Math.atan2(
        pos.y * projectSize.height - centerY,
        pos.x * projectSize.width - centerX
      );
      const startAngle = Math.atan2(
        dragState.startMouseY * projectSize.height - centerY,
        dragState.startMouseX * projectSize.width - centerX
      );
      const deltaAngle = ((angle - startAngle) * 180) / Math.PI;
      const newRotation = dragState.startRotation + deltaAngle;

      if (isKeyframeMode) {
        applyChange('rotation', newRotation);
      } else {
        // Use throttled updates for smoother drag performance
        if (dragState.clipType === 'text') {
          throttledTextUpdate.scheduleUpdate(
            ({ id, data }) => gestureHistory.commit((skipHistory) => updateTextOverlayData(id, data, skipHistory)),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'shape') {
          throttledShapeUpdate.scheduleUpdate(
            ({ id, data }) => gestureHistory.commit((skipHistory) => updateShapeOverlayData(id, data, skipHistory)),
            { id: dragState.clipId, data: { rotation: newRotation } }
          );
        } else if (dragState.clipType === 'image' || dragState.clipType === 'video') {
          throttledTransformUpdate.scheduleUpdate(
            ({ id, transform }) => gestureHistory.commit((skipHistory) => updateClipTransform(id, transform, skipHistory)),
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
              ({ id, data }) => gestureHistory.commit((skipHistory) => updateTextOverlayData(id, data, skipHistory)),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            if (effectiveLock) {
              // Uniform scale for shapes: use the larger ratio for both dimensions
              const uniformRatio = Math.max(widthRatio, heightRatio);
              const uniformWidth = Math.max(0.02, dragState.startWidth * uniformRatio);
              const uniformHeight = Math.max(0.02, dragState.startHeight * uniformRatio);
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => gestureHistory.commit((skipHistory) => updateShapeOverlayData(id, data, skipHistory)),
                { id: dragState.clipId, data: { width: uniformWidth, height: uniformHeight, x: newX, y: newY } }
              );
            } else {
              throttledShapeUpdate.scheduleUpdate(
                ({ id, data }) => gestureHistory.commit((skipHistory) => updateShapeOverlayData(id, data, skipHistory)),
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
                ({ id, transform }) => gestureHistory.commit((skipHistory) => updateClipTransform(id, transform, skipHistory)),
                { id: dragState.clipId, transform: { scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY } }
              );
            } else {
              const newScaleX = Math.max(0.1, dragState.startScaleX * widthRatio);
              const newScaleY = Math.max(0.1, dragState.startScaleY * heightRatio);
              throttledTransformUpdate.scheduleUpdate(
                ({ id, transform }) => gestureHistory.commit((skipHistory) => updateClipTransform(id, transform, skipHistory)),
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
              ({ id, data }) => gestureHistory.commit((skipHistory) => updateTextOverlayData(id, data, skipHistory)),
              { id: dragState.clipId, data: { scale: newScale, x: newX, y: newY } }
            );
          } else if (dragState.clipType === 'shape') {
            throttledShapeUpdate.scheduleUpdate(
              ({ id, data }) => gestureHistory.commit((skipHistory) => updateShapeOverlayData(id, data, skipHistory)),
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
              ({ id, transform }) => gestureHistory.commit((skipHistory) => updateClipTransform(id, transform, skipHistory)),
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
  }, [dragState, getCanvasPosition, updateTextOverlayData, updateShapeOverlayData, updateClipTransform, currentTime, drawFrame, drawSelectionHandles, drawMultiSelectHandles, keyframePanelOpen, selectedClipId, clips, setClipKeyframe, gestureHistory, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart, canvasRef, projectSize]);

  const handleMouseUp = useCallback((e?: MouseEvent<HTMLCanvasElement>) => {
    // Handle marquee selection completion
    if (marqueeStart) {
      if (marqueeActive && canvasRef.current) {
        const canvas = canvasRef.current;

        const intersecting = clipsIntersectingMarquee(
          canvas, marqueeStart, marqueeCurrent!, clips, tracks, currentTime, sourceVideos,
          projectSize, activeTransition
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
      // Land the last move, if a frame was still owed one. That flush is the
      // gesture's final store write; release makes none of its own.
      //
      // It used to re-write the clip's current values here without a
      // `skipHistory` flag, as the gesture's one history push. That is exactly
      // backwards: `pushToHistory` snapshots the state it is given, so a push
      // at release recorded the *moved* clip, and undo after a drag landed on
      // the position the drag had just produced. The push now rides the
      // gesture's first landed write instead — see `gestureHistory`.
      throttledTextUpdate.flush();
      throttledShapeUpdate.flush();
      throttledTransformUpdate.flush();
    }
    // Belt and braces with the `begin` in `handleMouseDown`: every one of the 15
    // write sites is gated on a `dragState` only that branch creates, so the
    // flag cannot be read stale today. Closing the gesture here too keeps the
    // invariant local to it, for whatever writes this hook grows next.
    gestureHistory.end();
    setDragState(null);
  }, [dragState, clips, tracks, throttledTextUpdate, throttledShapeUpdate, throttledTransformUpdate, marqueeStart, marqueeActive, marqueeCurrent, currentTime, sourceVideos, selectedClipIds, selectClipsInRange, clearMultiSelection, setSelectedClipId, canvasRef, projectSize, gestureHistory, activeTransition]);

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

    const mouseX = pos.x * projectSize.width;
    const mouseY = pos.y * projectSize.height;

    const clip = textClipAtPoint(
      mouseX, mouseY, canvas, clips, tracks, currentTime, sourceVideos, projectSize,
      activeTransition
    );
    // A locked row's clip would open the editor and then lose every keystroke
    // to the store's refusal, silently — so it does not open (ESCSUITE-84).
    if (clip && !clipOnLockedTrack(clips, tracks, clip.id)) {
      e.preventDefault();
      e.stopPropagation();
      setEditingTextClipId(clip.id);
      setSelectedClipId(clip.id);
    }
  }, [isPlaying, dragState, getCanvasPosition, clips, tracks, currentTime, sourceVideos, setSelectedClipId, canvasRef, setEditingTextClipId, projectSize, activeTransition]);

  // Determine cursor based on hover state.
  //
  // A clip on a locked row reads `not-allowed` (ESCSUITE-88): the cursor is the
  // pointer's promise about what a press would start, and on a locked row a
  // press starts nothing. The `dragState` branch asks too, defensively — a
  // locked clip can no longer reach it, but a row locked *mid-gesture* can.
  // A keyframed clip outside keyframe mode (ESCSUITE-3) reads the same way,
  // for the same reason: a press over it selects and starts nothing.
  const getCursor = useCallback((e: MouseEvent<HTMLCanvasElement>): string => {
    if (isPlaying) return 'default';
    if (dragState) {
      return clipOnLockedTrack(clips, tracks, dragState.clipId)
        ? 'not-allowed'
        : getCursorForMode(dragState.mode);
    }

    const pos = getCanvasPosition(e);
    const hit = hitTestHandles(pos.x, pos.y, screenScaleOf(pos));
    if (!hit) return 'default';

    // This runs on every pointer move over the canvas, so the locked and
    // keyframed checks below share one lookup instead of each finding the
    // clip again (ESCSUITE-3 review round 1, NIT-4) — `isTrackLocked` takes
    // the resolved track id directly, where `clipOnLockedTrack` would repeat
    // the find `hitTestHandles` already did to produce `hit`. The assertion
    // is safe: `hit.clipId` only ever names a clip `hitTestHandles` found in
    // this same `clips` array.
    const clip = clips.find(c => c.id === hit.clipId)!;
    const isKeyframeMode = keyframePanelOpen && hit.clipId === selectedClipId;
    if (
      isTrackLocked(tracks, clip.trackId) ||
      (geometry.hasCustomKeyframes(clip) && !isKeyframeMode)
    ) {
      return 'not-allowed';
    }
    return getCursorForMode(hit.mode);
  }, [isPlaying, dragState, clips, tracks, getCanvasPosition, hitTestHandles, keyframePanelOpen, selectedClipId]);

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
