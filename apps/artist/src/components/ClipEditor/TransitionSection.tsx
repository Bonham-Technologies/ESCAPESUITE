import type { Transition, TransitionType } from '../../store/types';
import { maxPresetDuration } from './clipEditorModel';
import { TRANSITION_TYPES } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface TransitionSectionProps {
  /** The transition played at the end of this clip, or undefined on an older clip that has none. */
  transition: Transition | undefined;
  /** The clip's length in seconds, which caps the duration slider. */
  clipDuration: number;
  /** Choose a different transition. */
  onTypeChange: (type: TransitionType) => void;
  /** Set how long the transition runs, in seconds. */
  onDurationChange: (duration: number) => void;
}

/**
 * The "Transition Out" section of the clip inspector, collapsed by default:
 * which transition runs at the end of this clip and, for anything other than
 * `none`, how long it takes.
 */
export function TransitionSection({ transition, clipDuration, onTypeChange, onDurationChange }: TransitionSectionProps) {
  return (
    <CollapsibleSection title="Transition Out" defaultOpen={false}>
      <div className={styles.transitionControls}>
        <div className={styles.transitionRow}>
          <label>Type</label>
          <select
            className={styles.select}
            value={transition?.type ?? 'none'}
            onChange={(e) => onTypeChange(e.target.value as TransitionType)}
          >
            {TRANSITION_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        {/* Same reading as the select above: a clip saved with no transition
            object shows no duration row, exactly as one set to `none` does.
            Written as a narrowing `&&` chain rather than `(transition?.type ??
            'none') !== 'none'` so that `transition` is a `Transition` below —
            `duration` is required on it, so no fallback is reachable. */}
        {transition && transition.type !== 'none' && (
          <div className={styles.transformRow}>
            <label>Duration</label>
            <input
              type="range"
              min={0.1}
              max={maxPresetDuration(clipDuration)}
              step={0.1}
              value={transition.duration}
              onChange={(e) => onDurationChange(parseFloat(e.target.value))}
            />
            <span>{transition.duration.toFixed(1)}s</span>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
