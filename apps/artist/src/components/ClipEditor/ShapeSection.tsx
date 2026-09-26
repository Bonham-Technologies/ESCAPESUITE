import type { ShapeOverlayData, ShapeType } from '../../store/types';
import { hasVisibleFill } from '../../core/canvasRenderer';
import { withFillRgb, toggleFill, fillAlphaPercent, withFillAlphaPercent } from './clipColorValues';
import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface ShapeSectionProps {
  /** The selected shape overlay's geometry and styling. */
  shapeData: ShapeOverlayData;
  /** Apply a partial change to that data. */
  onChange: (updates: Partial<ShapeOverlayData>) => void;
  /**
   * Undo-coalescing listeners for the section's seven sliders (ESCSUITE-75):
   * one drag of size, rotation, blur, stroke width or fill opacity is one undo
   * entry rather than one per `input` event.
   *
   * Not on the two colour swatches, for the reason given in `MaskSection`: the
   * OS picker also reports continuously, but it opens on the press and reports
   * after the release, so a pointer gesture does not bound that interaction.
   */
  sliderGesture: SliderGestureHandlers;
}

/**
 * The "Shape" section of the clip inspector: which shape it is, then either
 * the blur region's single amount slider or the fill/stroke controls, and in
 * both cases the size, rotation and blur sliders underneath.
 *
 * A shape with no fill is a fill colour whose alpha is `00`, so the fill
 * colour picker, the no-fill toggle and the fill-opacity row all read and
 * rewrite the same eight-digit hex string through `clipColorValues`.
 */
export function ShapeSection({ shapeData, onChange, sliderGesture }: ShapeSectionProps) {
  return (
    <CollapsibleSection title="Shape">
      <select
        className={styles.select}
        value={shapeData.type}
        onChange={(e) => onChange({ type: e.target.value as ShapeType })}
      >
        <option value="rectangle">Rectangle</option>
        <option value="ellipse">Ellipse</option>
        <option value="line">Line</option>
        <option value="arrow">Arrow</option>
        <option value="blur">Blur Region</option>
      </select>

      {/* Blur type shows simplified controls */}
      {shapeData.type === 'blur' ? (
        <>
          <div className={styles.transformRow}>
            <label>Blur Amount</label>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={shapeData.blurAmount ?? 10}
              {...sliderGesture}
              onChange={(e) => onChange({ blurAmount: parseInt(e.target.value) })}
            />
            <span>{shapeData.blurAmount ?? 10}px</span>
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
                value={shapeData.fillColor.substring(0, 7)}
                onChange={(e) => {
                  // Preserve existing alpha when changing color
                  const fillColor = shapeData.fillColor || '#000000ff';
                  onChange({ fillColor: withFillRgb(fillColor, e.target.value) });
                }}
                disabled={!hasVisibleFill(shapeData.fillColor || '#000000ff')}
              />
              <button
                className={`${styles.noFillButton} ${hasVisibleFill(shapeData.fillColor || '#000000ff') ? '' : styles.active}`}
                onClick={() => {
                  const fillColor = shapeData.fillColor || '#000000ff';
                  onChange({ fillColor: toggleFill(fillColor) });
                }}
                title={hasVisibleFill(shapeData.fillColor || '#000000ff') ? 'No fill (transparent)' : 'Enable fill'}
              >
                {hasVisibleFill(shapeData.fillColor || '#000000ff') ? '⊗' : '⊘'}
              </button>
            </div>
            <div className={styles.colorInput}>
              <span>Stroke</span>
              <input
                type="color"
                value={shapeData.strokeColor}
                onChange={(e) => onChange({ strokeColor: e.target.value })}
              />
            </div>
          </div>

          {hasVisibleFill(shapeData.fillColor || '#000000ff') && (
            <div className={styles.transformRow}>
              <label>Fill opacity</label>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={fillAlphaPercent(shapeData.fillColor || '#000000ff')}
                {...sliderGesture}
                onChange={(e) => {
                  const fillColor = shapeData.fillColor || '#000000ff';
                  onChange({ fillColor: withFillAlphaPercent(fillColor, parseInt(e.target.value)) });
                }}
              />
              <span>{fillAlphaPercent(shapeData.fillColor || '#000000ff')}%</span>
            </div>
          )}

          <div className={styles.transformRow}>
            <label>Stroke</label>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={shapeData.strokeWidth}
              {...sliderGesture}
              onChange={(e) => onChange({ strokeWidth: parseInt(e.target.value) })}
            />
            <span>{shapeData.strokeWidth}px</span>
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
          value={shapeData.width}
          {...sliderGesture}
          onChange={(e) => onChange({ width: parseFloat(e.target.value) })}
        />
        <span>{Math.round(shapeData.width * 100)}%</span>
      </div>

      <div className={styles.transformRow}>
        <label>Size H</label>
        <input
          type="range"
          min={0.01}
          max={1}
          step={0.01}
          value={shapeData.height}
          {...sliderGesture}
          onChange={(e) => onChange({ height: parseFloat(e.target.value) })}
        />
        <span>{Math.round(shapeData.height * 100)}%</span>
      </div>

      <div className={styles.transformRow}>
        <label>Rotation</label>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={shapeData.rotation}
          {...sliderGesture}
          onChange={(e) => onChange({ rotation: parseInt(e.target.value) })}
        />
        <span>{shapeData.rotation}°</span>
      </div>

      <div className={styles.transformRow}>
        <label>Blur</label>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={shapeData.blurAmount ?? 0}
          {...sliderGesture}
          onChange={(e) => onChange({ blurAmount: parseInt(e.target.value) })}
        />
        <span>{shapeData.blurAmount ?? 0}px</span>
      </div>
      <p className={styles.hint}>Blur the region underneath (set fill to transparent)</p>
    </CollapsibleSection>
  );
}
