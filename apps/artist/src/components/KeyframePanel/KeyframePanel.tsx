import { useMemo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../../store/projectStore';
import type { Clip, AnimatableProperty } from '../../store/types';
import { useDraggablePanel } from './hooks/useDraggablePanel';
import { KeyframeTrack } from './KeyframeTrack';
import { KeyframeGraph } from './KeyframeGraph';
import { ClipPreview } from './ClipPreview';
import styles from './KeyframePanel.module.css';

const ANIMATABLE_PROPERTIES: { property: AnimatableProperty; label: string }[] = [
  { property: 'x', label: 'Position X' },
  { property: 'y', label: 'Position Y' },
  { property: 'scaleX', label: 'Scale X' },
  { property: 'scaleY', label: 'Scale Y' },
  { property: 'rotation', label: 'Rotation' },
  { property: 'opacity', label: 'Opacity' },
  { property: 'blur', label: 'Blur' },
];

export function KeyframePanel() {
  const {
    keyframePanelState,
    setKeyframePanelOpen,
    setKeyframePanelPosition,
    setKeyframePanelSize,
    setKeyframePanelSelectedProperty,
    selectedClipId,
    project,
    currentTime,
    moveClipKeyframe,
    setClipKeyframe,
    removeClipKeyframe,
    setCurrentTime,
  } = useEditorStore();

  const { isOpen, selectedProperty } = keyframePanelState;

  // Local preview time state (independent of main timeline when scrubbing)
  const [previewTime, setPreviewTime] = useState<number | null>(null);

  // Get selected clip
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return project.timeline.clips.find((c: Clip) => c.id === selectedClipId) || null;
  }, [selectedClipId, project.timeline.clips]);

  // Calculate time relative to clip
  const clipRelativeTime = useMemo(() => {
    if (!selectedClip) return 0;
    return Math.max(0, Math.min(
      currentTime - selectedClip.timelinePosition,
      selectedClip.duration
    ));
  }, [selectedClip, currentTime]);

  // Playhead time relative to clip (use preview time if set, otherwise main timeline)
  const playheadTime = useMemo(() => {
    if (!selectedClip) return 0;
    if (previewTime !== null) return previewTime;
    const relative = currentTime - selectedClip.timelinePosition;
    if (relative < 0 || relative > selectedClip.duration) return 0;
    return relative;
  }, [selectedClip, currentTime, previewTime]);

  // Handle preview time change (from ClipPreview scrubbing)
  const handlePreviewTimeChange = useCallback((time: number) => {
    setPreviewTime(time);
    // Also update main timeline to sync
    if (selectedClip) {
      setCurrentTime(selectedClip.timelinePosition + time);
    }
  }, [selectedClip, setCurrentTime]);

  // Draggable panel hook
  const {
    position,
    size,
    onTitleBarMouseDown,
    onResizeMouseDown,
  } = useDraggablePanel(
    keyframePanelState.position,
    keyframePanelState.size,
    setKeyframePanelPosition,
    setKeyframePanelSize
  );

  // Handle close
  const handleClose = useCallback(() => {
    setKeyframePanelOpen(false);
  }, [setKeyframePanelOpen]);

  // Handle property selection
  const handlePropertySelect = useCallback((property: AnimatableProperty) => {
    setKeyframePanelSelectedProperty(
      selectedProperty === property ? null : property
    );
  }, [selectedProperty, setKeyframePanelSelectedProperty]);

  // Handle keyframe moved
  const handleKeyframeMoved = useCallback((
    property: AnimatableProperty,
    originalTime: number,
    newTime: number
  ) => {
    if (selectedClipId) {
      moveClipKeyframe(selectedClipId, property, originalTime, newTime);
    }
  }, [selectedClipId, moveClipKeyframe]);

  // Handle add keyframe (with optional value)
  const handleAddKeyframe = useCallback((property: AnimatableProperty, time: number, value?: number) => {
    if (!selectedClip) return;

    // Get current value at this time for interpolation if not provided
    let keyframeValue = value;
    if (keyframeValue === undefined) {
      const transform = selectedClip.transform;
      const effects = selectedClip.effects;

      if (property === 'blur') {
        keyframeValue = effects?.blur ?? 0;
      } else {
        keyframeValue = transform?.[property as keyof typeof transform] ?? 0;
      }
    }

    setClipKeyframe(selectedClipId!, property, {
      time,
      value: keyframeValue,
      easing: 'ease-in-out',
    });
  }, [selectedClip, selectedClipId, setClipKeyframe]);

  // Handle keyframe value changed (from graph drag)
  const handleKeyframeValueChanged = useCallback((
    property: AnimatableProperty,
    time: number,
    newValue: number
  ) => {
    if (!selectedClipId) return;

    // Get fresh state from store to avoid stale memoized values
    const state = useEditorStore.getState();
    const freshClip = state.project.timeline.clips.find(c => c.id === selectedClipId);
    const existingKeyframes = freshClip?.animation?.keyframes[property] || [];
    const existingKf = existingKeyframes.find(kf => Math.abs(kf.time - time) < 0.001);

    // Update existing keyframe or create new one at this time
    setClipKeyframe(selectedClipId, property, {
      time: time,
      value: newValue,
      easing: existingKf?.easing || 'ease-in-out',
    });
  }, [selectedClipId, setClipKeyframe]);

  // Handle keyframe deletion
  const handleDeleteKeyframe = useCallback((property: AnimatableProperty, time: number) => {
    if (selectedClipId) {
      removeClipKeyframe(selectedClipId, property, time);
    }
  }, [selectedClipId, removeClipKeyframe]);

  if (!isOpen) return null;

  const panelContent = (
    <div
      className={styles.panel}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={onTitleBarMouseDown}>
        <span className={styles.title}>Keyframe Editor</span>
        {selectedClip && (
          <span className={styles.clipName}>{selectedClip.name}</span>
        )}
        <button className={styles.closeButton} onClick={handleClose}>
          ×
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {!selectedClip ? (
          <div className={styles.noClip}>
            <p>Select a clip to edit keyframes</p>
          </div>
        ) : (
          <>
            {/* Clip Preview */}
            <ClipPreview
              clip={selectedClip}
              playheadTime={playheadTime}
              onTimeChange={handlePreviewTimeChange}
            />

            {/* Graph view when property selected */}
            {selectedProperty && (
              <div className={styles.graphContainer}>
                <div className={styles.graphHeader}>
                  <span className={styles.graphTitle}>
                    {ANIMATABLE_PROPERTIES.find(p => p.property === selectedProperty)?.label}
                  </span>
                  <button
                    className={styles.graphClose}
                    onClick={() => setKeyframePanelSelectedProperty(null)}
                  >
                    ×
                  </button>
                </div>
                <KeyframeGraph
                  property={selectedProperty}
                  clipDuration={selectedClip.duration}
                  animation={selectedClip.animation}
                  transform={selectedClip.transform}
                  effects={selectedClip.effects}
                  playheadTime={playheadTime}
                  onKeyframeMoved={handleKeyframeMoved}
                  onKeyframeValueChanged={handleKeyframeValueChanged}
                  onAddKeyframe={handleAddKeyframe}
                  onDeleteKeyframe={handleDeleteKeyframe}
                />
              </div>
            )}

            {/* Property tracks */}
            <div className={styles.tracks}>
              {ANIMATABLE_PROPERTIES.map(({ property, label }) => (
                <KeyframeTrack
                  key={property}
                  property={property}
                  label={label}
                  clipId={selectedClip.id}
                  clipDuration={selectedClip.duration}
                  animation={selectedClip.animation}
                  transform={selectedClip.transform}
                  effects={selectedClip.effects}
                  currentTime={clipRelativeTime}
                  playheadTime={playheadTime}
                  isSelected={selectedProperty === property}
                  onSelect={() => handlePropertySelect(property)}
                  onKeyframeMoved={handleKeyframeMoved}
                  onAddKeyframe={handleAddKeyframe}
                />
              ))}
            </div>

            {/* Help text */}
            <div className={styles.helpText}>
              Double-click track to add keyframe • Drag diamonds to move • Click track to see curve
            </div>
          </>
        )}
      </div>

      {/* Resize handles */}
      <div className={styles.resizeN} onMouseDown={(e) => onResizeMouseDown(e, 'n')} />
      <div className={styles.resizeS} onMouseDown={(e) => onResizeMouseDown(e, 's')} />
      <div className={styles.resizeE} onMouseDown={(e) => onResizeMouseDown(e, 'e')} />
      <div className={styles.resizeW} onMouseDown={(e) => onResizeMouseDown(e, 'w')} />
      <div className={styles.resizeNE} onMouseDown={(e) => onResizeMouseDown(e, 'ne')} />
      <div className={styles.resizeNW} onMouseDown={(e) => onResizeMouseDown(e, 'nw')} />
      <div className={styles.resizeSE} onMouseDown={(e) => onResizeMouseDown(e, 'se')} />
      <div className={styles.resizeSW} onMouseDown={(e) => onResizeMouseDown(e, 'sw')} />
    </div>
  );

  // Render as portal to body
  return createPortal(panelContent, document.body);
}
