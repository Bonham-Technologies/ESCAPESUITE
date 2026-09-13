import { useCallback, useMemo } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { DEFAULT_TRANSFORM } from '../../store/types';
import type { BlendMode, TransitionType, ShapeType, TextOverlayData, ShapeOverlayData, AnimationPresetType, EasingType } from '../../store/types';
import { hasAnimation } from '../../utils/animation';
import { describeClip, relativeTimeInClip, overlayPositionValue, maxPresetDuration, fitToCanvasScale, keyframeCount } from './clipEditorModel';
import { CollapsibleSection } from './CollapsibleSection';
import { ClipEditorEmptyState } from './ClipEditorEmptyState';
import { ClipEditorHeader } from './ClipEditorHeader';
import { TextContentSection } from './TextContentSection';
import { ShapeSection } from './ShapeSection';
import styles from './ClipEditor.module.css';

const TRANSITION_TYPES: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'wipe-left', label: 'Wipe Left' },
  { value: 'wipe-right', label: 'Wipe Right' },
  { value: 'wipe-up', label: 'Wipe Up' },
  { value: 'wipe-down', label: 'Wipe Down' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
];

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
  { value: 'add', label: 'Add' },
];

const ANIMATION_PRESETS: { value: AnimationPresetType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'scale', label: 'Scale' },
  { value: 'scale-up', label: 'Scale Up' },
  { value: 'scale-down', label: 'Scale Down' },
  { value: 'pop', label: 'Pop' },
  { value: 'blur', label: 'Blur' },
];

const EASING_TYPES: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'ease-in-cubic', label: 'Ease In (Cubic)' },
  { value: 'ease-out-cubic', label: 'Ease Out (Cubic)' },
  { value: 'ease-in-out-cubic', label: 'Ease In-Out (Cubic)' },
];

export function ClipEditor() {
  // Read scaleLocked from the selected clip's transform (default true for backwards compat)
  const scaleLocked = useEditorStore((state) => {
    const clip = state.project.timeline.clips.find(c => c.id === state.selectedClipId);
    return clip?.transform.scaleLocked ?? true;
  });
  const setScaleLocked = useCallback((locked: boolean) => {
    const clip = useEditorStore.getState().project.timeline.clips.find(
      c => c.id === useEditorStore.getState().selectedClipId
    );
    if (clip) {
      useEditorStore.getState().updateClipTransform(clip.id, { scaleLocked: locked });
    }
  }, []);

  const selectedClip = useEditorStore(selectSelectedClip);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const resolution = useEditorStore((state) => state.project.resolution);
  const currentTime = useEditorStore((state) => state.currentTime);

  const removeClipFromTimeline = useEditorStore((state) => state.removeClipFromTimeline);
  const splitClip = useEditorStore((state) => state.splitClip);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const updateClipTransform = useEditorStore((state) => state.updateClipTransform);
  const updateClipBlendMode = useEditorStore((state) => state.updateClipBlendMode);
  const updateClipEffects = useEditorStore((state) => state.updateClipEffects);
  const updateClipTransition = useEditorStore((state) => state.updateClipTransition);
  const updateClipAnimation = useEditorStore((state) => state.updateClipAnimation);
  const duplicateClip = useEditorStore((state) => state.duplicateClip);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const addTextOverlayClip = useEditorStore((state) => state.addTextOverlayClip);
  const addShapeOverlayClip = useEditorStore((state) => state.addShapeOverlayClip);
  const setKeyframePanelOpen = useEditorStore((state) => state.setKeyframePanelOpen);
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);

  const sourceVideo = useMemo(() => {
    if (!selectedClip) return null;
    return sourceVideos.find((v) => v.id === selectedClip.sourceVideoId);
  }, [selectedClip, sourceVideos]);

  const track = useMemo(() => {
    if (!selectedClip) return null;
    return tracks.find((t) => t.id === selectedClip.trackId);
  }, [selectedClip, tracks]);

  // Determine clip type
  const { isTextOverlay, isShapeOverlay, isOverlay, isAudio, isVideo, clipTypeLabel } =
    describeClip(selectedClip, sourceVideo);

  // Clip position is now stored directly on the clip
  const clipPosition = selectedClip?.timelinePosition ?? 0;

  // Calculate if current time is within this clip
  const timeInClip = useMemo(() => {
    if (!selectedClip) return null;
    return relativeTimeInClip(currentTime, clipPosition, selectedClip.duration);
  }, [currentTime, clipPosition, selectedClip]);


  const handleSplitAtPlayhead = useCallback(() => {
    if (!selectedClip || timeInClip === null || timeInClip <= 0) return;
    splitClip(selectedClip.id, timeInClip);
  }, [selectedClip, timeInClip, splitClip]);

  const handleDeleteClip = useCallback(() => {
    if (!selectedClip) return;
    if (confirm(`Delete clip "${selectedClip.name}"?`)) {
      removeClipFromTimeline(selectedClip.id);
    }
  }, [selectedClip, removeClipFromTimeline]);

  const handleGoToClip = useCallback(() => {
    if (!selectedClip) return;
    setCurrentTime(clipPosition);
  }, [clipPosition, setCurrentTime]);

  const handleTransformChange = useCallback(
    (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => {
      if (!selectedClip) return;

      // If scale is locked and changing one scale dimension, update both
      if (scaleLocked && (key === 'scaleX' || key === 'scaleY')) {
        updateClipTransform(selectedClip.id, { scaleX: value, scaleY: value });
      } else {
        updateClipTransform(selectedClip.id, { [key]: value });
      }
    },
    [selectedClip, updateClipTransform, scaleLocked]
  );

  const handleDuplicate = useCallback(() => {
    if (!selectedClip) return;
    duplicateClip(selectedClip.id);
  }, [selectedClip, duplicateClip]);

  const handleBlendModeChange = useCallback(
    (mode: BlendMode) => {
      if (!selectedClip) return;
      updateClipBlendMode(selectedClip.id, mode);
    },
    [selectedClip, updateClipBlendMode]
  );

  const handleBlurChange = useCallback(
    (blur: number) => {
      if (!selectedClip) return;
      updateClipEffects(selectedClip.id, { blur });
    },
    [selectedClip, updateClipEffects]
  );

  const handleTransitionTypeChange = useCallback(
    (type: TransitionType) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { type });
    },
    [selectedClip, updateClipTransition]
  );

  const handleTransitionDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipTransition(selectedClip.id, { duration });
    },
    [selectedClip, updateClipTransition]
  );

  // Animation handlers
  const handleAnimationInTypeChange = useCallback(
    (type: AnimationPresetType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type, duration: selectedClip.animation?.in.duration ?? 0.5, easing: selectedClip.animation?.in.easing ?? 'ease-out' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationInDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type: selectedClip.animation?.in.type ?? 'none', duration, easing: selectedClip.animation?.in.easing ?? 'ease-out' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationInEasingChange = useCallback(
    (easing: EasingType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { in: { type: selectedClip.animation?.in.type ?? 'none', duration: selectedClip.animation?.in.duration ?? 0.5, easing } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutTypeChange = useCallback(
    (type: AnimationPresetType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type, duration: selectedClip.animation?.out.duration ?? 0.5, easing: selectedClip.animation?.out.easing ?? 'ease-in' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutDurationChange = useCallback(
    (duration: number) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration, easing: selectedClip.animation?.out.easing ?? 'ease-in' } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleAnimationOutEasingChange = useCallback(
    (easing: EasingType) => {
      if (!selectedClip) return;
      updateClipAnimation(selectedClip.id, { out: { type: selectedClip.animation?.out.type ?? 'none', duration: selectedClip.animation?.out.duration ?? 0.5, easing } });
    },
    [selectedClip, updateClipAnimation]
  );

  const handleResetTransform = useCallback(() => {
    if (!selectedClip) return;

    // Reset clip transform
    updateClipTransform(selectedClip.id, {
      x: 0.5,
      y: 0.5,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    });

    // Also reset overlay-specific position data
    if (selectedClip.overlayType === 'text' && selectedClip.textData) {
      updateTextOverlayData(selectedClip.id, {
        x: 0.5,
        y: 0.5,
      });
    } else if (selectedClip.overlayType === 'shape' && selectedClip.shapeData) {
      updateShapeOverlayData(selectedClip.id, {
        x: 0.5,
        y: 0.5,
        width: 0.2,
        height: 0.2,
        rotation: 0,
      });
    }
  }, [selectedClip, updateClipTransform, updateTextOverlayData, updateShapeOverlayData]);

  const handleFitToCanvas = useCallback(() => {
    if (!selectedClip || !sourceVideo) return;
    const fitScale = fitToCanvasScale(resolution, sourceVideo);
    updateClipTransform(selectedClip.id, { scaleX: fitScale, scaleY: fitScale });
  }, [selectedClip, sourceVideo, resolution, updateClipTransform]);

  // Text overlay handlers
  const handleTextDataChange = useCallback(
    (updates: Partial<TextOverlayData>) => {
      if (!selectedClip) return;
      updateTextOverlayData(selectedClip.id, updates);
    },
    [selectedClip, updateTextOverlayData]
  );

  // Shape overlay handlers
  const handleShapeDataChange = useCallback(
    (updates: Partial<ShapeOverlayData>) => {
      if (!selectedClip) return;
      updateShapeOverlayData(selectedClip.id, updates);
    },
    [selectedClip, updateShapeOverlayData]
  );

  // Add overlay handlers
  const handleAddText = useCallback(() => {
    addTextOverlayClip();
  }, [addTextOverlayClip]);

  const handleAddShape = useCallback((type: ShapeType) => {
    addShapeOverlayClip({ type });
  }, [addShapeOverlayClip]);

  // No clip selected - show add overlay options
  if (!selectedClip) {
    return <ClipEditorEmptyState onAddText={handleAddText} onAddShape={handleAddShape} />;
  }

  return (
    <div className={styles.container}>
      <ClipEditorHeader
        clipTypeLabel={clipTypeLabel}
        name={selectedClip.name}
        duration={selectedClip.duration}
        position={clipPosition}
        track={track}
        onDelete={handleDeleteClip}
      />

      {/* Text Overlay Content Section */}
      {isTextOverlay && selectedClip.textData && (
        <TextContentSection textData={selectedClip.textData} onChange={handleTextDataChange} />
      )}

      {/* Shape Overlay Content Section */}
      {isShapeOverlay && selectedClip.shapeData && (
        <ShapeSection shapeData={selectedClip.shapeData} onChange={handleShapeDataChange} />
      )}


      {/* Transform section - for all visual clips */}
      {!isAudio && (
        <CollapsibleSection
          title="Transform"
          headerRight={
            <button className={styles.resetButton} onClick={(e) => { e.stopPropagation(); handleResetTransform(); }}>
              Reset
            </button>
          }
        >
          <div className={styles.transformControls}>
            <div className={styles.transformRow}>
              <label>Pos X</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={overlayPositionValue(selectedClip, 'x', isOverlay)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (isTextOverlay && selectedClip.textData) {
                    handleTextDataChange({ x: val });
                  } else if (isShapeOverlay && selectedClip.shapeData) {
                    handleShapeDataChange({ x: val });
                  } else {
                    handleTransformChange('x', val);
                  }
                }}
              />
              <span>{Math.round(overlayPositionValue(selectedClip, 'x', isOverlay) * 100)}%</span>
            </div>

            <div className={styles.transformRow}>
              <label>Pos Y</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={overlayPositionValue(selectedClip, 'y', isOverlay)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (isTextOverlay && selectedClip.textData) {
                    handleTextDataChange({ y: val });
                  } else if (isShapeOverlay && selectedClip.shapeData) {
                    handleShapeDataChange({ y: val });
                  } else {
                    handleTransformChange('y', val);
                  }
                }}
              />
              <span>{Math.round(overlayPositionValue(selectedClip, 'y', isOverlay) * 100)}%</span>
            </div>

            {/* Scale controls - only for media clips */}
            {!isOverlay && (
              <>
                <div className={styles.scaleHeader}>
                  <span className={styles.scaleLabel}>Scale</span>
                  <button
                    className={`${styles.lockButton} ${scaleLocked ? styles.locked : ''}`}
                    onClick={() => setScaleLocked(!scaleLocked)}
                    title={scaleLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                  >
                    {scaleLocked ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 019.9-1" />
                      </svg>
                    )}
                  </button>
                </div>

                {scaleLocked ? (
                  <div className={styles.transformRow}>
                    <label>Scale</label>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.01}
                      value={selectedClip.transform.scaleX}
                      onChange={(e) => handleTransformChange('scaleX', parseFloat(e.target.value))}
                    />
                    <span>{Math.round(selectedClip.transform.scaleX * 100)}%</span>
                  </div>
                ) : (
                  <>
                    <div className={styles.transformRow}>
                      <label>Scale X</label>
                      <input
                        type="range"
                        min={0.1}
                        max={2}
                        step={0.01}
                        value={selectedClip.transform.scaleX}
                        onChange={(e) => handleTransformChange('scaleX', parseFloat(e.target.value))}
                      />
                      <span>{Math.round(selectedClip.transform.scaleX * 100)}%</span>
                    </div>

                    <div className={styles.transformRow}>
                      <label>Scale Y</label>
                      <input
                        type="range"
                        min={0.1}
                        max={2}
                        step={0.01}
                        value={selectedClip.transform.scaleY}
                        onChange={(e) => handleTransformChange('scaleY', parseFloat(e.target.value))}
                      />
                      <span>{Math.round(selectedClip.transform.scaleY * 100)}%</span>
                    </div>
                  </>
                )}

                {sourceVideo && (
                  <>
                    <button
                      className={styles.fitToCanvasButton}
                      onClick={handleFitToCanvas}
                      title="Scale clip to fit within the project canvas"
                    >
                      Fit to Canvas
                    </button>
                    <button
                      className={styles.fitToCanvasButton}
                      onClick={() => updateClipTransform(selectedClip!.id, { ...DEFAULT_TRANSFORM })}
                      title="Reset position, scale, and rotation to defaults"
                    >
                      Reset
                    </button>
                  </>
                )}
              </>
            )}

            <div className={styles.transformRow}>
              <label>Opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedClip.transform.opacity}
                onChange={(e) => handleTransformChange('opacity', parseFloat(e.target.value))}
              />
              <span>{Math.round(selectedClip.transform.opacity * 100)}%</span>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Blend Mode section - for visual clips */}
      {!isAudio && !isOverlay && (
        <CollapsibleSection title="Blend Mode" defaultOpen={false}>
          <select
            className={styles.select}
            value={selectedClip.blendMode}
            onChange={(e) => handleBlendModeChange(e.target.value as BlendMode)}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </CollapsibleSection>
      )}

      {/* Effects section - for visual clips */}
      {!isAudio && !isOverlay && (
        <CollapsibleSection title="Effects" defaultOpen={false}>
          <div className={styles.transformControls}>
            <div className={styles.transformRow}>
              <label>Blur</label>
              <input
                type="range"
                min={0}
                max={50}
                step={0.5}
                value={selectedClip.effects?.blur ?? 0}
                onChange={(e) => handleBlurChange(parseFloat(e.target.value))}
              />
              <span>{(selectedClip.effects?.blur ?? 0).toFixed(1)}px</span>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Animation section - for visual clips */}
      {!isAudio && (
        <CollapsibleSection
          title="Animation"
          badge={hasAnimation(selectedClip.animation) && (
            <span className={styles.animationBadge}>Active</span>
          )}
        >
          {/* Animate In */}
          <div className={styles.animationGroup}>
            <span className={styles.animationLabel}>Animate In</span>
            <div className={styles.animationRow}>
              <select
                className={styles.select}
                value={selectedClip.animation?.in.type ?? 'none'}
                onChange={(e) => handleAnimationInTypeChange(e.target.value as AnimationPresetType)}
              >
                {ANIMATION_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedClip.animation?.in.type !== 'none' && selectedClip.animation?.in.type && (
              <>
                <div className={styles.transformRow}>
                  <label>Duration</label>
                  <input
                    type="range"
                    min={0.1}
                    max={maxPresetDuration(selectedClip.duration)}
                    step={0.1}
                    value={selectedClip.animation?.in.duration ?? 0.5}
                    onChange={(e) => handleAnimationInDurationChange(parseFloat(e.target.value))}
                  />
                  <span>{(selectedClip.animation?.in.duration ?? 0.5).toFixed(1)}s</span>
                </div>
                <div className={styles.transformRow}>
                  <label>Easing</label>
                  <select
                    className={styles.selectSmall}
                    value={selectedClip.animation?.in.easing ?? 'ease-out'}
                    onChange={(e) => handleAnimationInEasingChange(e.target.value as EasingType)}
                  >
                    {EASING_TYPES.map((easing) => (
                      <option key={easing.value} value={easing.value}>
                        {easing.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Animate Out */}
          <div className={styles.animationGroup}>
            <span className={styles.animationLabel}>Animate Out</span>
            <div className={styles.animationRow}>
              <select
                className={styles.select}
                value={selectedClip.animation?.out.type ?? 'none'}
                onChange={(e) => handleAnimationOutTypeChange(e.target.value as AnimationPresetType)}
              >
                {ANIMATION_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedClip.animation?.out.type !== 'none' && selectedClip.animation?.out.type && (
              <>
                <div className={styles.transformRow}>
                  <label>Duration</label>
                  <input
                    type="range"
                    min={0.1}
                    max={maxPresetDuration(selectedClip.duration)}
                    step={0.1}
                    value={selectedClip.animation?.out.duration ?? 0.5}
                    onChange={(e) => handleAnimationOutDurationChange(parseFloat(e.target.value))}
                  />
                  <span>{(selectedClip.animation?.out.duration ?? 0.5).toFixed(1)}s</span>
                </div>
                <div className={styles.transformRow}>
                  <label>Easing</label>
                  <select
                    className={styles.selectSmall}
                    value={selectedClip.animation?.out.easing ?? 'ease-in'}
                    onChange={(e) => handleAnimationOutEasingChange(e.target.value as EasingType)}
                  >
                    {EASING_TYPES.map((easing) => (
                      <option key={easing.value} value={easing.value}>
                        {easing.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Keyframe Editor Button */}
          <button
            className={`${styles.keyframeButton} ${keyframePanelOpen ? styles.active : ''}`}
            onClick={() => setKeyframePanelOpen(!keyframePanelOpen)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L15 9L22 9L17 14L19 22L12 17L5 22L7 14L2 9L9 9Z" />
            </svg>
            {keyframePanelOpen ? 'Close Keyframe Editor' : 'Open Keyframe Editor'}
            {hasAnimation(selectedClip.animation) && !keyframePanelOpen && (
              <span className={styles.keyframeBadge}>
                {keyframeCount(selectedClip.animation)}
              </span>
            )}
          </button>
        </CollapsibleSection>
      )}

      {/* Transition section - for all clips */}
      {!isOverlay && (
        <CollapsibleSection title="Transition Out" defaultOpen={false}>
          <div className={styles.transitionControls}>
            <div className={styles.transitionRow}>
              <label>Type</label>
              <select
                className={styles.select}
                value={selectedClip.transition?.type ?? 'none'}
                onChange={(e) => handleTransitionTypeChange(e.target.value as TransitionType)}
              >
                {TRANSITION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedClip.transition?.type !== 'none' && (
              <div className={styles.transformRow}>
                <label>Duration</label>
                <input
                  type="range"
                  min={0.1}
                  max={maxPresetDuration(selectedClip.duration)}
                  step={0.1}
                  value={selectedClip.transition?.duration ?? 0.5}
                  onChange={(e) => handleTransitionDurationChange(parseFloat(e.target.value))}
                />
                <span>{(selectedClip.transition?.duration ?? 0.5).toFixed(1)}s</span>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Actions">
        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            onClick={handleGoToClip}
            title="Go to clip start"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Go to
          </button>

          <button
            className={styles.actionButton}
            onClick={handleDuplicate}
            title="Duplicate clip (Ctrl+D)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Duplicate
          </button>

          {(isVideo || isAudio) && (
            <button
              className={styles.actionButton}
              onClick={handleSplitAtPlayhead}
              disabled={timeInClip === null || timeInClip <= 0}
              title="Split clip at playhead position"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="2" x2="12" y2="22" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
              Split
            </button>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
