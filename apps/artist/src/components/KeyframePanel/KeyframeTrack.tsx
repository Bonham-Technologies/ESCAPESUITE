import { useMemo, useCallback } from 'react';
import { useKeyframeDrag } from './hooks/useKeyframeDrag';
import { getAllKeyframesForProperty, interpolateKeyframes } from '../../utils/animation';
import type { AnimatableProperty, Keyframe, ClipAnimation, ClipTransform, ClipEffects } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import styles from './KeyframeTrack.module.css';

interface KeyframeTrackProps {
  property: AnimatableProperty;
  label: string;
  clipId: string;
  clipDuration: number;
  animation: ClipAnimation | undefined;
  transform: ClipTransform;
  effects: ClipEffects;
  currentTime: number;  // Time relative to clip start
  playheadTime: number; // Playhead time relative to clip
  isSelected: boolean;
  /**
   * Whether the clip sits on a locked track (ESCSUITE-88). Clicking the row to
   * open its graph still works — that is reading — but a diamond cannot be
   * dragged and a double-click adds nothing, because the store would refuse both
   * in silence.
   */
  locked: boolean;
  /**
   * The row's place in the panel's one tab stop (ESCSUITE-243): 0 on the open
   * row (or the first, when none is open), -1 on every other. The panel
   * derives it from the open row — no state of its own.
   */
  tabIndex: 0 | -1;
  /**
   * `fromKeyboard` is true when the click was a keyboard activation of the
   * label button (`event.detail === 0`; a pointer click is >= 1) — the panel
   * moves focus into the graph for those only.
   */
  onSelect: (fromKeyboard: boolean) => void;
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void;
  onAddKeyframe: (property: AnimatableProperty, time: number, value: number) => void;
  /**
   * Told the raw text of a refused diamond drop (ESCSUITE-167 / M6), or `''`
   * once a drop lands. `KeyframePanel` is the one live region every row
   * shares — only one diamond on one row can ever be dragging at a time
   * (review round 1, MINOR 6) — not one `role="status"` per row.
   */
  onAnnounce: (text: string) => void;
}

const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  blur: 'Blur',
  volume: 'Volume',
};

export function KeyframeTrack({
  property,
  clipId: _clipId,
  clipDuration,
  animation,
  transform,
  effects,
  currentTime,
  playheadTime,
  isSelected,
  locked,
  tabIndex,
  onSelect,
  onKeyframeMoved,
  onAddKeyframe,
  onAnnounce,
}: KeyframeTrackProps) {
  // Note: _clipId is used by parent for identification but not needed in this component
  // Get all keyframes for this property (including preset-generated ones)
  const keyframes = useMemo(() => {
    return getAllKeyframesForProperty(
      property,
      clipDuration,
      animation,
      transform || DEFAULT_TRANSFORM,
      effects || DEFAULT_EFFECTS
    );
  }, [property, clipDuration, animation, transform, effects]);

  // Get all keyframe times for snapping
  const allKeyframeTimes = useMemo(() => {
    return keyframes.map(kf => kf.time);
  }, [keyframes]);

  // The value the curve holds where there are no keyframes at all — shared by
  // the readout below and by the double-click add (ESCSUITE-167 / m3), which
  // needs the curve's value at the CLICKED time, not this one.
  const defaultValue = useMemo(() => {
    if (property === 'blur') return effects?.blur ?? 0;
    if (property === 'volume') return 1; // Volume default is 1 (100%)
    const val = transform?.[property as keyof ClipTransform];
    return typeof val === 'number' ? val : 0;
  }, [property, transform, effects]);

  // Get current interpolated value
  const currentValue = useMemo(
    () => interpolateKeyframes(keyframes, currentTime, defaultValue),
    [keyframes, currentTime, defaultValue]
  );

  // Check if a keyframe is custom (user-created) vs preset-generated
  const isCustomKeyframe = useCallback((kf: Keyframe): boolean => {
    const customKfs = animation?.keyframes[property] || [];
    return customKfs.some(ckf => Math.abs(ckf.time - kf.time) < 0.001);
  }, [animation, property]);

  // Keyframe drag handler
  const handleKeyframeMoved = useCallback((prop: AnimatableProperty, originalTime: number, newTime: number) => {
    onKeyframeMoved(prop, originalTime, newTime);
  }, [onKeyframeMoved]);

  const { dragState, startDrag, trackRef } = useKeyframeDrag(
    clipDuration,
    playheadTime,
    allKeyframeTimes,
    handleKeyframeMoved,
    onAnnounce
  );

  // Handle double-click on track to add keyframe
  const handleTrackDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    // Always use clientX - rect.left for consistent positioning
    // nativeEvent.offsetX is relative to e.target which may be a child element
    const relativeX = e.clientX - rect.left;
    const time = Math.max(0, Math.min((relativeX / rect.width) * clipDuration, clipDuration));
    // At the value the curve already has there (ESCSUITE-167 / m3), so the
    // shape the user can see does not jump when they add to it — the same
    // reason the graph's own two add paths pass a value rather than let the
    // panel fall back to the clip's static default.
    const value = interpolateKeyframes(keyframes, time, defaultValue);
    onAddKeyframe(property, time, value);
  }, [clipDuration, locked, property, onAddKeyframe, trackRef, keyframes, defaultValue]);

  // Format value for display
  const formatValue = (value: number): string => {
    if (property === 'rotation') return `${value.toFixed(0)}°`;
    if (property === 'blur') return `${value.toFixed(1)}px`;
    if (property === 'opacity' || property === 'volume') return `${(value * 100).toFixed(0)}%`;
    if (property === 'x' || property === 'y') return `${(value * 100).toFixed(1)}%`;
    return value.toFixed(2);
  };

  const hasKeyframes = keyframes.length > 0;

  return (
    // The row is a container; only the label cell is the button
    // (ESCSUITE-243), so the diamond track stays outside interactive content.
    // One `onClick` on the container serves a click anywhere in the row — the
    // button's own click (a pointer's or Enter/Space's) bubbles into it, so one
    // activation calls `onSelect` once. `aria-pressed`, not `aria-expanded`:
    // the graph is a block above all the rows, not this row's own region.
    <div
      className={`${styles.track} ${isSelected ? styles.selected : ''} ${hasKeyframes ? styles.hasKeyframes : ''}`}
      onClick={(e) => onSelect(e.detail === 0)}
    >
      <button
        type="button"
        className={styles.label}
        aria-pressed={isSelected}
        tabIndex={tabIndex}
        data-property={property}
      >
        {PROPERTY_LABELS[property]}
      </button>

      <div
        className={styles.trackArea}
        ref={trackRef}
        onDoubleClick={handleTrackDoubleClick}
      >
        {/* Track background line */}
        <div className={styles.trackLine} />

        {/* Playhead indicator */}
        <div
          className={styles.playhead}
          style={{ left: `${(playheadTime / clipDuration) * 100}%` }}
        />

        {/* Keyframe diamonds */}
        {keyframes.map((kf, idx) => {
          const isCustom = isCustomKeyframe(kf);
          const isDragging = dragState.isDragging &&
            dragState.property === property &&
            Math.abs(dragState.originalTime - kf.time) < 0.001;

          const displayTime = isDragging ? dragState.currentTime : kf.time;
          const leftPercent = (displayTime / clipDuration) * 100;

          return (
            <div
              key={`${kf.time}-${idx}`}
              className={`${styles.diamond} ${isCustom ? styles.custom : styles.preset} ${isDragging ? styles.dragging : ''}`}
              style={{ left: `${leftPercent}%` }}
              onMouseDown={(e) => {
                // The gesture is refused here rather than inside
                // `useKeyframeDrag`, which stays lock-unaware: a drag that
                // started would move the diamond and snap it back.
                if (isCustom && !locked) {
                  startDrag(property, kf, e);
                }
              }}
              title={`${formatValue(kf.value)} @ ${kf.time.toFixed(2)}s${isCustom ? '' : ' (preset)'}`}
            />
          );
        })}
      </div>

      <div className={styles.value}>
        {formatValue(currentValue)}
      </div>
    </div>
  );
}
