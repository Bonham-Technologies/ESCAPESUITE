import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface EffectsSectionProps {
  /** The clip's blur radius in pixels. The caller supplies 0 for a clip with no effects. */
  blur: number;
  /** Change the blur radius. */
  onBlurChange: (blur: number) => void;
}

/**
 * The "Effects" section of the clip inspector: one blur slider, collapsed by
 * default. The readout keeps one decimal place because the slider steps in
 * halves.
 */
export function EffectsSection({ blur, onBlurChange }: EffectsSectionProps) {
  return (
    <CollapsibleSection title="Effects" defaultOpen={false}>
      <div className={styles.transformControls}>
        <div className={styles.transformRow}>
          <label>Blur</label>
          <input
            type="range"
            min={0}
            max={50}
            step={0.5}
            value={blur}
            onChange={(e) => onBlurChange(parseFloat(e.target.value))}
          />
          <span>{blur.toFixed(1)}px</span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
