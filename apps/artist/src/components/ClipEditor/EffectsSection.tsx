import { CollapsibleSection } from './CollapsibleSection';
import type { SliderGestureHandlers } from './useSliderGesture';
import styles from './ClipEditor.module.css';

interface EffectsSectionProps {
  /** The clip's blur radius in pixels. The caller supplies 0 for a clip with no effects. */
  blur: number;
  /** Change the blur radius. */
  onBlurChange: (blur: number) => void;
  /**
   * Undo-coalescing listeners for the slider (ESCSUITE-75). Blur steps in
   * halves from 0 to 50, so a full drag is around a hundred `onBlurChange`
   * calls and, with these attached, one undo entry.
   */
  sliderGesture: SliderGestureHandlers;
}

/**
 * The "Effects" section of the clip inspector: one blur slider, collapsed by
 * default. The readout keeps one decimal place because the slider steps in
 * halves.
 */
export function EffectsSection({ blur, onBlurChange, sliderGesture }: EffectsSectionProps) {
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
            {...sliderGesture}
            onChange={(e) => onBlurChange(parseFloat(e.target.value))}
          />
          <span>{blur.toFixed(1)}px</span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
