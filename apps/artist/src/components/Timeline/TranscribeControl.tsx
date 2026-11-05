import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { captionStyleFor, captionWrapColumns, wrapCaptionText } from '../../core/captions';
import {
  getLocalRecognitionCtor,
  installLocalLanguagePack,
  probeLocalRecognition,
  transcriptionLanguage,
  type LocalSpeechAvailability,
} from '../../core/speechRecognitionLocal';
import styles from './TranscribeControl.module.css';

/** The notice shown before the browser downloads a language pack (ESCSUITE-404). Owner-approved wording. */
export const LANGUAGE_PACK_NOTICE =
  'Your browser will download a speech language pack once. Your audio never leaves this device.';

type Phase =
  | { kind: 'idle' }
  | { kind: 'consent' }
  | { kind: 'installing' }
  | { kind: 'mixing' }
  | { kind: 'listening'; played: number; total: number };

interface TranscribeControlProps {
  showNotification: (message: string, type: 'error' | 'success' | 'info') => void;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * "Transcribe to captions" (ESCSUITE-404), in the timeline's controls.
 *
 * Renders **nothing** unless the browser can recognise speech on this device:
 * a `SpeechRecognition` with the on-device mode, whose `available()` — asked
 * with `processLocally: true` for the browser's language — answers anything
 * but `unavailable`. The transcription itself (`core/transcribe.ts`) is a
 * dynamic `import()` on the first click.
 *
 * A `downloadable` answer shows `LANGUAGE_PACK_NOTICE` first, and the browser
 * downloads the pack only when the user presses "Download language pack". The
 * cues land on the Captions track through `addCaptionCues`: one history
 * entry, so one undo takes the whole transcription back off.
 */
export function TranscribeControl({ showNotification }: TranscribeControlProps) {
  const lang = transcriptionLanguage();
  const [availability, setAvailability] = useState<LocalSpeechAvailability | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // One run at a time: a second press while the first is still asking the
  // browser (before the button turns into "Stop transcribing") is ignored.
  const runningRef = useRef(false);
  // Nothing starts listening after the editor has gone, e.g. once a language
  // pack the user asked for finishes installing.
  const mountedRef = useRef(true);
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

  useEffect(() => {
    let live = true;
    void probeLocalRecognition(lang).then((answer) => {
      if (live) setAvailability(answer);
    });
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [lang]);

  const transcribe = useCallback(async () => {
    const Recognition = getLocalRecognitionCtor();
    if (!Recognition || !mountedRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'mixing' });
    try {
      const { transcribeTimeline } = await import('../../core/transcribe');
      const { clips, tracks } = useEditorStore.getState().project.timeline;
      const cues = await transcribeTimeline({
        clips,
        tracks,
        lang,
        Recognition,
        signal: controller.signal,
        onProgress: (stage, played, total) => {
          if (controller.signal.aborted) return;
          setPhase(stage === 'mixing' ? { kind: 'mixing' } : { kind: 'listening', played, total });
        },
      });
      if (controller.signal.aborted) return;
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
        style
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
    setAvailability('available');
    await transcribe();
  }, [lang, showNotification, transcribe]);

  const start = useCallback(async () => {
    const captionTrack = useEditorStore.getState().project.timeline.tracks.find((t) => t.kind === 'captions');
    if (captionTrack?.locked) {
      showNotification('The Captions track is locked, so no captions were added.', 'error');
      return;
    }
    // Asked again: a pack may have been installed, or removed, since the editor opened.
    const answer = await probeLocalRecognition(lang);
    if (!mountedRef.current) return;
    setAvailability(answer);
    if (answer === 'available') await transcribe();
    else if (answer === 'downloadable') setPhase({ kind: 'consent' });
    else if (answer === 'downloading') await install();
    else showNotification('On-device speech recognition is not available in this browser.', 'info');
  }, [install, lang, showNotification, transcribe]);

  const runOnce = useCallback(async (task: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await task();
    } finally {
      runningRef.current = false;
    }
  }, []);

  if (availability === null || availability === 'unavailable') return null;

  const busy = phase.kind === 'mixing' || phase.kind === 'listening';
  // A live region that is always there, so each new phase is announced; the
  // running clock sits outside it so it is not read out every second.
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
