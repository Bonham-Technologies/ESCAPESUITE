import { useId } from 'react';
import type { ClipAnimation, AnimationPresetType, EasingType } from '../../store/types';
import { hasAnimation } from '../../utils/animation';
import { maxPresetDuration, keyframeCount } from './clipEditorModel';
import { ANIMATION_PRESETS, EASING_TYPES } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface AnimationSectionProps {
  /** The clip's animation, or undefined for a clip that has never been animated. */
  animation: ClipAnimation | undefined;
  /** The clip's length in seconds, which caps both duration sliders. */
  clipDuration: number;
  /** Whether the keyframe panel is open, which flips the button's label and style. */
  keyframePanelOpen: boolean;
  /** Open or close the keyframe panel. */
  onKeyframePanelToggle: () => void;
  /** Choose the Animate In preset. */
  onInTypeChange: (type: AnimationPresetType) => void;
  /** Set how long Animate In runs, in seconds. */
  onInDurationChange: (duration: number) => void;
  /** Choose the Animate In easing curve. */
  onInEasingChange: (easing: EasingType) => void;
  /** Choose the Animate Out preset. */
  onOutTypeChange: (type: AnimationPresetType) => void;
  /** Set how long Animate Out runs, in seconds. */
  onOutDurationChange: (duration: number) => void;
  /** Choose the Animate Out easing curve. */
  onOutEasingChange: (easing: EasingType) => void;
  /**
   * Undo-coalescing listeners for the two duration sliders (ESCSUITE-77,
   * finishing ESCSUITE-75). Each steps in tenths up to the clip's length, so a
   * full drag is dozens of `onInDurationChange` / `onOutDurationChange` calls
   * and, with these attached, one undo entry. The four selects around them are
   * single changes and take no listeners.
   */
  sliderGesture: SliderGestureHandlers;
  /**
   * Freeze the preset controls — the clip's track is locked (ESCSUITE-84).
   * The keyframe-editor button is not one of them: it opens a panel rather
   * than editing the clip, so it goes through `footer`, outside the fieldset.
   */
  disabled?: boolean;
}

/**
 * The "Animation" section of the clip inspector: an Animate In group, an
 * Animate Out group, and the button that opens the keyframe editor.
 *
 * Each group's duration and easing rows only appear once a preset other than
 * `none` is chosen — the guard tests the type twice (`!== 'none' && type`) so
 * that a clip carrying no animation at all hides them too. The "Active" badge
 * and the count on the keyframe button both come from the animation itself, so
 * a clip with presets or keyframes advertises that while the section is closed.
 */
export function AnimationSection({
  animation,
  clipDuration,
  keyframePanelOpen,
  onKeyframePanelToggle,
  onInTypeChange,
  onInDurationChange,
  onInEasingChange,
  onOutTypeChange,
  onOutDurationChange,
  onOutEasingChange,
  sliderGesture,
  disabled,
}: AnimationSectionProps) {
  /**
   * One id for the section, and the two groups' labels are wired from it
   * (ESCSUITE-89).
   *
   * Each group's heading was a `<span>`; it is the preset dropdown's visible
   * label, so it became a `<label htmlFor>` — same class, same text, same
   * position. The duration and easing rows are the one place in the panel where
   * two controls share a word: both groups call theirs "Duration" and "Easing".
   * They are told apart with `aria-labelledby` pointing at the group heading
   * *and* the row's own label, so each name is built from the text on screen —
   * "Animate In Duration", "Animate Out Easing" — rather than from a string
   * written here that the visible label could drift away from.
   */
  const id = useId();

  return (
    <CollapsibleSection
      title="Animation"
      badge={hasAnimation(animation) && (
        <span className={styles.animationBadge}>Active</span>
      )}
      disabled={disabled}
      footer={
        /* Keyframe Editor Button */
        <button
          className={`${styles.keyframeButton} ${keyframePanelOpen ? styles.active : ''}`}
          onClick={onKeyframePanelToggle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L15 9L22 9L17 14L19 22L12 17L5 22L7 14L2 9L9 9Z" />
          </svg>
          {keyframePanelOpen ? 'Close Keyframe Editor' : 'Open Keyframe Editor'}
          {hasAnimation(animation) && !keyframePanelOpen && (
            <span className={styles.keyframeBadge}>
              {keyframeCount(animation)}
            </span>
          )}
        </button>
      }
    >
      {/* Animate In */}
      <div className={styles.animationGroup}>
        <label className={styles.animationLabel} id={`${id}-in-group`} htmlFor={`${id}-in-preset`}>Animate In</label>
        <div className={styles.animationRow}>
          <select
            id={`${id}-in-preset`}
            className={styles.select}
            value={animation?.in.type ?? 'none'}
            onChange={(e) => onInTypeChange(e.target.value as AnimationPresetType)}
          >
            {ANIMATION_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        {animation?.in.type !== 'none' && animation?.in.type && (
          <>
            <div className={styles.transformRow}>
              <label id={`${id}-in-duration-label`} htmlFor={`${id}-in-duration`}>Duration</label>
              <input
                id={`${id}-in-duration`}
                aria-labelledby={`${id}-in-group ${id}-in-duration-label`}
                type="range"
                min={0.1}
                max={maxPresetDuration(clipDuration)}
                step={0.1}
                value={animation.in.duration}
                {...sliderGesture}
                onChange={(e) => onInDurationChange(parseFloat(e.target.value))}
              />
              <span>{animation.in.duration.toFixed(1)}s</span>
            </div>
            <div className={styles.transformRow}>
              <label id={`${id}-in-easing-label`} htmlFor={`${id}-in-easing`}>Easing</label>
              <select
                id={`${id}-in-easing`}
                aria-labelledby={`${id}-in-group ${id}-in-easing-label`}
                className={styles.selectSmall}
                value={animation.in.easing}
                onChange={(e) => onInEasingChange(e.target.value as EasingType)}
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
        <label className={styles.animationLabel} id={`${id}-out-group`} htmlFor={`${id}-out-preset`}>Animate Out</label>
        <div className={styles.animationRow}>
          <select
            id={`${id}-out-preset`}
            className={styles.select}
            value={animation?.out.type ?? 'none'}
            onChange={(e) => onOutTypeChange(e.target.value as AnimationPresetType)}
          >
            {ANIMATION_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        {animation?.out.type !== 'none' && animation?.out.type && (
          <>
            <div className={styles.transformRow}>
              <label id={`${id}-out-duration-label`} htmlFor={`${id}-out-duration`}>Duration</label>
              <input
                id={`${id}-out-duration`}
                aria-labelledby={`${id}-out-group ${id}-out-duration-label`}
                type="range"
                min={0.1}
                max={maxPresetDuration(clipDuration)}
                step={0.1}
                value={animation.out.duration}
                {...sliderGesture}
                onChange={(e) => onOutDurationChange(parseFloat(e.target.value))}
              />
              <span>{animation.out.duration.toFixed(1)}s</span>
            </div>
            <div className={styles.transformRow}>
              <label id={`${id}-out-easing-label`} htmlFor={`${id}-out-easing`}>Easing</label>
              <select
                id={`${id}-out-easing`}
                aria-labelledby={`${id}-out-group ${id}-out-easing-label`}
                className={styles.selectSmall}
                value={animation.out.easing}
                onChange={(e) => onOutEasingChange(e.target.value as EasingType)}
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
    </CollapsibleSection>
  );
}
