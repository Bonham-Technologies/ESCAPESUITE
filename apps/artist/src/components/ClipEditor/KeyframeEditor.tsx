import { useCallback, useMemo, useState } from 'react';
import { useEditorStore, selectSelectedClip } from '../../store/projectStore';
import { getAllKeyframesForProperty, hasAnimation } from '../../utils/animation';
import type { AnimatableProperty, EasingType, Keyframe } from '../../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import styles from './KeyframeEditor.module.css';

// Properties that can be animated
const PROPERTIES: { key: AnimatableProperty; label: string; group: string }[] = [
  { key: 'x', label: 'Position X', group: 'Transform' },
  { key: 'y', label: 'Position Y', group: 'Transform' },
  { key: 'scaleX', label: 'Scale X', group: 'Transform' },
  { key: 'scaleY', label: 'Scale Y', group: 'Transform' },
  { key: 'rotation', label: 'Rotation', group: 'Transform' },
  { key: 'opacity', label: 'Opacity', group: 'Transform' },
  { key: 'blur', label: 'Blur', group: 'Effects' },
];

const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'ease-in-cubic', label: 'Cubic In' },
  { value: 'ease-out-cubic', label: 'Cubic Out' },
  { value: 'ease-in-out-cubic', label: 'Cubic In-Out' },
];

export function KeyframeEditor() {
  const selectedClip = useEditorStore(selectSelectedClip);
  const currentTime = useEditorStore((state) => state.currentTime);
  const setClipKeyframe = useEditorStore((state) => state.setClipKeyframe);
  const removeClipKeyframe = useEditorStore((state) => state.removeClipKeyframe);

  const [expandedProperty, setExpandedProperty] = useState<AnimatableProperty | null>(null);
  const [selectedKeyframe, setSelectedKeyframe] = useState<{ property: AnimatableProperty; time: number } | null>(null);

  // Get time relative to clip start
  const clipTime = useMemo(() => {
    if (!selectedClip) return 0;
    const t = currentTime - selectedClip.timelinePosition;
    return Math.max(0, Math.min(t, selectedClip.duration));
  }, [currentTime, selectedClip]);

  // Get all keyframes for the selected clip
  const keyframesByProperty = useMemo(() => {
    if (!selectedClip) return new Map<AnimatableProperty, Keyframe[]>();

    const result = new Map<AnimatableProperty, Keyframe[]>();
    for (const prop of PROPERTIES) {
      const kfs = getAllKeyframesForProperty(
        prop.key,
        selectedClip.duration,
        selectedClip.animation,
        selectedClip.transform || DEFAULT_TRANSFORM,
        selectedClip.effects || DEFAULT_EFFECTS
      );
      if (kfs.length > 0) {
        result.set(prop.key, kfs);
      }
    }
    return result;
  }, [selectedClip]);

  // Get default value for a property
  const getDefaultValue = useCallback((property: AnimatableProperty): number => {
    if (!selectedClip) return 0;
    const transform = selectedClip.transform || DEFAULT_TRANSFORM;
    const effects = selectedClip.effects || DEFAULT_EFFECTS;

    switch (property) {
      case 'x': return transform.x;
      case 'y': return transform.y;
      case 'scaleX': return transform.scaleX;
      case 'scaleY': return transform.scaleY;
      case 'rotation': return transform.rotation;
      case 'opacity': return transform.opacity;
      case 'blur': return effects.blur;
      default: return 0;
    }
  }, [selectedClip]);

  // Add keyframe at current time
  const handleAddKeyframe = useCallback((property: AnimatableProperty) => {
    if (!selectedClip) return;

    const keyframe: Keyframe = {
      time: clipTime,
      value: getDefaultValue(property),
      easing: 'ease-out',
    };

    setClipKeyframe(selectedClip.id, property, keyframe);
    setSelectedKeyframe({ property, time: clipTime });
  }, [selectedClip, clipTime, getDefaultValue, setClipKeyframe]);

  // Remove keyframe
  const handleRemoveKeyframe = useCallback((property: AnimatableProperty, time: number) => {
    if (!selectedClip) return;
    removeClipKeyframe(selectedClip.id, property, time);
    setSelectedKeyframe(null);
  }, [selectedClip, removeClipKeyframe]);

  // Update keyframe value
  const handleKeyframeValueChange = useCallback((property: AnimatableProperty, time: number, value: number) => {
    if (!selectedClip) return;

    const existingKfs = selectedClip.animation?.keyframes[property] || [];
    const existing = existingKfs.find(kf => Math.abs(kf.time - time) < 0.001);

    if (existing) {
      setClipKeyframe(selectedClip.id, property, { ...existing, value });
    }
  }, [selectedClip, setClipKeyframe]);

  // Update keyframe easing
  const handleKeyframeEasingChange = useCallback((property: AnimatableProperty, time: number, easing: EasingType) => {
    if (!selectedClip) return;

    const existingKfs = selectedClip.animation?.keyframes[property] || [];
    const existing = existingKfs.find(kf => Math.abs(kf.time - time) < 0.001);

    if (existing) {
      setClipKeyframe(selectedClip.id, property, { ...existing, easing });
    }
  }, [selectedClip, setClipKeyframe]);

  // Format time for display
  const formatTime = (t: number) => {
    const minutes = Math.floor(t / 60);
    const seconds = Math.floor(t % 60);
    const frames = Math.floor((t % 1) * 30);
    return `${minutes}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // Don't render if no clip selected or no animation active
  if (!selectedClip || !hasAnimation(selectedClip.animation)) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>Keyframes</h4>
        <span className={styles.time}>@{formatTime(clipTime)}</span>
      </div>

      <div className={styles.properties}>
        {PROPERTIES.map((prop) => {
          const keyframes = keyframesByProperty.get(prop.key) || [];
          const isExpanded = expandedProperty === prop.key;
          const hasKeyframes = keyframes.length > 0;
          // Check if there are custom keyframes (not from presets)
          const hasCustomKeyframes = (selectedClip.animation?.keyframes[prop.key]?.length || 0) > 0;

          if (!hasKeyframes && !isExpanded) return null;

          return (
            <div key={prop.key} className={styles.property}>
              <div
                className={`${styles.propertyHeader} ${hasKeyframes ? styles.active : ''}`}
                onClick={() => setExpandedProperty(isExpanded ? null : prop.key)}
              >
                <span className={styles.propertyName}>{prop.label}</span>
                <div className={styles.propertyActions}>
                  {hasCustomKeyframes && (
                    <span className={styles.customBadge}>Custom</span>
                  )}
                  <span className={styles.keyframeCount}>{keyframes.length}</span>
                  <button
                    className={styles.addButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddKeyframe(prop.key);
                    }}
                    title="Add keyframe at current time"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Keyframe track */}
              <div className={styles.track}>
                <div className={styles.trackLine} />
                {/* Playhead */}
                <div
                  className={styles.playhead}
                  style={{ left: `${(clipTime / selectedClip.duration) * 100}%` }}
                />
                {/* Keyframe markers */}
                {keyframes.map((kf, idx) => {
                  const isCustom = selectedClip.animation?.keyframes[prop.key]?.some(
                    k => Math.abs(k.time - kf.time) < 0.001
                  );
                  const isSelected = selectedKeyframe?.property === prop.key &&
                    Math.abs(selectedKeyframe.time - kf.time) < 0.001;

                  return (
                    <div
                      key={idx}
                      className={`${styles.keyframe} ${isCustom ? styles.custom : styles.preset} ${isSelected ? styles.selected : ''}`}
                      style={{ left: `${(kf.time / selectedClip.duration) * 100}%` }}
                      onClick={() => setSelectedKeyframe({ property: prop.key, time: kf.time })}
                      title={`${formatTime(kf.time)}: ${kf.value.toFixed(2)}`}
                    />
                  );
                })}
              </div>

              {/* Expanded keyframe editor */}
              {isExpanded && selectedKeyframe?.property === prop.key && (
                <div className={styles.keyframeEditor}>
                  {(() => {
                    const kf = keyframes.find(k => Math.abs(k.time - selectedKeyframe.time) < 0.001);
                    if (!kf) return null;

                    const isCustom = selectedClip.animation?.keyframes[prop.key]?.some(
                      k => Math.abs(k.time - kf.time) < 0.001
                    );

                    return (
                      <>
                        <div className={styles.keyframeRow}>
                          <label>Time</label>
                          <span>{formatTime(kf.time)}</span>
                        </div>
                        <div className={styles.keyframeRow}>
                          <label>Value</label>
                          <input
                            type="number"
                            step={prop.key === 'opacity' ? 0.1 : prop.key.includes('scale') ? 0.1 : 0.01}
                            value={kf.value}
                            onChange={(e) => handleKeyframeValueChange(prop.key, kf.time, parseFloat(e.target.value))}
                            disabled={!isCustom}
                          />
                        </div>
                        <div className={styles.keyframeRow}>
                          <label>Easing</label>
                          <select
                            value={kf.easing}
                            onChange={(e) => handleKeyframeEasingChange(prop.key, kf.time, e.target.value as EasingType)}
                            disabled={!isCustom}
                          >
                            {EASING_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        {isCustom && (
                          <button
                            className={styles.removeButton}
                            onClick={() => handleRemoveKeyframe(prop.key, kf.time)}
                          >
                            Remove Keyframe
                          </button>
                        )}
                        {!isCustom && (
                          <p className={styles.presetNote}>This keyframe is from a preset animation.</p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
