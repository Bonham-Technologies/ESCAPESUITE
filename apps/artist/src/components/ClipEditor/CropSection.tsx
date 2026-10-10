import { useId } from 'react';
import type { ClipCrop } from '../../store/types';
import { MAX_CROP_INSET, cropForAspect } from '../../core/clipCrop';
import { CROP_ASPECT_PRESETS } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface CropSectionProps {
  /** The clip's crop, or undefined for none. */
  crop: ClipCrop | undefined;
  /**
   * The source frame's own pixel dimensions.
   *
   * The insets are fractions of it, which is what lets the aspect presets be
   * computed here: this component is the only place that has both the frame's
   * shape and the clip's current crop in hand, so a preset becomes an ordinary
   * `onCropChange` call rather than a second handler in the hook.
   */
  sourceWidth: number;
  sourceHeight: number;
  /** The crop the user asked for. Deciding what gets stored is the caller's job. */
  onCropChange: (crop: ClipCrop) => void;
  /** Whether the preview's crop mode is open on this clip (ESCSUITE-157). */
  cropOnCanvas: boolean;
  /** Open or close it. Live on a locked track: crop mode is a view, not an edit. */
  onCropOnCanvasToggle: () => void;
  /**
   * Undo-coalescing listeners for the four sliders (ESCSUITE-87): one drag is
   * one undo entry rather than one per `input` event. Not on the number fields
   * or the preset buttons — those are single changes and keep their own entry.
   */
  sliderGesture: SliderGestureHandlers;
  /** Freeze the section's controls — the clip's track is locked (ESCSUITE-84). */
  disabled?: boolean;
}

/** The four edges, in the order they are shown. */
const EDGES = [
  { key: 'left', label: 'Left' },
  { key: 'top', label: 'Top' },
  { key: 'right', label: 'Right' },
  { key: 'bottom', label: 'Bottom' },
] as const;

/** No crop at all, as the four insets that say so. */
const NO_CROP: ClipCrop = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * Why "Crop on canvas" is refused on a clip with no source frame behind it.
 *
 * `sourceWidth` is `sourceVideo?.width ?? 0`: a zero means the clip's source has
 * left the media library, and the preview's crop mode (`cropTarget`) refuses such
 * a clip and draws nothing. Latching the mode would leave a pressed toggle with
 * an empty canvas behind it, so the toggle refuses itself instead and says why.
 */
const NO_SOURCE_REASON = "This clip's source is no longer in the media library";

/** The percentage the user sees for a stored fraction. */
function percentOf(inset: number): number {
  return Math.round(inset * 100);
}

/**
 * The "Crop" section of the clip inspector (ESCSUITE-6): which rectangle of its
 * source frame the clip shows.
 *
 * Four rows of slider + number field, because an inset is a number worth typing
 * as well as dragging, and five aspect-preset buttons that recompute all four at
 * once. Media clips only: `ClipEditor` gates it exactly as it gates "Mask &
 * Stroke", because an overlay has no source frame for a fraction to be a
 * fraction of.
 *
 * It reports what the user did and normalises nothing. 90% off both sides is
 * something a user can express; refusing it is `useClipEditorActions`' job, so
 * the store only ever holds canonical shapes.
 *
 * `None` and the header `Reset` make the **same** write — four zeroes — because
 * "no crop" has one meaning and `normaliseCrop` turns that into
 * `crop: undefined`. Two affordances for it because the spec asks for both: the
 * preset row is where a user comparing ratios looks, and the header Reset is
 * where every other section of this panel puts the same idea.
 */
export function CropSection({
  crop,
  sourceWidth,
  sourceHeight,
  onCropChange,
  cropOnCanvas,
  onCropOnCanvasToggle,
  sliderGesture,
  disabled,
}: CropSectionProps) {
  // ESCSUITE-89: one id for the section, one label wired to each slider, and an
  // explicit name on each number field — eight value controls, eight distinct
  // names, which `ClipEditor.a11y.test.tsx` enforces.
  const id = useId();
  const current = crop ?? NO_CROP;
  const noSource = sourceWidth <= 0;

  const reportPercent = (key: keyof ClipCrop, percent: number) => {
    onCropChange({ ...current, [key]: percent / 100 });
  };

  return (
    <CollapsibleSection
      title="Crop"
      defaultOpen={false}
      disabled={disabled}
      headerRight={
        <>
          {/* Not disabled by the track's lock: crop mode shows the user what is
              being cropped away, which is reading. The eight handles are what go
              inert on a locked track (ESCSUITE-157), and the panel header already
              says why. It sits in `headerRight` and so outside the section's
              <fieldset disabled> for the same reason. The one thing that DOES
              disable it is having no source frame to crop — see
              {@link NO_SOURCE_REASON}. Its pressed state is a visual one too, via
              `.resetButton[aria-pressed='true']`, the way every other
              `aria-pressed` control in this panel pairs the attribute with a
              look. */}
          <button
            className={styles.resetButton}
            aria-pressed={cropOnCanvas}
            disabled={noSource}
            title={noSource ? NO_SOURCE_REASON : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onCropOnCanvasToggle();
            }}
          >
            Crop on canvas
          </button>
          <button
            className={styles.resetButton}
            disabled={disabled}
            aria-label="Reset crop"
            onClick={(e) => {
              e.stopPropagation();
              onCropChange(NO_CROP);
            }}
          >
            Reset
          </button>
        </>
      }
    >
      <div className={styles.transformControls}>
        {EDGES.map(({ key, label }) => (
          <div className={styles.transformRow} key={key}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <input
              id={`${id}-${key}`}
              type="range"
              min={0}
              max={percentOf(MAX_CROP_INSET)}
              step={1}
              value={percentOf(current[key])}
              {...sliderGesture}
              onChange={(e) => reportPercent(key, Number(e.target.value))}
            />
            <input
              type="number"
              className={styles.numberInput}
              min={0}
              max={percentOf(MAX_CROP_INSET)}
              step={1}
              value={percentOf(current[key])}
              aria-label={`${label} crop percent`}
              onChange={(e) => reportPercent(key, Number(e.target.value))}
            />
          </div>
        ))}

        <div className={styles.cropPresets}>
          {CROP_ASPECT_PRESETS.map(({ label, aspect }) => (
            <button
              key={label}
              className={styles.styleButton}
              onClick={() =>
                onCropChange(
                  aspect === null ? NO_CROP : cropForAspect(sourceWidth, sourceHeight, aspect, crop)
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  );
}
