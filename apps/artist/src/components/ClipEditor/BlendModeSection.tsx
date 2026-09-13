import type { BlendMode } from '../../store/types';
import { BLEND_MODES } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface BlendModeSectionProps {
  /** The clip's current blend mode. */
  value: BlendMode;
  /** Choose a different one. */
  onChange: (mode: BlendMode) => void;
}

/**
 * The "Blend Mode" section of the clip inspector: one dropdown over
 * `BLEND_MODES`, collapsed by default.
 */
export function BlendModeSection({ value, onChange }: BlendModeSectionProps) {
  return (
    <CollapsibleSection title="Blend Mode" defaultOpen={false}>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value as BlendMode)}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>
    </CollapsibleSection>
  );
}
