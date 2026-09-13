import { useClipEditorActions } from './useClipEditorActions';
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
  const {
    selectedClip,
    scaleLocked,
    setScaleLocked,
    sourceVideo,
    track,
    isTextOverlay,
    isShapeOverlay,
    isOverlay,
    isAudio,
    isVideo,
    clipTypeLabel,
    clipPosition,
    timeInClip,
    keyframePanelOpen,
    handleSplitAtPlayhead,
    handleDeleteClip,
    handleGoToClip,
    handleTransformChange,
    handleDuplicate,
    handleBlendModeChange,
    handleBlurChange,
    handleTransitionTypeChange,
    handleTransitionDurationChange,
    handleAnimationInTypeChange,
    handleAnimationInDurationChange,
    handleAnimationInEasingChange,
    handleAnimationOutTypeChange,
    handleAnimationOutDurationChange,
    handleAnimationOutEasingChange,
    handleResetTransform,
    handleFitToCanvas,
    handleTextDataChange,
    handleShapeDataChange,
    handleAddText,
    handleAddShape,
    handleResetToDefaults,
    handleKeyframePanelToggle,
  } = useClipEditorActions();

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
          onResetToDefaults={handleResetToDefaults}
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
          onKeyframePanelToggle={handleKeyframePanelToggle}
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
