import type { Clip, TextOverlayData, ShapeOverlayData } from '../../store/types';
import { overlayPositionValue } from './clipEditorModel';
import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface TransformSectionProps {
  /** The selected clip, read for its transform and any overlay position data. */
  clip: Clip;
  /** Whether the clip is a text or shape overlay: overlays have no scale controls. */
  isOverlay: boolean;
  /** Whether the clip is a text overlay, which routes Pos X/Y to its text data. */
  isTextOverlay: boolean;
  /** Whether the clip is a shape overlay, which routes Pos X/Y to its shape data. */
  isShapeOverlay: boolean;
  /** Whether scale X and Y move together, shown as the closed padlock. */
  scaleLocked: boolean;
  /** Lock or unlock the aspect ratio. */
  onScaleLockedChange: (locked: boolean) => void;
  /** Whether the clip has a source video, which is what the two scale buttons act on. */
  hasSourceVideo: boolean;
  /** Change one number on the clip transform. Honouring the lock is the caller's job. */
  onTransformChange: (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'opacity', value: number) => void;
  /** Apply a partial change to a text overlay's own data. */
  onTextDataChange: (updates: Partial<TextOverlayData>) => void;
  /** Apply a partial change to a shape overlay's own data. */
  onShapeDataChange: (updates: Partial<ShapeOverlayData>) => void;
  /** Scale the clip to fit inside the project canvas. */
  onFitToCanvas: () => void;
  /** Put the whole transform back to `DEFAULT_TRANSFORM` (the scale block's Reset). */
  onResetToDefaults: () => void;
  /** Reset position, scale and opacity, and any overlay position data (the header's Reset). */
  onReset: () => void;
  /**
   * Undo-coalescing listeners for every slider in the section (ESCSUITE-75):
   * one drag of position, scale or opacity is one undo entry rather than one per
   * `input` event. They go on all six because the section shows at most four of
   * them at a time and the rule is the same for each.
   */
  sliderGesture: SliderGestureHandlers;
}

/**
 * The "Transform" section of the clip inspector: position, then — for media
 * clips only — scale with its aspect-ratio lock and the two canvas buttons,
 * and opacity last.
 *
 * There are deliberately two Reset buttons with different jobs. The one in the
 * section header (distinguishable by having no `title`) resets position, scale
 * and opacity *and* an overlay's own coordinates; the one beside Fit to Canvas
 * writes `DEFAULT_TRANSFORM` wholesale, rotation included, and only exists when
 * there is a source video.
 *
 * Pos X/Y are asymmetric on purpose: the displayed value falls back to the clip
 * transform whenever the overlay carries no data of its own, while the write
 * path checks the overlay type first. Both are preserved as they were.
 */
export function TransformSection({
  clip,
  isOverlay,
  isTextOverlay,
  isShapeOverlay,
  scaleLocked,
  onScaleLockedChange,
  hasSourceVideo,
  onTransformChange,
  onTextDataChange,
  onShapeDataChange,
  onFitToCanvas,
  onResetToDefaults,
  onReset,
  sliderGesture,
}: TransformSectionProps) {
  return (
    <CollapsibleSection
      title="Transform"
      headerRight={
        <button className={styles.resetButton} onClick={(e) => { e.stopPropagation(); onReset(); }}>
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
            value={overlayPositionValue(clip, 'x', isOverlay)}
            {...sliderGesture}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isTextOverlay && clip.textData) {
                onTextDataChange({ x: val });
              } else if (isShapeOverlay && clip.shapeData) {
                onShapeDataChange({ x: val });
              } else {
                onTransformChange('x', val);
              }
            }}
          />
          <span>{Math.round(overlayPositionValue(clip, 'x', isOverlay) * 100)}%</span>
        </div>

        <div className={styles.transformRow}>
          <label>Pos Y</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={overlayPositionValue(clip, 'y', isOverlay)}
            {...sliderGesture}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isTextOverlay && clip.textData) {
                onTextDataChange({ y: val });
              } else if (isShapeOverlay && clip.shapeData) {
                onShapeDataChange({ y: val });
              } else {
                onTransformChange('y', val);
              }
            }}
          />
          <span>{Math.round(overlayPositionValue(clip, 'y', isOverlay) * 100)}%</span>
        </div>

        {/* Scale controls - only for media clips */}
        {!isOverlay && (
          <>
            <div className={styles.scaleHeader}>
              <span className={styles.scaleLabel}>Scale</span>
              <button
                className={`${styles.lockButton} ${scaleLocked ? styles.locked : ''}`}
                onClick={() => onScaleLockedChange(!scaleLocked)}
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
                  value={clip.transform.scaleX}
                  {...sliderGesture}
                  onChange={(e) => onTransformChange('scaleX', parseFloat(e.target.value))}
                />
                <span>{Math.round(clip.transform.scaleX * 100)}%</span>
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
                    value={clip.transform.scaleX}
                    {...sliderGesture}
                    onChange={(e) => onTransformChange('scaleX', parseFloat(e.target.value))}
                  />
                  <span>{Math.round(clip.transform.scaleX * 100)}%</span>
                </div>

                <div className={styles.transformRow}>
                  <label>Scale Y</label>
                  <input
                    type="range"
                    min={0.1}
                    max={2}
                    step={0.01}
                    value={clip.transform.scaleY}
                    {...sliderGesture}
                    onChange={(e) => onTransformChange('scaleY', parseFloat(e.target.value))}
                  />
                  <span>{Math.round(clip.transform.scaleY * 100)}%</span>
                </div>
              </>
            )}

            {hasSourceVideo && (
              <>
                <button
                  className={styles.fitToCanvasButton}
                  onClick={onFitToCanvas}
                  title="Scale clip to fit within the project canvas"
                >
                  Fit to Canvas
                </button>
                <button
                  className={styles.fitToCanvasButton}
                  onClick={onResetToDefaults}
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
            value={clip.transform.opacity}
            {...sliderGesture}
            onChange={(e) => onTransformChange('opacity', parseFloat(e.target.value))}
          />
          <span>{Math.round(clip.transform.opacity * 100)}%</span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
