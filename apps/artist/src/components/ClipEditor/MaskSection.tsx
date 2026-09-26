import type { ClipMask, ClipMaskKind, ClipStroke } from '../../store/types';
import { DEFAULT_CLIP_MASK_RADIUS, DEFAULT_CLIP_STROKE_COLOR } from '../../store/types';
import { CLIP_MASK_KINDS } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface MaskSectionProps {
  /** The clip's mask, or undefined for none. */
  mask: ClipMask | undefined;
  /** The clip's stroke, or undefined for none. */
  stroke: ClipStroke | undefined;
  /**
   * The project's frame width in pixels.
   *
   * The stroke width is stored as a fraction of it (so the border keeps its
   * proportions when a project's resolution changes), and a fraction is not a
   * number anyone can act on — this is what turns it back into the pixels the
   * user is looking at.
   */
  frameWidth: number;
  /** The mask kind or radius the user chose. Normalising it is the caller's job. */
  onMaskChange: (mask: ClipMask) => void;
  /** The stroke colour or width the user chose. Normalising it is the caller's job. */
  onStrokeChange: (stroke: ClipStroke) => void;
  /**
   * Undo-coalescing listeners for the two sliders (ESCSUITE-75): a radius or
   * width drag is one undo entry rather than one per `input` event.
   *
   * Not on the colour swatch, deliberately — the OS colour picker also reports
   * continuously, but it opens on the press and reports after the release, so
   * a pointer gesture is not what bounds that interaction.
   */
  sliderGesture: SliderGestureHandlers;
  /** Freeze the section's controls — the clip's track is locked (ESCSUITE-84). */
  disabled?: boolean;
}

/** `<input type="color">` accepts this and nothing else. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * What the colour swatch can show for a stored colour string.
 *
 * ESCAPECRAFT's border arrives as `rgba(255, 255, 255, 0.8)`, which the input
 * cannot represent; it shows as white — which it is — and the stored string is
 * replaced only when the user actually picks a colour.
 */
function swatchValue(color: string | undefined): string {
  return color !== undefined && HEX_COLOR.test(color) ? color : DEFAULT_CLIP_STROKE_COLOR;
}

/** The stroke width as the user sees it: pixels at the current project resolution. */
function strokePixels(width: number, frameWidth: number): string {
  // One decimal at most, so 3/1280 of a 720p frame reads "3px" rather than
  // "3.0px" and of a 1080p frame reads "4.5px" rather than "5px".
  return `${Math.round(width * frameWidth * 10) / 10}px`;
}

/**
 * The "Mask & Stroke" section of the clip inspector (ESCSUITE-65): which shape
 * the clip's picture is masked to, and the outline drawn round it.
 *
 * Deliberately **not** called `ShapeSection` — that name is taken by the shape
 * *overlay* editor in this same directory, and a panel with two sections titled
 * "Shape" would be a bug in the UI and an ambiguity in every future grep.
 *
 * Media clips only (decision 3): `ClipEditor` gates it exactly as it gates
 * `BlendModeSection`, because a text or shape overlay has no drawn box either
 * field could mean anything against.
 *
 * This component reports what the user did and normalises nothing. `'none'`
 * with a radius, or a width of 0 with a colour, are things a user can express;
 * turning them into "no mask" and "no stroke" is `useClipEditorActions`' job, so
 * the store only ever holds canonical shapes.
 */
export function MaskSection({
  mask,
  stroke,
  frameWidth,
  onMaskChange,
  onStrokeChange,
  sliderGesture,
  disabled,
}: MaskSectionProps) {
  const kind = mask?.kind ?? 'none';
  const radius = mask?.radius ?? DEFAULT_CLIP_MASK_RADIUS;
  const strokeWidth = stroke?.width ?? 0;
  const strokeColor = stroke?.color ?? DEFAULT_CLIP_STROKE_COLOR;

  return (
    <CollapsibleSection title="Mask & Stroke" defaultOpen={false} disabled={disabled}>
      <select
        className={styles.select}
        value={kind}
        onChange={(e) => onMaskChange({ kind: e.target.value as ClipMaskKind, radius })}
      >
        {CLIP_MASK_KINDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className={styles.transformControls}>
        {kind === 'rounded' && (
          <div className={styles.transformRow}>
            <label>Corner Radius</label>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={radius}
              {...sliderGesture}
              onChange={(e) => onMaskChange({ kind: 'rounded', radius: parseFloat(e.target.value) })}
            />
            {/* A fraction of the clip's shorter side, so a percentage of it is
                the only honest readout. 0.5 is a stadium. */}
            <span>{Math.round(radius * 100)}%</span>
          </div>
        )}

        <div className={styles.transformRow}>
          <label>Stroke Width</label>
          <input
            type="range"
            min={0}
            max={0.02}
            step={0.001}
            value={strokeWidth}
            {...sliderGesture}
            onChange={(e) =>
              onStrokeChange({ color: strokeColor, width: parseFloat(e.target.value) })
            }
          />
          <span>{strokePixels(strokeWidth, frameWidth)}</span>
        </div>

        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Stroke Color</span>
            <input
              type="color"
              value={swatchValue(stroke?.color)}
              disabled={strokeWidth <= 0}
              onChange={(e) => onStrokeChange({ color: e.target.value, width: strokeWidth })}
            />
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
