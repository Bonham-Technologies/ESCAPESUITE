import { useId, useState } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { useEditorStore } from '../store/projectStore';
import {
  DEFAULT_SILENCE_OPTIONS,
  findTakeSilences,
  hasApproximateTiming,
  nothingAudible,
  totalLength,
  type SilenceOptions,
} from '../core/silenceDetection';
import styles from './SilenceDialog.module.css';

interface SilenceDialogProps {
  /** Reports the result of "Remove all" through the editor's notice channel. */
  onRemoved: (message: string) => void;
}

/** Each setting's field: its label, its bounds and its step. */
const FIELDS: { key: keyof SilenceOptions; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: 'thresholdDb', label: 'Threshold (dBFS)', hint: 'Quieter than this counts as silence.', min: -100, max: 0, step: 1 },
  { key: 'minGap', label: 'Minimum gap (s)', hint: 'Shorter pauses are left alone.', min: 0, max: 60, step: 0.1 },
  { key: 'padding', label: 'Padding (s)', hint: 'Kept on each side of every cut.', min: 0, max: 5, step: 0.05 },
];

const seconds = (s: number) => `${s.toFixed(2)} s`;

/** A timeline time as `m:ss.cc`, rounded to the millisecond first so 5.1 reads 0:05.10. */
function clock(t: number): string {
  const ms = Math.round(t * 1000);
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, '0')}`;
}

/**
 * "Remove silences" (ESCSUITE-403): find the pauses in a clip's sound — every
 * linked part's, for a take recorded as separate tracks — list them for
 * review, and cut them all in one undo step.
 *
 * Opened from the inspector's Actions section, which has already filled the
 * list with the default settings (`useClipEditorActions`). Changing a setting
 * finds the pauses again; "Keep" drops one from the list. The list lives in
 * the store's `silenceReview`, so the timeline draws it as bands while the
 * dialog is up. Nothing is cut until "Remove all", which calls
 * `removeTimeRanges` once: one Ctrl+Z puts every pause back.
 *
 * Detection reads the waveform peaks already in the library, so it costs no
 * decode and needs no network. Escape cancels, as the Cancel button does.
 */
export function SilenceDialog({ onRemoved }: SilenceDialogProps) {
  const review = useEditorStore((state) => state.silenceReview);
  const setSilenceReviewClip = useEditorStore((state) => state.setSilenceReviewClip);
  const setSilenceCandidates = useEditorStore((state) => state.setSilenceCandidates);
  const removeTimeRanges = useEditorStore((state) => state.removeTimeRanges);
  // Peaks from before their length was recorded are placed conservatively,
  // so a pause late in a long recording can be left in (peakTiming.ts).
  const approximate = useEditorStore((state) =>
    state.silenceReview !== null &&
    hasApproximateTiming(state.project.timeline.clips, state.project.timeline.tracks, state.sourceVideos, state.silenceReview.clipId)
  );
  // ESCSUITE-435: muted and hidden rows are not listened to, as the export
  // leaves them out; with every row that has sound muted there is nothing to judge.
  const inaudible = useEditorStore((state) =>
    state.silenceReview !== null &&
    nothingAudible(state.project.timeline.clips, state.project.timeline.tracks, state.sourceVideos, state.silenceReview.clipId)
  );
  const [values, setValues] = useState<Record<keyof SilenceOptions, string>>(() => ({
    thresholdDb: String(DEFAULT_SILENCE_OPTIONS.thresholdDb),
    minGap: String(DEFAULT_SILENCE_OPTIONS.minGap),
    padding: String(DEFAULT_SILENCE_OPTIONS.padding),
  }));
  // Why "Remove all" cut nothing, or null. The dialog is modal, but a host
  // page can still replace the project under it (integration API).
  const [refused, setRefused] = useState<'locked' | 'gone' | null>(null);
  const titleId = useId();

  const close = () => setSilenceReviewClip(null);
  const dialogRef = useDialogBehaviour(close);

  if (!review) return null;
  const candidates = review.candidates;

  const parsed = (key: keyof SilenceOptions, raw: string): number | null => {
    const field = FIELDS.find((f) => f.key === key)!;
    const value = raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value) && value >= field.min && value <= field.max ? value : null;
  };

  const handleChange = (key: keyof SilenceOptions, raw: string) => {
    const next = { ...values, [key]: raw };
    setValues(next);
    setRefused(null);
    const options = {} as SilenceOptions;
    for (const field of FIELDS) {
      const value = parsed(field.key, next[field.key]);
      if (value === null) return; // leave the list as it was until every field reads
      options[field.key] = value;
    }
    const { project, sourceVideos } = useEditorStore.getState();
    setSilenceCandidates(findTakeSilences(project.timeline.clips, project.timeline.tracks, sourceVideos, review.clipId, options));
  };

  const handleKeep = (index: number) => {
    setSilenceCandidates(candidates.filter((_, i) => i !== index));
  };

  const handleRemoveAll = () => {
    if (!removeTimeRanges(review.clipId, candidates)) {
      const there = useEditorStore.getState().project.timeline.clips.some((c) => c.id === review.clipId);
      setRefused(there ? 'locked' : 'gone');
      return;
    }
    const count = candidates.length;
    onRemoved(`Removed ${count} ${count === 1 ? 'pause' : 'pauses'} (${seconds(totalLength(candidates))}). Ctrl+Z puts them back.`);
    close();
  };

  const total = totalLength(candidates);

  return (
    <div className={styles.overlay} data-testid="silence-dialog">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>Remove silences</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.fields}>
            {FIELDS.map((field) => {
              const invalid = parsed(field.key, values[field.key]) === null;
              return (
                <div key={field.key} className={styles.field}>
                  <label className={styles.label} htmlFor={`${titleId}-${field.key}-input`}>
                    {field.label}
                  </label>
                  <input
                    id={`${titleId}-${field.key}-input`}
                    type="number"
                    className={styles.input}
                    value={values[field.key]}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    aria-invalid={invalid || undefined}
                    aria-describedby={`${titleId}-${field.key}`}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                  <span className={styles.hint} id={`${titleId}-${field.key}`}>
                    {invalid ? `Enter a number from ${field.min} to ${field.max}.` : field.hint}
                  </span>
                </div>
              );
            })}
          </div>

          <p className={styles.summary} role="status" aria-live="polite">
            {inaudible
              ? 'No audible sound to judge: every track with sound here is muted or hidden.'
              : candidates.length === 0
              ? 'No pauses to cut with these settings.'
              : `${candidates.length} ${candidates.length === 1 ? 'pause' : 'pauses'} found · ${seconds(total)} will be cut`}
          </p>

          {approximate && (
            <p className={styles.note} data-testid="silence-timing-note">
              Part of this recording's waveform was made by an earlier version of ESCAPEARTIST, so
              pauses late in a long recording may be left in rather than risk cutting into speech.
            </p>
          )}

          {candidates.length > 0 && (
            <ul className={styles.list} aria-label="Pauses to cut" tabIndex={0}>
              {candidates.map((range, i) => (
                <li key={`${range.start}-${range.end}`} className={styles.item}>
                  <span className={styles.range}>
                    {clock(range.start)} – {clock(range.end)}
                    <span className={styles.length}> · {seconds(range.end - range.start)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.keepButton}
                    onClick={() => handleKeep(i)}
                    aria-label={`Keep the pause at ${clock(range.start)}`}
                  >
                    Keep
                  </button>
                </li>
              ))}
            </ul>
          )}

          {refused && (
            <p className={styles.error} role="alert">
              {refused === 'locked'
                ? 'Nothing was cut: a track this take sits on is locked. Unlock it and try again.'
                : 'Nothing was cut: the clip is no longer on the timeline.'}
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.removeButton}
              onClick={handleRemoveAll}
              disabled={candidates.length === 0}
            >
              Remove all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
