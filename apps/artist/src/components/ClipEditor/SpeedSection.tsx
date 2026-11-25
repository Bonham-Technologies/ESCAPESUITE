import { useId, useState } from 'react';
import {
  CLIP_SPEED_PRESETS,
  MAX_AUDIBLE_SPEED,
  MAX_CLIP_SPEED,
  MIN_CLIP_SPEED,
  formatClipSpeed,
  isAudibleSpeed,
} from '../../store/clipSpeed';
import { CollapsibleSection } from './CollapsibleSection';
import { useCommittedNumberInput } from './useCommittedNumberInput';
import styles from './ClipEditor.module.css';

interface SpeedSectionProps {
  /** The selected clip: a refusal shown for one clip is not shown for the next. */
  clipId: string;
  /** The clip's speed: 1 when it has none. */
  speed: number;
  /**
   * Set the clip's speed (ESCSUITE-471, the store's `setClipSpeed`). `false`
   * when the store refused: the section then says why.
   */
  onSpeedChange: (speed: number) => boolean;
  /** Whether the clip is linked: its linked parts change speed with it. */
  linked: boolean;
  /** Whether the clip has a picture: the sound line names the sound alone otherwise. */
  hasPicture: boolean;
  /** Freeze the section's controls — the clip's track is locked (ESCSUITE-84). */
  disabled?: boolean;
}

/**
 * The "Speed" section of the clip inspector (ESCSUITE-471), for video and
 * audio clips: one-click speeds and a field for any speed from 0.25× to 4×.
 * Below the controls, one line says what happens to the sound at this speed
 * — pitched with the picture up to 2×, silent above — and, when the store
 * refuses a change, why.
 */
export function SpeedSection({ clipId, speed, onSpeedChange, linked, hasPicture, disabled }: SpeedSectionProps) {
  const id = useId();
  // The clip whose last change was refused; cleared by the next one that
  // lands. Keyed by clip so the line doesn't follow the selection to another
  // clip (the inspector isn't remounted per clip).
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const refused = refusedFor === clipId;
  const apply = (next: number) => {
    // The speed it already has: nothing to change, and nothing to explain
    // (the store refuses it, but not for the reason the line gives).
    if (next === speed) {
      setRefusedFor(null);
      return;
    }
    setRefusedFor(onSpeedChange(next) ? null : clipId);
  };
  const field = useCommittedNumberInput({
    value: speed,
    min: MIN_CLIP_SPEED,
    max: MAX_CLIP_SPEED,
    onCommit: apply,
  });

  const sound = isAudibleSpeed(speed)
    ? speed === 1
      ? null
      : `The sound plays ${speed > 1 ? 'higher' : 'lower'}, in step with the ${hasPicture ? 'picture' : 'clip'}.`
    : `Silent: sound plays up to ${formatClipSpeed(MAX_AUDIBLE_SPEED)}.`;

  return (
    <CollapsibleSection
      title="Speed"
      defaultOpen={false}
      disabled={disabled}
      badge={speed !== 1 ? <span className={styles.clipType}>{formatClipSpeed(speed)}</span> : undefined}
    >
      <div className={styles.transitionControls}>
        <div className={styles.cropPresets} role="group" aria-label="Speed presets">
          {CLIP_SPEED_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`${styles.styleButton} ${preset === speed ? styles.active : ''}`}
              aria-pressed={preset === speed}
              onClick={() => apply(preset)}
            >
              {formatClipSpeed(preset)}
            </button>
          ))}
        </div>
        <div className={styles.transitionRow}>
          <label htmlFor={`${id}-speed`}>Speed</label>
          <input
            id={`${id}-speed`}
            className={styles.numberInput}
            type="number"
            inputMode="decimal"
            min={MIN_CLIP_SPEED}
            max={MAX_CLIP_SPEED}
            step={0.05}
            value={field.text}
            onChange={field.onChange}
            onBlur={field.onBlur}
            onKeyDown={field.onKeyDown}
          />
          <span className={styles.hint}>×</span>
        </div>
        {sound && <p className={styles.hint}>{sound}</p>}
        {linked && <p className={styles.hint}>Its linked parts change speed with it.</p>}
        {/* Always in the page, its text set on a refusal (ESCSUITE-523): a
            screen reader announces a change to a live region already there,
            not a region inserted with its text. */}
        <p className={`${styles.hint} ${styles.liveHint}`} role="status">
          {refused ? 'Not changed: a clip on its row is in the way, or a track it would move is locked.' : null}
        </p>
      </div>
    </CollapsibleSection>
  );
}
