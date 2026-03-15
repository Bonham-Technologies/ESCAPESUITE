import React, { useCallback, useMemo, useState } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { formatTimecode } from '../../utils/timeUtils';
import type { BlendMode, TransitionType, TextAlign, ShapeType, TextOverlayData, ShapeOverlayData, AnimationPresetType, EasingType } from '../../store/types';
import { hasAnimation } from '../../utils/animation';
import styles from './ClipEditor.module.css';

// Collapsible section component
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
}

function CollapsibleSection({ title, defaultOpen = true, children, badge, headerRight }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`${styles.section} ${styles.collapsible}`}>
      <div className={styles.collapsibleHeader}>
        <button
          className={styles.collapsibleToggle}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <svg
            className={`${styles.collapseIcon} ${isOpen ? styles.open : ''}`}
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5l8 7-8 7V5z" />
          </svg>
          <span className={styles.sectionTitle}>{title}</span>
          {badge}
        </button>
        {headerRight && <div className={styles.headerRightContent}>{headerRight}</div>}
      </div>
      {isOpen && <div className={styles.collapsibleContent}>{children}</div>}
    </div>
  );
}

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
  const isTextOverlay = selectedClip?.overlayType === 'text';
  const isShapeOverlay = selectedClip?.overlayType === 'shape';
  const isOverlay = isTextOverlay || isShapeOverlay;
  const isImage = sourceVideo?.mediaType === 'image';
  const isAudio = sourceVideo?.mediaType === 'audio';
  const isVideo = !isOverlay && !isImage && !isAudio;

  // Clip position is now stored directly on the clip
  const clipPosition = selectedClip?.timelinePosition ?? 0;

  // Calculate if current time is within this clip
  const timeInClip = useMemo(() => {
    if (!selectedClip) return null;
    const relativeTime = currentTime - clipPosition;
    if (relativeTime >= 0 && relativeTime < selectedClip.duration) {
      return relativeTime;
    }
    return null;
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
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <p>Select a clip to edit</p>
          <p className={styles.hint}>Or add an overlay:</p>
        </div>

        <div className={styles.addOverlaySection}>
          <button className={styles.addOverlayButton} onClick={handleAddText}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7V4h16v3" />
              <path d="M12 4v16" />
              <path d="M8 20h8" />
            </svg>
            Add Text
          </button>
          <button className={styles.addOverlayButton} onClick={() => handleAddShape('rectangle')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            Rectangle
          </button>
          <button className={styles.addOverlayButton} onClick={() => handleAddShape('ellipse')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="12" rx="9" ry="7" />
            </svg>
            Ellipse
          </button>
          <button className={styles.addOverlayButton} onClick={() => handleAddShape('arrow')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            Arrow
          </button>
          <button className={styles.addOverlayButton} onClick={() => handleAddShape('blur')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="12" cy="12" r="3" strokeDasharray="2 1" />
            </svg>
            Blur
          </button>
        </div>
      </div>
    );
  }

  // Determine clip type label
  let clipTypeLabel = 'Video Clip';
  if (isTextOverlay) clipTypeLabel = 'Text Overlay';
  else if (isShapeOverlay) clipTypeLabel = 'Shape Overlay';
  else if (isImage) clipTypeLabel = 'Image';
  else if (isAudio) clipTypeLabel = 'Audio';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.clipType}>{clipTypeLabel}</span>
          <h3 className={styles.title}>{selectedClip.name}</h3>
        </div>
        <button
          className={styles.deleteButton}
          onClick={handleDeleteClip}
          title="Delete clip"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.info}>
        <div className={styles.infoRow}>
          <span className={styles.label}>Duration:</span>
          <span className={styles.value}>{formatTimecode(selectedClip.duration)}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.label}>Position:</span>
          <span className={styles.value}>{formatTimecode(clipPosition)}</span>
        </div>
        {track && (
          <div className={styles.infoRow}>
            <span className={styles.label}>Track:</span>
            <span className={styles.value}>{track.name}</span>
          </div>
        )}
      </div>

      {/* Text Overlay Content Section */}
      {isTextOverlay && selectedClip.textData && (
        <CollapsibleSection title="Text Content">
          <textarea
            className={styles.textarea}
            value={selectedClip.textData.text}
            onChange={(e) => handleTextDataChange({ text: e.target.value })}
            rows={2}
            placeholder="Enter text..."
          />

          <div className={styles.row}>
            <select
              className={styles.select}
              value={selectedClip.textData.fontFamily}
              onChange={(e) => handleTextDataChange({ fontFamily: e.target.value })}
            >
              <option value="Arial">Arial</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Georgia">Georgia</option>
              <option value="Verdana">Verdana</option>
              <option value="Courier New">Courier New</option>
              <option value="Impact">Impact</option>
            </select>
            <input
              type="number"
              className={styles.numberInput}
              value={selectedClip.textData.fontSize}
              onChange={(e) => handleTextDataChange({ fontSize: Math.max(8, parseInt(e.target.value) || 48) })}
              min={8}
              max={200}
            />
          </div>

          <div className={styles.row}>
            <button
              className={`${styles.styleButton} ${selectedClip.textData.fontWeight === 'bold' ? styles.active : ''}`}
              onClick={() => handleTextDataChange({ fontWeight: selectedClip.textData!.fontWeight === 'bold' ? 'normal' : 'bold' })}
            >
              B
            </button>
            <button
              className={`${styles.styleButton} ${selectedClip.textData.fontStyle === 'italic' ? styles.active : ''}`}
              onClick={() => handleTextDataChange({ fontStyle: selectedClip.textData!.fontStyle === 'italic' ? 'normal' : 'italic' })}
              style={{ fontStyle: 'italic' }}
            >
              I
            </button>
            <select
              className={styles.select}
              value={selectedClip.textData.textAlign}
              onChange={(e) => handleTextDataChange({ textAlign: e.target.value as TextAlign })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.colorInput}>
              <span>Text</span>
              <input
                type="color"
                value={selectedClip.textData.color}
                onChange={(e) => handleTextDataChange({ color: e.target.value })}
              />
            </div>
            <div className={styles.colorInput}>
              <span>BG</span>
              <input
                type="color"
                value={selectedClip.textData.backgroundColor.substring(0, 7)}
                onChange={(e) => handleTextDataChange({ backgroundColor: e.target.value + 'cc' })}
              />
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Shape Overlay Content Section */}
      {isShapeOverlay && selectedClip.shapeData && (
        <CollapsibleSection title="Shape">
          <select
            className={styles.select}
            value={selectedClip.shapeData.type}
            onChange={(e) => handleShapeDataChange({ type: e.target.value as ShapeType })}
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
            <option value="arrow">Arrow</option>
            <option value="blur">Blur Region</option>
          </select>

          {/* Blur type shows simplified controls */}
          {selectedClip.shapeData.type === 'blur' ? (
            <>
              <div className={styles.transformRow}>
                <label>Blur Amount</label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={selectedClip.shapeData.blurAmount ?? 10}
                  onChange={(e) => handleShapeDataChange({ blurAmount: parseInt(e.target.value) })}
                />
                <span>{selectedClip.shapeData.blurAmount ?? 10}px</span>
              </div>
              <p className={styles.hint}>Blurs the video underneath this region</p>
            </>
          ) : (
            <>
              <div className={styles.row}>
                <div className={styles.colorInput}>
                  <span>Fill</span>
                  <input
                    type="color"
                    value={selectedClip.shapeData.fillColor.substring(0, 7)}
                    onChange={(e) => {
                      // Preserve existing alpha when changing color
                      const fillColor = selectedClip.shapeData?.fillColor || '#000000ff';
                      const currentAlpha = fillColor.length > 7 ? fillColor.substring(7) : 'ff';
                      handleShapeDataChange({ fillColor: e.target.value + currentAlpha });
                    }}
                    disabled={selectedClip.shapeData.fillColor.endsWith('00')}
                  />
                  <button
                    className={`${styles.noFillButton} ${selectedClip.shapeData.fillColor.endsWith('00') ? styles.active : ''}`}
                    onClick={() => {
                      const fillColor = selectedClip.shapeData?.fillColor || '#000000ff';
                      if (fillColor.endsWith('00')) {
                        // Re-enable fill with 50% opacity
                        handleShapeDataChange({ fillColor: fillColor.substring(0, 7) + '80' });
                      } else {
                        // Set to no fill (0% opacity)
                        handleShapeDataChange({ fillColor: fillColor.substring(0, 7) + '00' });
                      }
                    }}
                    title={selectedClip.shapeData.fillColor.endsWith('00') ? 'Enable fill' : 'No fill (transparent)'}
                  >
                    {selectedClip.shapeData.fillColor.endsWith('00') ? '⊘' : '⊗'}
                  </button>
                </div>
                <div className={styles.colorInput}>
                  <span>Stroke</span>
                  <input
                    type="color"
                    value={selectedClip.shapeData.strokeColor}
                    onChange={(e) => handleShapeDataChange({ strokeColor: e.target.value })}
                  />
                </div>
              </div>

              {!selectedClip.shapeData.fillColor.endsWith('00') && (
                <div className={styles.transformRow}>
                  <label>Fill opacity</label>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={Math.round(parseInt((selectedClip.shapeData?.fillColor || '#000000ff').substring(7) || 'ff', 16) / 255 * 100)}
                    onChange={(e) => {
                      const fillColor = selectedClip.shapeData?.fillColor || '#000000ff';
                      const alpha = Math.round(parseInt(e.target.value) / 100 * 255).toString(16).padStart(2, '0');
                      handleShapeDataChange({ fillColor: fillColor.substring(0, 7) + alpha });
                    }}
                  />
                  <span>{Math.round(parseInt((selectedClip.shapeData?.fillColor || '#000000ff').substring(7) || 'ff', 16) / 255 * 100)}%</span>
                </div>
              )}

              <div className={styles.transformRow}>
                <label>Stroke</label>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={selectedClip.shapeData.strokeWidth}
                  onChange={(e) => handleShapeDataChange({ strokeWidth: parseInt(e.target.value) })}
                />
                <span>{selectedClip.shapeData.strokeWidth}px</span>
              </div>
            </>
          )}

          <div className={styles.transformRow}>
            <label>Size W</label>
            <input
              type="range"
              min={0.01}
              max={1}
              step={0.01}
              value={selectedClip.shapeData.width}
              onChange={(e) => handleShapeDataChange({ width: parseFloat(e.target.value) })}
            />
            <span>{Math.round(selectedClip.shapeData.width * 100)}%</span>
          </div>

          <div className={styles.transformRow}>
            <label>Size H</label>
            <input
              type="range"
              min={0.01}
              max={1}
              step={0.01}
              value={selectedClip.shapeData.height}
              onChange={(e) => handleShapeDataChange({ height: parseFloat(e.target.value) })}
            />
            <span>{Math.round(selectedClip.shapeData.height * 100)}%</span>
          </div>

          <div className={styles.transformRow}>
            <label>Rotation</label>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={selectedClip.shapeData.rotation}
              onChange={(e) => handleShapeDataChange({ rotation: parseInt(e.target.value) })}
            />
            <span>{selectedClip.shapeData.rotation}°</span>
          </div>

          <div className={styles.transformRow}>
            <label>Blur</label>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={selectedClip.shapeData.blurAmount ?? 0}
              onChange={(e) => handleShapeDataChange({ blurAmount: parseInt(e.target.value) })}
            />
            <span>{selectedClip.shapeData.blurAmount ?? 0}px</span>
          </div>
          <p className={styles.hint}>Blur the region underneath (set fill to transparent)</p>
        </CollapsibleSection>
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
                value={isOverlay && selectedClip.textData ? selectedClip.textData.x : isOverlay && selectedClip.shapeData ? selectedClip.shapeData.x : selectedClip.transform.x}
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
              <span>{Math.round((isOverlay && selectedClip.textData ? selectedClip.textData.x : isOverlay && selectedClip.shapeData ? selectedClip.shapeData.x : selectedClip.transform.x) * 100)}%</span>
            </div>

            <div className={styles.transformRow}>
              <label>Pos Y</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isOverlay && selectedClip.textData ? selectedClip.textData.y : isOverlay && selectedClip.shapeData ? selectedClip.shapeData.y : selectedClip.transform.y}
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
              <span>{Math.round((isOverlay && selectedClip.textData ? selectedClip.textData.y : isOverlay && selectedClip.shapeData ? selectedClip.shapeData.y : selectedClip.transform.y) * 100)}%</span>
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
                    max={Math.min(2, selectedClip.duration / 2)}
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
                    max={Math.min(2, selectedClip.duration / 2)}
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
                {Object.values(selectedClip.animation?.keyframes || {}).reduce(
                  (count, kfs) => count + (kfs?.length || 0), 0
                )}
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
                  max={Math.min(2, selectedClip.duration / 2)}
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
