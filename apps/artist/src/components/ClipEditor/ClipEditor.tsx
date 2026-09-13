import { useCallback, useMemo } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { DEFAULT_TRANSFORM } from '../../store/types';
import type { BlendMode, TransitionType, ShapeType, TextOverlayData, ShapeOverlayData, AnimationPresetType, EasingType } from '../../store/types';
import { describeClip, relativeTimeInClip, fitToCanvasScale } from './clipEditorModel';
import { ClipEditorEmptyState } from './ClipEditorEmptyState';
import { ClipEditorHeader } from './ClipEditorHeader';
import { TextContentSection } from './TextContentSection';
import { ShapeSection } from './ShapeSection';
import { TransformSection } from './TransformSection';
import { BlendModeSection } from './BlendModeSection';
import { EffectsSection } from './EffectsSection';
import { AnimationSection } from './AnimationSection';
import { TransitionSection } from './TransitionSection';
import { ActionsSection } from './ActionsSection';
import styles from './ClipEditor.module.css';

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
        <TransformSection
          clip={selectedClip}
          isOverlay={isOverlay}
          isTextOverlay={isTextOverlay}
          isShapeOverlay={isShapeOverlay}
          scaleLocked={scaleLocked}
          onScaleLockedChange={setScaleLocked}
          hasSourceVideo={!!sourceVideo}
          onTransformChange={handleTransformChange}
          onTextDataChange={handleTextDataChange}
          onShapeDataChange={handleShapeDataChange}
          onFitToCanvas={handleFitToCanvas}
          onResetToDefaults={() => updateClipTransform(selectedClip!.id, { ...DEFAULT_TRANSFORM })}
          onReset={handleResetTransform}
        />
      )}

      {/* Blend Mode section - for visual clips */}
      {!isAudio && !isOverlay && (
        <BlendModeSection value={selectedClip.blendMode} onChange={handleBlendModeChange} />
      )}

      {/* Effects section - for visual clips */}
      {!isAudio && !isOverlay && (
        <EffectsSection blur={selectedClip.effects?.blur ?? 0} onBlurChange={handleBlurChange} />
      )}

      {/* Animation section - for visual clips */}
      {!isAudio && (
        <AnimationSection
          animation={selectedClip.animation}
          clipDuration={selectedClip.duration}
          keyframePanelOpen={keyframePanelOpen}
          onKeyframePanelToggle={() => setKeyframePanelOpen(!keyframePanelOpen)}
          onInTypeChange={handleAnimationInTypeChange}
          onInDurationChange={handleAnimationInDurationChange}
          onInEasingChange={handleAnimationInEasingChange}
          onOutTypeChange={handleAnimationOutTypeChange}
          onOutDurationChange={handleAnimationOutDurationChange}
          onOutEasingChange={handleAnimationOutEasingChange}
        />
      )}

      {/* Transition section - for all clips */}
      {!isOverlay && (
        <TransitionSection
          transition={selectedClip.transition}
          clipDuration={selectedClip.duration}
          onTypeChange={handleTransitionTypeChange}
          onDurationChange={handleTransitionDurationChange}
        />
      )}

      <ActionsSection
        isVideo={isVideo}
        isAudio={isAudio}
        timeInClip={timeInClip}
        onGoToClip={handleGoToClip}
        onDuplicate={handleDuplicate}
        onSplit={handleSplitAtPlayhead}
      />
    </div>
  );
}
