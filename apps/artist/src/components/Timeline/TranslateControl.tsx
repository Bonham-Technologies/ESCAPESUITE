import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/projectStore';
import type { Clip, Track } from '../../store/types';
import { captionWrapColumns, wrapCaptionText } from '../../core/captions';
import { transcriptionLanguage } from '../../core/speechRecognitionLocal';
import { canonicalLanguageTag, languageName } from '../../core/transcriptionLanguage';
import {
  createTranslator,
  detectLanguage,
  getTranslatorCtor,
  probeTranslation,
  type TranslatorLanguagePair,
  type TranslatorLike,
} from '../../core/translatorLocal';
import {
  defaultTranslationTarget,
  readStoredTranslationLanguage,
  sameTranslationLanguage,
  storeTranslationLanguage,
  translationLanguageOptions,
  translationModelNotice,
  translationTrackName,
  translatorLanguage,
} from '../../core/translationLanguage';
// The same row, notice and select as "Transcribe to captions", on purpose.
import styles from './TranscribeControl.module.css';

/** The most caption text handed to the Language Detector, in characters. */
const DETECT_SAMPLE_CHARS = 2000;

/** What the pending press is translating: the source track and its language, once known. */
interface Request {
  /** The project the press was made in: the run belongs to it (ESCSUITE-432's rule). */
  projectId: string;
  sourceTrackId: string;
  target: string;
  /** The captions' language, as the Translator API is asked for it. */
  source?: string;
  /** Write `source` to the source track: the user confirmed it, the track did not say. */
  confirmed?: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'source'; detected: boolean }
  | { kind: 'consent'; source: string; target: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'translating'; done: number; total: number };

interface TranslateControlProps {
  showNotification: (message: string, type: 'error' | 'success' | 'info') => void;
}

function stoppedError(): DOMException {
  return new DOMException('Translation stopped', 'AbortError');
}

/** The source caption track: the first caption track, the one imports and transcription use. */
function sourceTrackOf(tracks: Track[]): Track | undefined {
  return tracks.find((track) => track.kind === 'captions');
}

/** The source track's captions, in timeline order. */
function captionsOn(clips: Clip[], trackId: string): Clip[] {
  return clips
    .filter((clip) => clip.trackId === trackId && clip.overlayType === 'text' && typeof clip.textData?.text === 'string')
    .sort((a, b) => a.timelinePosition - b.timelinePosition);
}

/** A cue's words on one line: it is translated as a sentence and wrapped again after. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * "Translate captions" (ESCSUITE-473), in the timeline's controls beside
 * "Transcribe to captions".
 *
 * Renders **nothing** unless the browser has the Translator API, decided by
 * static detection alone (`getTranslatorCtor`): nothing on the API is called
 * until the user presses the button. On the press it translates the first
 * caption track into the language chosen in the select beside it:
 *
 * 1. The captions' language is the track's own (`Track.language`, set by a
 *    transcription or an earlier confirmation). When the track does not say
 *    (an imported file), the Language Detector suggests one — only if its
 *    model is already installed — and the user confirms or changes it.
 * 2. `Translator.availability()` is asked for the pair. `downloadable` shows
 *    `translationModelNotice` first, and the browser downloads the model only
 *    when the user presses "Download translation model"; Cancel downloads
 *    nothing. `unavailable` says so and the control stays, since another pair
 *    may work.
 * 3. Each cue is translated on this device and the cues land, through
 *    `addCaptionTranslation`, on a new caption track marked with the target
 *    language, every cue at its source cue's exact times: one history entry,
 *    so one undo takes the translation back off.
 *
 * A run belongs to the project it was started in (as ESCSUITE-432 has
 * transcription do): another project taking its place stops it, adding
 * nothing.
 */
export function TranslateControl({ showNotification }: TranslateControlProps) {
  const [browserLanguage] = useState(() => canonicalLanguageTag(transcriptionLanguage()) ?? 'en-US');
  const [target, setTarget] = useState(() => readStoredTranslationLanguage() ?? defaultTranslationTarget(browserLanguage));
  const targets = useMemo(() => translationLanguageOptions(target), [target]);
  // Static detection only: calls nothing on the API (see above).
  const [supported] = useState(() => getTranslatorCtor() !== null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // The captions' language, while the user is asked to confirm it.
  const [sourceChoice, setSourceChoice] = useState('en');
  const sources = useMemo(() => translationLanguageOptions(sourceChoice), [sourceChoice]);
  const requestRef = useRef<Request | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const mountedRef = useRef(true);
  const addCaptionTranslation = useEditorStore((state) => state.addCaptionTranslation);

  // Keyboard focus, as "Transcribe to captions" keeps it: the main button stays
  // one element, a notice's own control takes focus when it opens, and focus
  // comes back to the main button when what had it goes away — only if it was
  // in this control and the user has not moved it since.
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const noticeFocusRef = useRef<HTMLButtonElement | HTMLSelectElement | null>(null);
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
    if (phase.kind === 'source' || phase.kind === 'consent') {
      noticeFocusRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (ownsFocusRef.current && (!active || active === document.body)) mainRef.current?.focus();
  }, [phase.kind]);

  // A question or notice belongs to the project it was asked about: another
  // project taking its place closes it, so a confirm cannot translate (or
  // download a model for) captions that are no longer open.
  useEffect(() => {
    if (phase.kind !== 'source' && phase.kind !== 'consent') return;
    const projectId = requestRef.current?.projectId;
    return useEditorStore.subscribe((state) => {
      if (state.project.id === projectId) return;
      requestRef.current = null;
      setPhase({ kind: 'idle' });
    });
  }, [phase.kind]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Translate and add the track. Called straight from a click where the model
   * has to be downloaded: `createTranslator` runs before anything is awaited,
   * because the browser only downloads a model inside a user gesture.
   */
  const translate = useCallback(
    async (request: Request, pair: TranslatorLanguagePair, downloads: boolean) => {
      // ESCSUITE-432's rule: the run belongs to the project the press was made
      // in. Checked before `create()`, so no model is fetched for captions
      // that are no longer open.
      const { id: projectId, timeline } = useEditorStore.getState().project;
      if (projectId !== request.projectId) {
        showNotification('Translation stopped. No captions were added.', 'info');
        if (mountedRef.current) setPhase({ kind: 'idle' });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const cues = captionsOn(timeline.clips, request.sourceTrackId);
      let translator: TranslatorLike | null = null;
      // A state update, not an await: `create()` below still runs inside the click.
      setPhase(downloads ? { kind: 'downloading', percent: 0 } : { kind: 'translating', done: 0, total: cues.length });
      const creating = createTranslator(pair, {
        signal,
        onProgress: (fraction) => {
          if (!signal.aborted && mountedRef.current) setPhase({ kind: 'downloading', percent: Math.floor(fraction * 100) });
        },
      });
      // ESCSUITE-432's rule: the run belongs to this project.
      const unsubscribe = useEditorStore.subscribe((state) => {
        if (state.project.id !== projectId) controller.abort();
      });
      const stopped = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(stoppedError()), { once: true });
      });
      stopped.catch(() => {});
      let stage: 'create' | 'translate' = 'create';
      try {
        translator = await Promise.race([creating, stopped]);
        stage = 'translate';
        if (mountedRef.current) setPhase({ kind: 'translating', done: 0, total: cues.length });
        const translations: Array<{ clipId: string; text: string }> = [];
        for (const cue of cues) {
          const text = oneLine(cue.textData!.text);
          const translated = text ? await Promise.race([translator.translate(text, { signal }), stopped]) : '';
          translations.push({ clipId: cue.id, text: String(translated ?? '').trim() });
          if (mountedRef.current) setPhase({ kind: 'translating', done: translations.length, total: cues.length });
        }
        // Checked again here, not only by the subscription: nothing is ever
        // added to a project the captions were not read from.
        if (signal.aborted || useEditorStore.getState().project.id !== projectId) throw stoppedError();
        const resolution = useEditorStore.getState().project.resolution;
        const wrapped = translations.map(({ clipId, text }) => {
          const fontSize = cues.find((cue) => cue.id === clipId)!.textData!.fontSize;
          return { clipId, text: wrapCaptionText(text, captionWrapColumns(resolution, fontSize)) };
        });
        const result = addCaptionTranslation(request.sourceTrackId, wrapped, {
          language: request.target,
          trackName: translationTrackName(request.target),
          ...(request.confirmed && request.source ? { sourceLanguage: request.source } : {}),
        });
        if (!result) {
          showNotification('The captions were removed while they were translated, so nothing was added.', 'error');
          return;
        }
        showNotification(
          `Translated ${result.added} caption${result.added !== 1 ? 's' : ''} into ${languageName(request.target)} on a new caption track.`,
          'success'
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          showNotification('Translation stopped. No captions were added.', 'info');
        } else if (stage === 'create') {
          console.error('Translator could not be created:', error);
          showNotification(
            downloads ? 'The translation model could not be downloaded.' : 'The browser could not start translating.',
            'error'
          );
        } else {
          console.error('Translation failed:', error);
          showNotification('Could not translate the captions.', 'error');
        }
      } finally {
        unsubscribe();
        translator?.destroy?.();
        if (abortRef.current === controller) abortRef.current = null;
        if (mountedRef.current) setPhase({ kind: 'idle' });
      }
    },
    [addCaptionTranslation, showNotification]
  );

  /** Ask the browser about the pair, once the captions' language is known. */
  const probe = useCallback(
    async (request: Request) => {
      const source = request.source!;
      if (sameTranslationLanguage(source, request.target)) {
        showNotification(`The captions are already in ${languageName(translatorLanguage(source) ?? source)}.`, 'info');
        return;
      }
      const pair = { sourceLanguage: translatorLanguage(source)!, targetLanguage: translatorLanguage(request.target)! };
      // The first call on the Translator API, only ever on a press, and asked
      // on every press: a model may have been installed, or removed, since.
      const answer = await probeTranslation(pair);
      if (!mountedRef.current) return;
      if (useEditorStore.getState().project.id !== request.projectId) {
        showNotification('Translation stopped. No captions were added.', 'info');
        return;
      }
      requestRef.current = request;
      if (answer === 'available') await translate(request, pair, false);
      else if (answer === 'downloading') await translate(request, pair, true);
      else if (answer === 'downloadable') setPhase({ kind: 'consent', source: pair.sourceLanguage, target: pair.targetLanguage });
      else {
        showNotification(
          `Translating ${languageName(pair.sourceLanguage)} to ${languageName(pair.targetLanguage)} is not available in this browser.`,
          'info'
        );
      }
    },
    [showNotification, translate]
  );

  const start = useCallback(async () => {
    const { id: projectId, timeline } = useEditorStore.getState().project;
    const { tracks, clips } = timeline;
    const sourceTrack = sourceTrackOf(tracks);
    const cues = sourceTrack ? captionsOn(clips, sourceTrack.id) : [];
    if (!sourceTrack || cues.length === 0) {
      showNotification('There are no captions to translate.', 'info');
      return;
    }
    if (tracks.some((track) => track.kind === 'captions' && track.id !== sourceTrack.id && sameTranslationLanguage(track.language, target))) {
      showNotification(`This project already has a caption track in ${languageName(target)}.`, 'info');
      return;
    }
    const request: Request = { projectId, sourceTrackId: sourceTrack.id, target };
    if (sourceTrack.language && translatorLanguage(sourceTrack.language)) {
      await probe({ ...request, source: sourceTrack.language });
      return;
    }
    // The track does not say what language it is in: suggest one (only from a
    // detector model already installed, never downloading one) and ask.
    const sample = cues.map((cue) => oneLine(cue.textData!.text)).join(' ').slice(0, DETECT_SAMPLE_CHARS);
    const detected = await detectLanguage(sample);
    // Nothing has been asked of the translator yet: a project replaced
    // meanwhile simply ends the press.
    if (!mountedRef.current || useEditorStore.getState().project.id !== projectId) return;
    const suggestion = translatorLanguage(detected ?? '') ?? translatorLanguage(browserLanguage) ?? 'en';
    requestRef.current = request;
    setSourceChoice(suggestion);
    setPhase({ kind: 'source', detected: detected !== null });
  }, [browserLanguage, probe, showNotification, target]);

  const runOnce = useCallback(async (task: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await task();
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, []);

  const confirmSource = () => {
    const request = requestRef.current;
    setPhase({ kind: 'idle' });
    if (request) void runOnce(() => probe({ ...request, source: sourceChoice, confirmed: true }));
  };

  const confirmDownload = () => {
    const request = requestRef.current;
    if (phase.kind !== 'consent' || !request) return;
    const pair = { sourceLanguage: phase.source, targetLanguage: phase.target };
    // Synchronously into `translate`, so `create()` runs inside this click.
    void runOnce(() => translate(request, pair, true));
  };

  const cancel = () => {
    requestRef.current = null;
    setPhase({ kind: 'idle' });
  };

  if (!supported) return null;

  const busy = phase.kind === 'downloading' || phase.kind === 'translating';
  const status =
    phase.kind === 'downloading'
      ? 'Downloading the translation model…'
      : phase.kind === 'translating'
        ? 'Translating on this device…'
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
      {phase.kind === 'downloading' && <span className={styles.status}>{`${phase.percent}%`}</span>}
      {phase.kind === 'translating' && <span className={styles.status}>{`${phase.done} / ${phase.total}`}</span>}
      <select
        className={styles.language}
        aria-label="Translation language"
        title="The language to translate the captions into"
        value={target}
        disabled={running || phase.kind !== 'idle'}
        onChange={(event) => {
          setTarget(event.target.value);
          storeTranslationLanguage(event.target.value);
        }}
      >
        {targets.map((tag) => (
          <option key={tag} value={tag}>
            {languageName(tag)}
          </option>
        ))}
      </select>
      <button
        ref={mainRef}
        type="button"
        className={styles.button}
        onClick={busy ? () => abortRef.current?.abort() : () => void runOnce(start)}
        disabled={phase.kind === 'source' || phase.kind === 'consent'}
        title={busy ? undefined : `Translate the captions into ${languageName(target)} with your browser's on-device translation`}
      >
        {busy ? 'Stop translating' : 'Translate captions'}
      </button>
      {phase.kind === 'source' && (
        <div className={styles.notice} role="group" aria-label="Language of the captions">
          <p className={styles.noticeText}>
            {phase.detected
              ? `These captions look like ${languageName(sourceChoice)}. Is that the language they are in?`
              : 'Which language are the captions in?'}
          </p>
          <div className={styles.noticeActions}>
            <select
              ref={(element) => {
                noticeFocusRef.current = element;
              }}
              className={styles.language}
              aria-label="Captions language"
              value={sourceChoice}
              onChange={(event) => setSourceChoice(event.target.value)}
            >
              {sources.map((tag) => (
                <option key={tag} value={tag}>
                  {languageName(tag)}
                </option>
              ))}
            </select>
            <button type="button" className={styles.button} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={styles.primary} onClick={confirmSource}>
              Continue
            </button>
          </div>
        </div>
      )}
      {phase.kind === 'consent' && (
        <div className={styles.notice} role="group" aria-label="Translation model">
          <p className={styles.noticeText}>{translationModelNotice(phase.source, phase.target)}</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.button} onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              ref={(element) => {
                noticeFocusRef.current = element;
              }}
              className={styles.primary}
              onClick={confirmDownload}
            >
              Download translation model
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
