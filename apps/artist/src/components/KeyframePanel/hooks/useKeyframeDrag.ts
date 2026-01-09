import { useState, useCallback, useEffect, useRef } from 'react';
import type { Keyframe, AnimatableProperty } from '../../../store/types';

interface DragState {
  isDragging: boolean;
  keyframe: Keyframe | null;
  property: AnimatableProperty | null;
  originalTime: number;
  currentTime: number;
}

const SNAP_THRESHOLD_PX = 5;

export function useKeyframeDrag(
  clipDuration: number,
  playheadTime: number,
  allKeyframeTimes: number[],
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void
) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    keyframe: null,
    property: null,
    originalTime: 0,
    currentTime: 0,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback((
    property: AnimatableProperty,
    keyframe: Keyframe,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setDragState({
      isDragging: true,
      keyframe,
      property,
      originalTime: keyframe.time,
      currentTime: keyframe.time,
    });
  }, []);

  const pixelsToTime = useCallback((pixelX: number, trackWidth: number): number => {
    const ratio = pixelX / trackWidth;
    return Math.max(0, Math.min(ratio * clipDuration, clipDuration));
  }, [clipDuration]);

  const findSnapTime = useCallback((time: number, trackWidth: number): number | null => {
    const pixelThreshold = SNAP_THRESHOLD_PX;
    const timeThreshold = (pixelThreshold / trackWidth) * clipDuration;

    // Snap to playhead
    if (Math.abs(time - playheadTime) < timeThreshold) {
      return playheadTime;
    }

    // Snap to other keyframe times
    for (const kfTime of allKeyframeTimes) {
      if (kfTime !== dragState.originalTime && Math.abs(time - kfTime) < timeThreshold) {
        return kfTime;
      }
    }

    return null;
  }, [playheadTime, allKeyframeTimes, clipDuration, dragState.originalTime]);

  // Handle mouse move during drag
  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      let newTime = pixelsToTime(relativeX, rect.width);

      // Try to snap
      const snapTime = findSnapTime(newTime, rect.width);
      if (snapTime !== null) {
        newTime = snapTime;
      }

      setDragState(prev => ({
        ...prev,
        currentTime: newTime,
      }));
    };

    const handleMouseUp = () => {
      if (dragState.property && dragState.currentTime !== dragState.originalTime) {
        onKeyframeMoved(dragState.property, dragState.originalTime, dragState.currentTime);
      }

      setDragState({
        isDragging: false,
        keyframe: null,
        property: null,
        originalTime: 0,
        currentTime: 0,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState.isDragging, dragState.property, dragState.originalTime, dragState.currentTime, pixelsToTime, findSnapTime, onKeyframeMoved]);

  return {
    dragState,
    startDrag,
    trackRef,
  };
}
