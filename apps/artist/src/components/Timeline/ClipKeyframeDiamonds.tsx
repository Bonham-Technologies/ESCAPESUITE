import { useMemo } from 'react';
import type { Clip } from '../../store/types';
import styles from './ClipKeyframeDiamonds.module.css';

interface ClipKeyframeDiamondsProps {
  clip: Clip;
  pixelsPerSecond: number;
}

export function ClipKeyframeDiamonds({ clip, pixelsPerSecond }: ClipKeyframeDiamondsProps) {
  // Collect all unique keyframe times from all animated properties
  const keyframeTimes = useMemo(() => {
    const times = new Set<number>();

    if (!clip.animation?.keyframes) return [];

    // Collect times from all properties
    Object.values(clip.animation.keyframes).forEach(kfs => {
      if (kfs) {
        kfs.forEach(kf => times.add(kf.time));
      }
    });

    return Array.from(times).sort((a, b) => a - b);
  }, [clip.animation]);

  if (keyframeTimes.length === 0) return null;

  return (
    <div className={styles.diamonds}>
      {keyframeTimes.map(time => (
        <div
          key={time}
          className={styles.diamond}
          style={{ left: time * pixelsPerSecond }}
          title={`Keyframe @ ${time.toFixed(2)}s`}
        />
      ))}
    </div>
  );
}
