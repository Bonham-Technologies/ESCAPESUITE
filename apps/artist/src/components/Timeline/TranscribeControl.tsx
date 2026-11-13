import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { useEditorStore } from '../../store/projectStore';
import { captionStyleFor, captionWrapColumns, wrapCaptionText } from '../../core/captions';
import {
  getLocalRecognitionCtor,
  installLocalLanguagePack,
  probeLocalRecognition,
  transcriptionLanguage,
} from '../../core/speechRecognitionLocal';
import styles from './TranscribeControl.module.css';

/** The notice shown before the browser downloads a language pack (ESCSUITE-404). Owner-approved wording. */
export const LANGUAGE_PACK_NOTICE =
  'Your browser will download a speech language pack once. Your audio never leaves this device.';

/** What a press asks when the Captions track already holds captions (ESCSUITE-442). */
export const REPLACE_QUESTION = 'Replace the existing captions, or add to them?';

type Phase =
  | { kind: 'idle' }
  | { kind: 'question'; existing: number }
  | { kind: 'consent' }
  | { kind: 'installing' }
  | { kind: 'mixing'; percent: number }
  | { kind: 'listening'; played: number; total: number };

interface TranscribeControlProps {
  showNotification: (message: string, type: 'error' | 'success' | 'info') => void;
  /**
   * Told whenever the "Replace or add" dialog opens or closes (ESCSUITE-442),
   * so `App` can count it in `modalOpen`, as `ResolutionPicker`'s confirm
   * does. Optional: the dialog is complete without a listener.
   */
  onDialogOpenChange?: (open: boolean) => void;
}

function stoppedError(): DOMException {
  return new DOMException('Transcription stopped', 'AbortError');
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * "Transcribe to captions" (ESCSUITE-404), in the timeline's controls.
 *
 * Renders **nothing** unless the browser has the on-device mode, decided by
 * static detection alone (`getLocalRecognitionCtor`): nothing on the API is
 * called until the user presses the button. `available()` must not run on
 * mount, because in a bare Chromium embedder it kills the page's renderer and
 * the whole editor with it, for people who never asked to transcribe. On the
 * press, `available()` is asked with `processLocally: true` for the browser's
 * language; `unavailable` hides the control for good and says so. The
 * transcription itself (`core/transcribe.ts`) is a dynamic `import()` on the
 * first click.
 *
 * A `downloadable` answer shows `LANGUAGE_PACK_NOTICE` first, and the browser
 * downloads the pack only when the user presses "Download language pack". The
 * cues land on the Captions track through `addCaptionCues`: one history
 * entry, so one undo takes the whole transcription back off.
 *
 * When the Captions track already holds clips, a press first asks
 * `REPLACE_QUESTION` in a modal dialog (ESCSUITE-442): **Replace** has
 * `addCaptionCues` take the old ones off in the same write (so one undo still
 * puts them back), **Add** appends as before, and **Cancel** or Escape asks
 * the browser nothing. Before, a second run stacked a second copy of every
 * caption on the first, and both were drawn and burned into the export.
 */
export function TranscribeControl({ showNotification, onDialogOpenChange }: TranscribeControlProps) {
  const lang = transcriptionLanguage();
  // Static detection only: calls nothing on the API (see above).
  const [supported] = useState(() => getLocalRecognitionCtor() !== null);
  // Set when a press finds on-device recognition unavailable for this language.
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // A stopped run lets go of the button at once (ESCSUITE-432), but the sound
  // it was mixing is mixed to the end before the core sees the stop. This
  // settles when that run has: the next run waits for it, so two mixes never
  // hold the timeline's sound in memory at once.
  const settlingRef = useRef<Promise<void> | null>(null);
  // One run at a time: a second press while the first is still asking the
  // browser (before the button turns into "Stop transcribing") is ignored.
  const runningRef = useRef(false);
  // Nothing starts listening after the editor has gone, e.g. once a language
  // pack the user asked for finishes installing.
  const mountedRef = useRef(true);
  // The answer to REPLACE_QUESTION, for the run the answer starts — through
  // the language-pack notice and its download too, if one is needed.
  const replaceRef = useRef(false);
  const addCaptionCues = useEditorStore((state) => state.addCaptionCues);

  // Keyboard focus. The main button stays one element while it reads
  // "Transcribe to captions" and "Stop transcribing", so focus stays on it. When
  // the element that had focus goes away (the notice closes, the pack finishes
  // installing), focus comes back to the main button, but only if it was in
  // this control and the user has not moved it elsewhere since.
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const ownsFocusRef = useRef(false);
  useEffect(() => {
    const leave = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) ownsFocusRef.current = false;
    };
    document.addEventListener('focusin', leave);
    document.addEventListener('pointerdown', leave);
    return () => {
      document.removeEventListener('focusin', leave);
      document.removeEventListener('pointerdown', leave);
    };
  }, []);
  useEffect(() => {
    // The notice's own button takes focus when it opens: the button that opened it is disabled.
    if (phase.kind === 'consent') {
      downloadRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (ownsFocusRef.current && (!active || active === document.body)) mainRef.current?.focus();
  }, [phase.kind]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const transcribe = useCallback(async () => {
    const Recognition = getLocalRecognitionCtor();
    if (!Recognition || !mountedRef.current) return;
    const replace = replaceRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'mixing', percent: 0 });
    // ESCSUITE-432: the run belongs to the project it was started in. The
    // control lives in the always-mounted timeline, so nothing else ends it:
    // New Project, Open, a host's LOAD_PROJECT or a session restore putting
    // another project in its place (a different `project.id`; Open passes
    // through New Project's fresh id even for a file of this same project)
    // aborts it at once. Ordinary edits, a rename and undo keep the id.
    const { id: projectId, timeline } = useEditorStore.getState().project;
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (state.project.id !== projectId) controller.abort();
    });
    // Settles the moment the run is stopped, so the button and the notice do
    // not wait for the core to notice (it cannot while the sound is mixed).
    const stopped = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(stoppedError()), { once: true });
    });
    // Handled even when the run ends before `stopped` is raced (an abort while loading).
    stopped.catch(() => {});
    try {
      const { transcribeTimeline } = await import('../../core/transcribe');
      // A run stopped while it mixed may still be mixing: wait for it first.
      const previous = settlingRef.current;
      if (previous) await Promise.race([previous, stopped]);
      if (controller.signal.aborted) throw stoppedError();
      const { clips, tracks } = timeline;
      const run = transcribeTimeline({
        clips,
        tracks,
        lang,
        Recognition,
        signal: controller.signal,
        onProgress: (stage, played, total) => {
          if (controller.signal.aborted) return;
          setPhase(
            stage === 'mixing'
              ? { kind: 'mixing', percent: total > 0 ? Math.floor((played / total) * 100) : 0 }
              : { kind: 'listening', played, total }
          );
        },
      });
      const settling = run.then(
        () => {},
        () => {}
      );
      settlingRef.current = settling;
      void settling.then(() => {
        if (settlingRef.current === settling) settlingRef.current = null;
      });
      const cues = await Promise.race([run, stopped]);
      // Checked again here, not only by the subscription: nothing is ever
      // added to a project the sound was not heard in.
      if (controller.signal.aborted || useEditorStore.getState().project.id !== projectId) {
        throw stoppedError();
      }
      if (cues === null) {
        showNotification('There is no sound on the timeline to transcribe.', 'info');
        return;
      }
      if (cues.length === 0) {
        showNotification('No speech was heard, so no captions were added.', 'info');
        return;
      }
      const resolution = useEditorStore.getState().project.resolution;
      const style = captionStyleFor(resolution);
      const columns = captionWrapColumns(resolution, style.fontSize);
      const result = addCaptionCues(
        cues.map((cue) => ({ ...cue, text: wrapCaptionText(cue.text, columns) })),
        style,
        { replace }
      );
      if (!result) {
        showNotification('The Captions track is locked, so no captions were added.', 'error');
        return;
      }
      const hidden = useEditorStore
        .getState()
        .project.timeline.tracks.some((track) => track.id === result.trackId && !track.visible);
      showNotification(
        `Transcribed ${result.added} caption${result.added !== 1 ? 's' : ''} onto the Captions track.` +
          (hidden ? ' The Captions track is hidden.' : ''),
        'success'
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        showNotification('Transcription stopped. No captions were added.', 'info');
      } else if (error instanceof Error && error.name === 'TranscriptionError') {
        showNotification(error.message, 'error');
      } else {
        console.error('Transcription failed:', error);
        showNotification('Could not transcribe the timeline.', 'error');
      }
    } finally {
      unsubscribe();
      if (abortRef.current === controller) abortRef.current = null;
      setPhase({ kind: 'idle' });
    }
  }, [addCaptionCues, lang, showNotification]);

  const install = useCallback(async () => {
    setPhase({ kind: 'installing' });
    const installed = await installLocalLanguagePack(lang);
    if (!mountedRef.current) return;
    if (!installed) {
      setPhase({ kind: 'idle' });
      showNotification('The speech language pack could not be installed.', 'error');
      return;
    }
    await transcribe();
  }, [lang, showNotification, transcribe]);

  const probe = useCallback(async () => {
    // The first call on the API, only ever on a press, and asked on every
    // press: a pack may have been installed, or removed, since the last one.
    const answer = await probeLocalRecognition(lang);
    if (!mountedRef.current) return;
    if (answer === 'available') await transcribe();
    else if (answer === 'downloadable') setPhase({ kind: 'consent' });
    else if (answer === 'downloading') await install();
    else {
      setHidden(true);
      showNotification('On-device speech recognition is not available in this browser.', 'info');
    }
  }, [install, lang, showNotification, transcribe]);

  const start = useCallback(async () => {
    const { tracks, clips } = useEditorStore.getState().project.timeline;
    const captionTrack = tracks.find((t) => t.kind === 'captions');
    if (captionTrack?.locked) {
      showNotification('The Captions track is locked, so no captions were added.', 'error');
      return;
    }
    // ESCSUITE-442: captions already there are not stacked on without asking.
    const existing = captionTrack ? clips.filter((clip) => clip.trackId === captionTrack.id).length : 0;
    if (existing > 0) {
      setPhase({ kind: 'question', existing });
      return;
    }
    replaceRef.current = false;
    await probe();
  }, [probe, showNotification]);

  const runOnce = useCallback(async (task: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await task();
    } finally {
      runningRef.current = false;
    }
  }, []);

  const cancelQuestion = useCallback(() => setPhase({ kind: 'idle' }), []);
  const answerQuestion = (replace: boolean) => {
    replaceRef.current = replace;
    setPhase({ kind: 'idle' });
    void runOnce(probe);
  };

  // The dialog's trap, initial focus (Cancel, the first button), Escape as
  // Cancel and focus back to the main button, as every editor modal has them.
  const questionOpen = phase.kind === 'question';
  const dialogRef = useDialogBehaviour(cancelQuestion, questionOpen);

  // Reported to `App` from the flag itself, with a cleanup, for the reasons
  // `ResolutionPicker` gives: it cannot drift from what is on screen, and an
  // unmount with the dialog up still reports it gone.
  const onDialogOpenChangeRef = useRef(onDialogOpenChange);
  useEffect(() => {
    onDialogOpenChangeRef.current = onDialogOpenChange;
  }, [onDialogOpenChange]);
  useEffect(() => {
    if (!questionOpen) return;
    onDialogOpenChangeRef.current?.(true);
    return () => onDialogOpenChangeRef.current?.(false);
  }, [questionOpen]);

  if (!supported || hidden) return null;

  const busy = phase.kind === 'mixing' || phase.kind === 'listening';
  // A live region that is always there, so each new phase is announced; the
  // running clock and the mix's percentage sit outside it so they are not read
  // out at every step.
  const status =
    phase.kind === 'mixing'
      ? 'Preparing the sound…'
      : phase.kind === 'listening'
        ? 'Transcribing on this device…'
        : phase.kind === 'installing'
          ? 'Downloading the speech language pack…'
          : '';
  return (
    <div
      ref={containerRef}
      className={styles.transcribe}
      onFocus={() => {
        ownsFocusRef.current = true;
      }}
    >
      <span className={styles.status} aria-live="polite" aria-atomic="true">
        {status}
      </span>
      {phase.kind === 'mixing' && <span className={styles.status}>{`${phase.percent}%`}</span>}
      {phase.kind === 'listening' && (
        <span className={styles.status}>{`${clock(phase.played)} / ${clock(phase.total)}`}</span>
      )}
      {phase.kind !== 'installing' && (
        <button
          ref={mainRef}
          type="button"
          className={styles.button}
          onClick={busy ? () => abortRef.current?.abort() : () => void runOnce(start)}
          disabled={phase.kind === 'consent'}
          title={
            busy
              ? undefined
              : `Make captions from the timeline's sound with your browser's on-device speech recognition (${lang})`
          }
        >
          {busy ? 'Stop transcribing' : 'Transcribe to captions'}
        </button>
      )}
      {phase.kind === 'question' && (
        <div className={styles.overlay}>
          <div
            ref={dialogRef}
            tabIndex={-1}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="transcribe-replace-title"
          >
            <h2 className={styles.dialogTitle} id="transcribe-replace-title">
              {REPLACE_QUESTION}
            </h2>
            <p className={styles.dialogMessage}>
              {`The Captions track already has ${phase.existing} caption${phase.existing !== 1 ? 's' : ''}.`}
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogButton} onClick={cancelQuestion}>
                Cancel
              </button>
              <button type="button" className={styles.dialogButton} onClick={() => answerQuestion(false)}>
                Add
              </button>
              <button type="button" className={styles.dialogPrimary} onClick={() => answerQuestion(true)}>
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
      {phase.kind === 'consent' && (
        <div className={styles.notice} role="group" aria-label="Speech language pack">
          <p className={styles.noticeText}>{LANGUAGE_PACK_NOTICE}</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.button} onClick={() => setPhase({ kind: 'idle' })}>
              Cancel
            </button>
            <button type="button" ref={downloadRef} className={styles.primary} onClick={() => void runOnce(install)}>
              Download language pack
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
