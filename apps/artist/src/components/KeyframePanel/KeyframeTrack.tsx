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
  onSelect: () => void;
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void;
  onAddKeyframe: (property: AnimatableProperty, time: number) => void;
}

const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  blur: 'Blur',
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
  onSelect,
  onKeyframeMoved,
  onAddKeyframe,
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

  // Get current interpolated value
  const currentValue = useMemo(() => {
    const defaultValue = property === 'blur'
      ? (effects?.blur ?? 0)
      : (transform?.[property as keyof ClipTransform] ?? 0);
    return interpolateKeyframes(keyframes, currentTime, defaultValue);
  }, [keyframes, currentTime, property, transform, effects]);

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
    handleKeyframeMoved
  );

  // Handle double-click on track to add keyframe
  const handleTrackDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    // Always use clientX - rect.left for consistent positioning
    // nativeEvent.offsetX is relative to e.target which may be a child element
    const relativeX = e.clientX - rect.left;
    const time = (relativeX / rect.width) * clipDuration;
    onAddKeyframe(property, Math.max(0, Math.min(time, clipDuration)));
  }, [clipDuration, property, onAddKeyframe, trackRef]);

  // Format value for display
  const formatValue = (value: number): string => {
    if (property === 'rotation') return `${value.toFixed(0)}°`;
    if (property === 'blur') return `${value.toFixed(1)}px`;
    if (property === 'opacity') return `${(value * 100).toFixed(0)}%`;
    if (property === 'x' || property === 'y') return `${(value * 100).toFixed(1)}%`;
    return value.toFixed(2);
  };

  const hasKeyframes = keyframes.length > 0;

  return (
    <div
      className={`${styles.track} ${isSelected ? styles.selected : ''} ${hasKeyframes ? styles.hasKeyframes : ''}`}
      onClick={onSelect}
    >
      <div className={styles.label}>
        {PROPERTY_LABELS[property]}
      </div>

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
                if (isCustom) {
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
