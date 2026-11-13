import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { useEditorStore } from '../store/projectStore';
import {
  DEFAULT_SILENCE_OPTIONS,
  findTakeSilences,
  hasApproximateTiming,
  nothingAudible,
  totalLength,
  type SilenceOptions,
  type TimeRange,
} from '../core/silenceDetection';
import { leftBehind, type LeftBehind } from '../store/rippleRanges';
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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How much sound either side of a pause its "Play" lets you hear, in seconds (ESCSUITE-443). */
const PLAY_MARGIN = 1;

/**
 * "Play" on a listed pause (ESCSUITE-443): play the timeline from
 * `PLAY_MARGIN` before the pause to `PLAY_MARGIN` after it, then pause there.
 * One per dialog, and one Play at a time: another Play replaces it, and `stop`
 * (Go to, the dialog closing) pauses it where it is.
 *
 * The stop is a timer for the span's length, since the preview's loop plays on
 * its own wall clock. Its 200 ms store writes are a backstop: a playhead past
 * the end (playback started in a gap jumps to the next clip, ESCSUITE-280)
 * stops it early. Playback the Play did not start is never stopped by it: once
 * something else pauses, or seeks, the Play lets go.
 */
function pausePlayer() {
  let running: { timer: ReturnType<typeof setTimeout>; unsubscribe: () => void } | null = null;

  /** Forget the running Play; whether there was one. */
  const letGo = () => {
    if (!running) return false;
    clearTimeout(running.timer);
    running.unsubscribe();
    running = null;
    return true;
  };

  /** Pause on the end of the span. A pause and a seek in one batch: the loop keeps the seek. */
  const finish = (until: number) => {
    letGo();
    const { setIsPlaying, seekTo } = useEditorStore.getState();
    setIsPlaying(false);
    seekTo(until);
  };

  return {
    play(range: TimeRange) {
      letGo();
      const from = Math.max(0, range.start - PLAY_MARGIN);
      const until = range.end + PLAY_MARGIN;
      const { isPlaying, setIsPlaying, seekTo } = useEditorStore.getState();
      // The loop reads the playhead only as playback starts, and overwrites a
      // seek made while it plays. So a Play during playback pauses first, and
      // the pause has to reach the loop before playback starts again.
      if (isPlaying) flushSync(() => setIsPlaying(false));
      seekTo(from);
      setIsPlaying(true);
      const { seekSequence } = useEditorStore.getState();
      const unsubscribe = useEditorStore.subscribe((state) => {
        if (!state.isPlaying || state.seekSequence !== seekSequence) letGo();
        else if (state.currentTime >= until) finish(until);
      });
      running = { timer: setTimeout(() => finish(until), (until - from) * 1000), unsubscribe };
    },
    stop() {
      if (letGo()) useEditorStore.getState().setIsPlaying(false);
    },
  };
}

/**
 * What the cut leaves where it is, in words (ESCSUITE-431): the clips by kind,
 * then the markers. `verb` is "will not move" in the dialog, "did not move" in
 * the notice.
 */
function leftBehindText(left: LeftBehind, moveEverything: boolean, verb: string): string {
  const kinds = [
    count(left.blur, 'blur', 'blurs'),
    count(left.captions, 'caption', 'captions'),
    count(left.textOrShapes, 'text or shape', 'texts or shapes'),
    count(left.media, 'media clip', 'media clips'),
  ].filter((k) => !k.startsWith('0 '));
  const clips = left.blur + left.captions + left.textOrShapes + left.media;
  // With the box on only a lock holds a clip back: its own track's, or that of
  // a clip it is linked to.
  const where = !moveEverything
    ? 'on other tracks'
    : `on ${clips === 1 ? 'a locked track' : 'locked tracks'}${left.linkedToLocked > 0 ? ' or linked to one' : ''}`;
  const sentences: string[] = [];
  if (clips > 0) {
    sentences.push(`${count(clips, 'clip', 'clips')} ${where} ${verb}: ${kinds.join(', ')}.`);
  }
  if (left.markers > 0) sentences.push(`${count(left.markers, 'marker', 'markers')} ${verb}.`);
  return sentences.join(' ');
}

/**
 * "Remove silences" (ESCSUITE-403): find the pauses in a clip's sound — every
 * linked part's, for a take recorded as separate tracks — list them for
 * review, and cut them all in one undo step.
 *
 * Opened from the inspector's Actions section, which has already filled the
 * list with the default settings (`useClipEditorActions`). Changing a setting
 * finds the pauses again; "Keep" drops one from the list; "Go to" and "Play"
 * move the playhead to a pause and play it with a second either side
 * (ESCSUITE-443). The list lives in
 * the store's `silenceReview`, so the timeline draws it as bands while the
 * dialog is up. Nothing is cut until "Remove all", which calls
 * `removeTimeRanges` once: one Ctrl+Z puts every pause back. "Move everything
 * after each cut" (on as it opens, ESCSUITE-434) moves the other rows, the
 * markers and the in/out points with it. Whatever it would leave where it
 * is, overlapping or after the first cut, the dialog counts by kind and the
 * notice repeats (ESCSUITE-431).
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
  // ESCSUITE-434: move every other unlocked row, the markers and the in/out
  // points with the cut, so overlays and captions stay on what they cover.
  const [moveEverything, setMoveEverything] = useState(true);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const markers = useEditorStore((state) => state.markers);
  const titleId = useId();

  const close = () => setSilenceReviewClip(null);
  const dialogRef = useDialogBehaviour(close);

  // ESCSUITE-441: Keep unmounts its own row, and with it the focused button,
  // which dropped focus to the page body. Keep records which row's Keep takes
  // focus once the shorter list is drawn (-1: Cancel, the list being empty).
  const keepButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusAfterKeep = useRef<number | null>(null);
  useEffect(() => {
    const target = focusAfterKeep.current;
    if (target === null) return;
    focusAfterKeep.current = null;
    (keepButtons.current[target] ?? cancelButton.current)?.focus();
  });

  // ESCSUITE-443: Go to and Play let a pause be heard before it is cut. The
  // row last gone to or played is the active one, scrolled into view.
  // A Play stops when the review closes, however it closes, or unmounts.
  const [player] = useState(pausePlayer);
  const open = review !== null;
  useEffect(() => (open ? () => player.stop() : undefined), [open, player]);
  const [active, setActive] = useState<TimeRange | null>(null);
  const activeRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!review) return null;
  const candidates = review.candidates;
  const left = leftBehind(clips, tracks, markers, review.clipId, candidates, moveEverything);
  const warningId = `${titleId}-left-behind`;

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
    // The next row moves up into this one's place; on the last row, the one
    // before it; with no row left, Cancel (Remove all is disabled then).
    focusAfterKeep.current = Math.min(index, candidates.length - 2);
    setSilenceCandidates(candidates.filter((_, i) => i !== index));
  };

  const handleGoTo = (range: TimeRange) => {
    player.stop();
    const { isPlaying, setIsPlaying, seekTo } = useEditorStore.getState();
    // A seek while playing does not hold (the loop overwrites it): pause too.
    if (isPlaying) setIsPlaying(false);
    seekTo(range.start);
    setActive(range);
  };

  const handlePlay = (range: TimeRange) => {
    player.play(range);
    setActive(range);
  };

  const handleRemoveAll = () => {
    if (!removeTimeRanges(review.clipId, candidates, moveEverything)) {
      const there = useEditorStore.getState().project.timeline.clips.some((c) => c.id === review.clipId);
      setRefused(there ? 'locked' : 'gone');
      return;
    }
    const removed = `Removed ${count(candidates.length, 'pause', 'pauses')} (${seconds(totalLength(candidates))}). Ctrl+Z puts them back.`;
    onRemoved(left ? `${removed} ${leftBehindText(left, moveEverything, 'did not move')}` : removed);
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
        aria-describedby={left ? warningId : undefined}
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

          <div className={styles.option}>
            <input
              id={`${titleId}-move`}
              type="checkbox"
              checked={moveEverything}
              aria-describedby={`${titleId}-move-hint`}
              onChange={(e) => {
                setMoveEverything(e.target.checked);
                setRefused(null);
              }}
            />
            <label htmlFor={`${titleId}-move`}>Move everything after each cut</label>
            <span className={styles.hint} id={`${titleId}-move-hint`}>
              {moveEverything
                ? 'Other tracks, markers and in/out points close up too. Locked tracks stay put.'
                : 'Only this take\'s tracks close up.'}
            </span>
          </div>

          {left && (
            <p className={styles.warning} id={warningId} data-testid="silence-left-behind">
              {leftBehindText(left, moveEverything, 'will not move')} They may fall out of step with the take.
            </p>
          )}

          {approximate && (
            <p className={styles.note} data-testid="silence-timing-note">
              Part of this recording's waveform was made by an earlier version of ESCAPEARTIST, so
              pauses late in a long recording may be left in rather than risk cutting into speech.
            </p>
          )}

          {candidates.length > 0 && (
            <ul className={styles.list} aria-label="Pauses to cut" tabIndex={0}>
              {candidates.map((range, i) => {
                const isActive = active !== null && active.start === range.start && active.end === range.end;
                return (
                  <li
                    key={`${range.start}-${range.end}`}
                    ref={isActive ? activeRow : undefined}
                    className={isActive ? `${styles.item} ${styles.itemActive}` : styles.item}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className={styles.range}>
                      {clock(range.start)} – {clock(range.end)}
                      <span className={styles.length}> · {seconds(range.end - range.start)}</span>
                    </span>
                    <span className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.rowButton}
                        onClick={() => handleGoTo(range)}
                        aria-label={`Go to the pause at ${clock(range.start)}`}
                      >
                        Go to
                      </button>
                      <button
                        type="button"
                        className={styles.rowButton}
                        onClick={() => handlePlay(range)}
                        aria-label={`Play the pause at ${clock(range.start)}`}
                        title={`Play from ${PLAY_MARGIN} s before the pause to ${PLAY_MARGIN} s after it`}
                      >
                        Play
                      </button>
                      <button
                        ref={(el) => {
                          keepButtons.current[i] = el;
                        }}
                        type="button"
                        className={styles.rowButton}
                        onClick={() => handleKeep(i)}
                        aria-label={`Keep the pause at ${clock(range.start)}`}
                      >
                        Keep
                      </button>
                    </span>
                  </li>
                );
              })}
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
            <button ref={cancelButton} type="button" className={styles.cancelButton} onClick={close}>
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
