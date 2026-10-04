// The take itself: countdown, start, pause, resume, stop, cancel, the two
// interval tickers, and the teardown that runs when the screen goes away.
//
// Four kinds of ref are created here and nowhere else — the recorder, the
// cancelled flag, the attempt token and the two interval handles — because each
// is written by one path and read by three. The cancelled flag in particular is
// reset by handleStartRecording, raised by handleCancelRecording, by
// cancelCountdown and by the unmount teardown, and read by the recorder's
// onStop: a second copy of it would let a late chunk from a thrown-away take be
// saved. The attempt token says which start owns the app, so a start that
// resumes after the user moved on releases what it was handed instead of
// building on it (ESCSUITE-109).
//
// The recorder's six callbacks are captured once, when createRecorder runs, so
// they close over the stopAllStreams and saveRecording of the render that
// started the take. That is deliberate: a late onStop has to release the
// capture that take was using, not whatever the current render holds — but
// only while that recorder is still the current one. A superseded recorder's
// callbacks release nothing at all: the `me` guard on each of them (ESCSUITE-118)
// returns before touching stopAllStreams, saveRecording or anything else.
//
// This hook registers one effect — the unmount teardown — and App calls it
// after useMediaStreams so that the stopAllStreams mirror is already being
// kept up to date when the teardown reaches for it.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  canUseWebCodecsRecorder,
  createRecorder,
  getRecorderType,
  type AnyRecorder,
} from '../core/recorder-factory';
import { hasSystemAudio, stopStream } from '../core/permissions';
import {
  CAPTURE_REFUSED,
  CAPTURE_UNANSWERED,
  MIC_UNAVAILABLE,
  NO_SYSTEM_AUDIO,
  SAVE_FAILED,
  START_FAILED,
  SEPARATE_TRACK_NOT_SAVED,
} from '../utils/notices';
import { Compositor } from '../core/compositor';
import { analytics } from '../utils/analytics';
import { drawThumbnail } from '../utils/previewThumbnail';
import { useRecorderStore } from '../store/recorderStore';
import type { AudioLevels, RecordingConfig, RecordingState } from '../store/types';
import type { AcquiredStreams, AcquisitionResult } from './useMediaStreams';
import type { SaveRecording } from './useRecordingSave';

export interface RecordingControllerDeps {
  config: RecordingConfig;
  setState: (state: RecordingState) => void;
  setCountdown: (value: number) => void;
  setCurrentDuration: (duration: number) => void;
  setAudioLevels: (levels: AudioLevels) => void;
  setStreams: (screen: MediaStream | null, webcam: MediaStream | null) => void;
  /** From useMediaStreams: the capture, the release, and the handles both use. */
  acquireStreams: (onPartial?: (partial: AcquiredStreams) => void) => Promise<AcquisitionResult>;
  stopAllStreams: () => void;
  stopAllStreamsRef: RefObject<() => void>;
  compositorRef: RefObject<Compositor | null>;
  micStreamRef: RefObject<MediaStream | null>;
  previewRef: RefObject<HTMLVideoElement | null>;
  setPreviewStream: (stream: MediaStream | null) => void;
  setIsPiPActive: (active: boolean) => void;
  /** Written here at createRecorder time, read by saveRecording. */
  recorderTypeRef: RefObject<'webcodecs' | 'mediarecorder'>;
  /**
   * Written by handleStopRecording (past its own `cancelledRef` guard — see
   * there), read and cleared by saveRecording. The authoritative clear for
   * every path that throws a take away instead of saving it is
   * `handleStartRecording`'s own, beside `setNotice(null)`: a new take never
   * inherits the previous one's frame, whether that take was thrown away by
   * a cancel, the unmount teardown, the recorder's own `onError`, or a save
   * that rejected before `useRecordingSave` reached its clear (ESCSUITE-176).
   * Both cancels and the teardown also clear it immediately, on their own,
   * rather than leaving a stale frame referenced until the next start.
   */
  capturedThumbnailRef: RefObject<Blob | null>;
  saveRecording: SaveRecording;
  /** The one notice channel — see utils/notices.ts. Cleared when a take starts. */
  setNotice: (notice: string | null) => void;
  /** Whether a system-audio track actually arrived; greys the System meter. */
  setSystemAudioShared: (shared: boolean) => void;
  /**
   * Re-read the storage headroom. Called *after* a take, never before one:
   * see the comment on the acquisition below.
   */
  refreshStorageSpace: () => Promise<void>;
}

/**
 * How long ESCAPECRAFT waits for the browser to answer a capture request before
 * it gives the user the app back (ESCSUITE-109).
 *
 * Generous on purpose, and deliberately not tunable: the share picker is a
 * dialog a user may legitimately leave sitting while they find the window they
 * meant to share, or while they read the camera prompt. A minute is long enough
 * that no real answer is ever cut off, and short enough that a request nobody
 * is going to answer — a wedged camera driver, a prompt on a screen the user
 * has walked away from — is not a dead end with no way out but a reload.
 */
export const CAPTURE_TIMEOUT_MS = 60_000;

/** Give back every capture one request handed over. */
function releaseAcquired({ screen, webcam, mic }: AcquiredStreams): void {
  stopStream(screen);
  stopStream(webcam);
  stopStream(mic);
}

/**
 * The DOMException name behind a start failure.
 *
 * `core/permissions.ts`'s `requestScreenCapture`/`requestWebcam`/
 * `requestMicrophone` each catch the browser's own error and rethrow
 * `new Error('…', { cause })` — a plain `Error` whose own `.name` is just
 * `'Error'`, with the browser's `DOMException` (and its real name) carried as
 * `cause`. Reading `.name` off the error itself (ESCSUITE-210's bug) was
 * therefore always reading the wrapper's name, never the browser's, and
 * `CAPTURE_REFUSED` below could never fire. `error.cause ?? error` falls back
 * to the error itself for anything that was not wrapped — a bare
 * `DOMException`, as the deadline-release path above can still produce.
 */
function failureName(error: unknown): string | undefined {
  const err = error as { name?: string; cause?: unknown } | null | undefined;
  return ((err?.cause ?? err) as { name?: string } | null | undefined)?.name;
}

/**
 * Why a take never started, as far as the user needs to know.
 *
 * `NotAllowedError` is the browser refusing the capture — the picker was
 * cancelled, the permission is denied, or the click's user activation had
 * expired by the time `getDisplayMedia` ran. It is worth its own sentence
 * because "nothing happened" is otherwise indistinguishable from a bug.
 * `NotFoundError` (no screen/camera/microphone to capture) is a different
 * fact and is left under the generic `START_FAILED` sentence — a dedicated
 * sentence for it is a product call this fix does not make.
 */
function startFailureNotice(error: unknown): string {
  return failureName(error) === 'NotAllowedError' ? CAPTURE_REFUSED : START_FAILED;
}

export interface RecordingController {
  cancelCountdown: () => void;
  handleCancelRecording: () => void;
  handlePauseRecording: () => void;
  handleResumeRecording: () => void;
  handleStopRecording: () => Promise<void>;
  handleStartRecording: () => Promise<void>;
}

/**
 * The currently-mounted controller's full teardown, or `null` when none is
 * mounted. Set and cleared by the one `useRecordingController` instance a
 * real app ever has — see the registration effect inside the hook below.
 */
let liveSessionDispose: (() => void) | null = null;

/**
 * Give back whatever the current take is holding — the recorder, every
 * acquired track, the tickers, the meters — from outside React.
 *
 * `main.tsx` hands this to the app's `ErrorBoundary` as `onError`
 * (ESCSUITE-212): a render-time throw anywhere in CRAFT's tree must not
 * leave a live recorder capturing into a UI nobody can see or stop. A no-op
 * when nothing is mounted — before the app has rendered once, or after it
 * has already torn itself down — is the right answer rather than a thing to
 * guard against upstream, since the `ErrorBoundary` cannot know which is
 * true when it calls this.
 */
export function disposeLiveRecordingSession(): void {
  liveSessionDispose?.();
}

export function useRecordingController({
  config,
  setState,
  setCountdown,
  setCurrentDuration,
  setAudioLevels,
  setStreams,
  acquireStreams,
  stopAllStreams,
  stopAllStreamsRef,
  compositorRef,
  micStreamRef,
  previewRef,
  setPreviewStream,
  setIsPiPActive,
  recorderTypeRef,
  capturedThumbnailRef,
  saveRecording,
  setNotice,
  setSystemAudioShared,
  refreshStorageSpace,
}: RecordingControllerDeps): RecordingController {
  const recorderRef = useRef<AnyRecorder | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  // A recorder can flush its last chunk — and call onStop — after the take has
  // been cancelled or the screen has gone away. The blob is then nobody's: it
  // belongs to a recording the user threw away, and must not be saved.
  const cancelledRef = useRef(false);
  // Which start owns the app: the token of the attempt in flight, or null when
  // there is none. `state` is the *rendered* truth and is one render behind the
  // click, so two fast clicks — or two R presses — both saw 'idle' and both ran:
  // two pickers, two compositors, and a second `recorderRef.current =` that
  // orphaned the first recorder with its AudioContext, its rAF level monitor and
  // its muxer, and nothing left that could ever dispose them. A non-null token
  // is the synchronous truth that answers that (ESCSUITE-93).
  //
  // It is a token rather than the boolean it replaces because the boolean could
  // only be dropped when the attempt *settled* (ESCSUITE-109): a take cancelled
  // while the picker was still on screen left Record inert until that picker was
  // answered — for a picker nobody ever answers, for the rest of the session,
  // with nothing said about it. Both cancels and the unmount teardown drop the
  // token instead, which does both halves at once: Record is free at cancel
  // time, and the attempt that resumes afterwards finds a token that is no
  // longer its own and releases what it was handed rather than building on it.
  //
  // Identity is all the token has to carry, so it is an empty object rather than
  // a counter: a counter can say which attempt is newest, but not whether any
  // attempt is in flight, which is the question the one-start-at-a-time gate
  // asks.
  const attemptRef = useRef<object | null>(null);

  // Capture thumbnail from preview (video element or compositor canvas)
  const capturePreviewThumbnail = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      // Try compositor canvas first (PiP mode)
      if (compositorRef.current) {
        const srcCanvas = compositorRef.current.getCanvas();
        if (srcCanvas.width > 0) {
          const result = drawThumbnail(srcCanvas);
          if (result) {
            result.then(resolve);
            return;
          }
          // Fall through to video element
        }
      }

      // Fall back to video element (screen-only / webcam-only modes)
      const video = previewRef.current;
      if (!video || video.videoWidth === 0) {
        resolve(null);
        return;
      }

      const result = drawThumbnail(video);
      if (result) {
        result.then(resolve);
      } else {
        resolve(null);
      }
    });
  }, [compositorRef, previewRef]);

  // The recorder is built and initialize()d before the countdown even starts,
  // so by then it already owns an AudioContext, a level monitor looping on rAF
  // and — on the fallback capture path — a <video> in the document. Every exit
  // from a take has to give those back, which is why disposal lives in one
  // place that cancel, error and teardown all call.
  const disposeRecorder = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.dispose();
      recorderRef.current = null;
    }
  }, []);

  const clearCountdownTicker = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const clearDurationTicker = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  /**
   * Every path that ends a take — a stop, a cancel from either the countdown
   * or a live take, and the unmount teardown — shares this one write
   * (ESCSUITE-114). `dispose()` cancels the monitor's rAF loop without
   * emitting, so a cancel or Escape that reaches it only through
   * `disposeRecorder()` would otherwise leave the store holding whatever
   * level the take last read, for a countdown that starts right back up:
   * `showMeters` is already true in `'countdown'`, and the take's own
   * monitor has not run yet.
   */
  const zeroAudioLevels = useCallback(() => {
    setAudioLevels({ microphone: 0, system: 0 });
  }, [setAudioLevels]);

  /**
   * Give back everything a live take is holding — the recorder, every
   * acquired track, the two tickers, the meters — and drop the store back to
   * idle. Shared by the unmount teardown below and by
   * `disposeLiveRecordingSession` (ESCSUITE-212), which calls this directly,
   * synchronously, from the app's `ErrorBoundary.onError`: a render-time
   * throw anywhere in the tree unmounts this component too, which would run
   * this same body as the effect's own cleanup, but that happens on React's
   * schedule relative to `componentDidCatch`, not guaranteed to happen first
   * — and a live recorder captures audio and video for every tick it is not
   * disposed. Calling it twice is harmless: `disposeRecorder()` and
   * `stopAllStreamsRef.current()` are each already idempotent (ESCSUITE-114 /
   * ESCSUITE-116), so whichever of the two call sites runs first does the
   * real work and the other finds nothing left to release.
   */
  const disposeSession = useCallback(() => {
    cancelledRef.current = true;
    // Whatever start is still in flight belongs to a screen that has gone: it
    // resumes into a component nobody can see, and must build nothing.
    attemptRef.current = null;
    clearDurationTicker();
    clearCountdownTicker();
    disposeRecorder();
    stopAllStreamsRef.current();
    zeroAudioLevels();
    // ESCSUITE-176: the frame `handleStopRecording` grabs is written before
    // `recorder.stop()` even resolves, so a take thrown away here can leave
    // one behind — nobody calls `handleStopRecording` on this path, and
    // `useRecordingSave` only clears the ref once a save actually runs. Left
    // alone, the *next* take to end on its own (the recorder's own onStop,
    // not through a Stop click) would be saved with this screen's last frame.
    capturedThumbnailRef.current = null;

    // The store is a module singleton: it outlives this component. Left as it
    // was, the next mount would come up mid-take — 'recording' with a duration
    // and a countdown from a take whose recorder and capture are both gone.
    const recorder = useRecorderStore.getState();
    recorder.setState('idle');
    recorder.setCurrentDuration(0);
    recorder.setCountdown(0);
  }, [capturedThumbnailRef, clearCountdownTicker, clearDurationTicker, disposeRecorder, stopAllStreamsRef, zeroAudioLevels]);

  // Registered for as long as this component is mounted, so
  // `disposeLiveRecordingSession` has something to call from outside React —
  // there is exactly one `useRecordingController` instance in a real session
  // (and at most one in a test), so a module-level slot is enough; see the
  // export below.
  useEffect(() => {
    liveSessionDispose = disposeSession;
    return () => {
      liveSessionDispose = null;
      disposeSession();
    };
  }, [disposeSession]);

  // Cancel countdown
  const cancelCountdown = useCallback(() => {
    // The same shape as handleCancelRecording: a cancel is a cancel, whichever
    // control raised it (ESCSUITE-109). Before this, this one was visible to the
    // post-initialize guard only through the recorder ref it nulled, and to a
    // start still parked on its capture request not at all.
    cancelledRef.current = true;
    attemptRef.current = null;
    clearCountdownTicker();
    disposeRecorder();
    zeroAudioLevels();
    // ESCSUITE-176: see the unmount teardown's comment above — the same frame
    // would otherwise outlive a countdown nobody ever let finish.
    capturedThumbnailRef.current = null;
    setState('idle');
    stopAllStreams();
  }, [capturedThumbnailRef, clearCountdownTicker, disposeRecorder, setState, stopAllStreams, zeroAudioLevels]);

  // Cancel recording
  const handleCancelRecording = useCallback(() => {
    cancelledRef.current = true;
    // Frees Record now, not when the capture request this take may still be
    // parked on finally settles (ESCSUITE-109).
    attemptRef.current = null;
    clearDurationTicker();
    disposeRecorder();
    zeroAudioLevels();
    // ESCSUITE-176: see the unmount teardown's comment above.
    capturedThumbnailRef.current = null;

    setState('idle');
    setCurrentDuration(0);
    stopAllStreams();
  }, [capturedThumbnailRef, clearDurationTicker, disposeRecorder, setState, setCurrentDuration, stopAllStreams, zeroAudioLevels]);

  // Pause recording
  const handlePauseRecording = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.pause();
    }
  }, []);

  // Resume recording
  const handleResumeRecording = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.resume();
    }
  }, []);

  // Stop recording
  const handleStopRecording = useCallback(async () => {
    clearDurationTicker();

    // Capture thumbnail from live preview BEFORE stopping (more reliable than from blob)
    const frame = await capturePreviewThumbnail();
    // A cancel (or the unmount teardown) can land while that grab was still
    // in flight — capturePreviewThumbnail's own canvas.toBlob is a real async
    // hop, and nothing sets 'saving' until the recorder's onStop, so Cancel
    // is still on screen throughout (ESCSUITE-176). Either already cleared
    // the ref and disposed the recorder; writing the frame back here would
    // re-arm the exact bug item 1 fixed, for the next take that ends on its
    // own.
    if (cancelledRef.current) return;
    capturedThumbnailRef.current = frame;

    if (recorderRef.current) {
      await recorderRef.current.stop();
    }
  }, [capturePreviewThumbnail, capturedThumbnailRef, clearDurationTicker]);

  // Start the actual recording
  const startRecording = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.start();
    }
  }, []);

  // Start countdown before recording
  const startCountdown = useCallback(() => {
    setState('countdown');
    setCountdown(config.countdownSeconds);

    countdownIntervalRef.current = window.setInterval(() => {
      const currentValue = useRecorderStore.getState().countdownValue;
      if (currentValue <= 1) {
        clearCountdownTicker();
        startRecording();
      } else {
        setCountdown(currentValue - 1);
      }
    }, 1000);
  }, [clearCountdownTicker, config.countdownSeconds, setState, setCountdown, startRecording]);

  // Handle start recording button
  const handleStartRecording = useCallback(async () => {
    // One start at a time. The rendered `state` cannot say this — it is written
    // below and read a render later — so a second click inside the same tick is
    // dropped here (ESCSUITE-93). A cancel drops the token, so the click *after*
    // a cancel is not dropped even while the abandoned request is still out
    // there (ESCSUITE-109).
    if (attemptRef.current !== null) return;
    const myAttempt: object = {};
    attemptRef.current = myAttempt;
    try {
      cancelledRef.current = false;
      // Starting a take is the "next successful action" that clears whatever
      // the last one had to report. The System meter goes back with it. The
      // flag is NOT display-only: `useRecordingSave` reads it at save time to
      // decide the stored `hasAudio` (ESCSUITE-62), so it must describe the
      // take just finished until the next one starts — which is exactly when
      // it is reset, here, and nowhere else.
      setNotice(null);
      // A new take never inherits the previous one's frame (ESCSUITE-176): a
      // discard path that does not run through a save — onError, or a save
      // that rejects before useRecordingSave.ts clears this itself — would
      // otherwise leave the ref holding the last take's picture for however
      // long it takes the *next* take to reach handleStopRecording's own
      // write, or forever if that next take ends on its own ("Stop sharing").
      capturedThumbnailRef.current = null;
      setSystemAudioShared(true);
      setState('preparing');

      // NOTHING MAY BE AWAITED BETWEEN HERE AND acquireStreams(). It calls
      // requestScreenCapture -> getDisplayMedia, which needs the click's user
      // activation; an await in front of it can spend that activation (WebKit
      // forwards a gesture across promises only briefly), and the
      // NotAllowedError that follows is a failure the user never asked for.
      // Storage headroom is measured off this path instead — on mount, after
      // each save, after each delete — and read back through
      // `recordBlockedReason`, so a take with nowhere to go is refused by a
      // disabled button before the click ever happens.

      // Whatever acquireStreams has handed over so far, updated after each
      // stage lands. `expired` starts false and flips true the moment the
      // clock wins below; a stage that lands *after* that — the camera prompt
      // finally answered a minute late, well past the deadline release — is
      // released the instant `onPartial` reports it instead of sitting live
      // until the whole request eventually settles, which could be never
      // (ESCSUITE-116).
      let partial: AcquiredStreams = { screen: null, webcam: null, mic: null };
      let expired = false;
      const request = acquireStreams((p) => {
        partial = p;
        if (expired) releaseAcquired(p);
      });

      // A request the browser never answers — a picker or a permission prompt
      // left on screen, a camera or microphone driver wedged so that
      // `getUserMedia` never settles — used to park this function, and the UI in
      // 'preparing', for the life of the tab (ESCSUITE-109). Neither
      // `getDisplayMedia` nor `getUserMedia` takes an `AbortController`, so the
      // request cannot be called off: the token is the abort. The clock stops
      // waiting, the app goes back to idle saying why, and the capture the
      // browser hands over afterwards is released the moment it arrives.
      //
      // The clock is armed *after* the request is issued, and nothing is awaited
      // in between, so it costs the click's user activation nothing.
      let giveUp = 0;
      const deadline = new Promise<null>(resolve => {
        giveUp = window.setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
      });
      const acquired = await Promise.race([request, deadline]).finally(() => {
        // However the race ended, including by the request throwing: a
        // 60-second timer left armed behind every take is a leak.
        clearTimeout(giveUp);
      });

      // Whether this attempt still owns the app. Two ways it may not, and they
      // look nothing alike: the take was thrown away underneath the request (the
      // cancelled flag, raised by both cancels and by the unmount teardown), or a
      // *newer* take has been started since — which the flag cannot say, because
      // a start resets it (ESCSUITE-109).
      const abandoned = myAttempt !== attemptRef.current || cancelledRef.current;

      if (acquired === null) {
        // The clock won. Release what the browser has already handed over —
        // the share bar goes down NOW, not whenever a stalled camera or
        // microphone prompt eventually settles (ESCSUITE-116) — and mark the
        // request expired, so a stage that lands afterwards is released by
        // `onPartial` itself instead of sitting live until the whole request
        // eventually settles. Whatever the request hands over at the end is
        // released on arrival regardless, the same release the guard below
        // does, moved onto a promise nobody is awaiting any more. A request
        // that *rejects* after we stopped waiting has nothing to release and
        // nothing to say: the user was told when the clock ran out.
        expired = true;
        releaseAcquired(partial);
        // `partial`, whatever a late `onPartial` report already released
        // above, and whatever `request` eventually resolves to all overlap —
        // a stage reported once is handed back again wherever it is still
        // held. So the screen (or webcam, or mic) stream released here is
        // released a second (or third) time below. That is safe: `stopStream`
        // stops tracks, and stopping an already-stopped track is a no-op.
        void request.then(releaseAcquired, () => {});
        // Nothing is said for an attempt the user had already thrown away: the
        // notice lives in the module-singleton store and would be read out on the
        // next mount, about a take nobody was waiting for.
        if (!abandoned) {
          setNotice(CAPTURE_UNANSWERED);
          setState('idle');
        }
        return;
      }

      const { screen, webcam, mic } = acquired;

      // The take can be thrown away while that request is outstanding — the
      // picker is on screen, or the camera prompt is — and a cancel there can
      // clean up nothing: `stopAllStreams()` reads the streams out of the
      // store, and nothing has put them there yet (ESCSUITE-93). So the
      // resumed start releases what it was handed and builds nothing on top of
      // it: no `setStreams` (the store would mirror a capture already being
      // thrown away, on a component that may be unmounted), no compositor, no
      // recorder. This is the earliest exit that leaves nothing live, which is
      // why it is the one that does the releasing — every guard below it has a
      // recorder to dispose as well.
      if (abandoned) {
        releaseAcquired(acquired);
        return;
      }

      setStreams(screen, webcam);
      micStreamRef.current = mic;

      // Ticking "System Audio" only *asks* for it: getDisplayMedia's own
      // dialog carries the tick box, and the stream comes back with no audio
      // track when the user leaves it clear. Nothing used to notice, so the
      // System meter sat at 0 whether the audio was there or not.
      const systemAudioShared =
        !config.systemAudioEnabled || (screen !== null && hasSystemAudio(screen));
      setSystemAudioShared(systemAudioShared);
      // Only a display capture can carry system audio, so only a display
      // capture that came back without it means the tick box was missed.
      if (!systemAudioShared && screen !== null) {
        setNotice(NO_SYSTEM_AUDIO);
      }

      // The microphone was asked for and could not be opened, and the take is
      // going ahead anyway (ESCSUITE-184). Said after the system-audio notice
      // above, so it wins the one channel when both are true: that one is a
      // nudge about a tick box the user can tick next time, and the greyed
      // System meter carries its own weaker wording for the rest of the take,
      // while this names a source that is simply gone from the recording now
      // being made. The *reason* it could not be opened is a console detail —
      // `acquireStreams` logs it — because there is nothing the user can do
      // differently about a refusal, a device in use or a device unplugged.
      if (acquired.micUnavailable) {
        setNotice(MIC_UNAVAILABLE);
      }

      // Which take this is, decided once and handed to everything below: the
      // compositor's mode, the factory, the recorder type the save path keys
      // the container repair off, the config the recorder initializes with, and
      // — carried on `captured` in `onStop` below (ESCSUITE-68) — the save path,
      // which would otherwise have to re-read a setting the user can still move.
      // A config that still claimed `separateTracks` in a browser that cannot
      // serve it would have the recorder building a pipeline it cannot read.
      const isPiP = config.screenEnabled && config.webcamEnabled && !!screen && !!webcam;
      const separateTracks =
        isPiP && config.separateTracks && canUseWebCodecsRecorder(true, true, true);
      // Whether there is a video track to encode at all — the same test both
      // recorders apply when they pick one (a stream AND its toggle). Without
      // one the take is audio only, which the WebCodecs recorder cannot serve.
      const hasVideoSource = (config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam);

      // Whether this take really has a microphone in it: the toggle AND a track
      // that arrived. `acquireStreams` hands back `mic: null` when the toggle
      // is on and the capability is missing — a machine with no microphone —
      // and the config alone cannot tell that from a take that recorded one.
      // Resolved once here, like the mode above, and handed to both of the
      // things that have to agree about it: how many parts the take is counted
      // as asking for, and the `hasAudio` the save path stores (ESCSUITE-70).
      const micAcquired =
        config.microphoneEnabled && (mic?.getAudioTracks().length ?? 0) > 0;

      // The rest of what `captured` carries to the save path (ESCSUITE-104):
      // the System Audio and webcam toggles, and the overlay geometry, all
      // read here and nowhere else. `useRecordingSave` has no `config` of its
      // own — a save that is still awaiting its container repair, its
      // metadata probe, its thumbnail decode and its two IndexedDB writes must
      // describe the take it was handed, not whatever the sidebar has moved to
      // by the time one of those settles.
      const systemAudioEnabled = config.systemAudioEnabled;
      const webcamEnabled = config.webcamEnabled;
      const overlayPlacement = {
        position: config.webcamPosition,
        size: config.webcamSize,
        shape: config.webcamShape,
      };

      // How many extra files this take is asking for: the camera, and one per
      // audio source it really has. The same two questions the recorder asks
      // when it builds the pipelines — a stream with a track in it AND its
      // toggle — so the two cannot disagree. This is the only layer that
      // knows the number: the recorder delivers `null` or a short list for a
      // lost part and for a take that never asked, and they look identical.
      const expectedCompanions = separateTracks
        ? 1 + (micAcquired ? 1 : 0) + (config.systemAudioEnabled && systemAudioShared ? 1 : 0)
        : 0;

      // Set up preview
      // This avoids canvas.captureStream() issues with hidden video elements

      if (isPiP && screen && webcam) {
        const videoTrack = screen.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        compositorRef.current = new Compositor(
          settings.width || 1920,
          settings.height || 1080,
          {
            webcamPosition: config.webcamPosition,
            webcamSize: config.webcamSize,
            webcamShape: config.webcamShape,
          }
        );
        compositorRef.current.setScreenStream(screen);
        compositorRef.current.setWebcamStream(webcam);
        if (separateTracks) {
          // The overlay is only what the user watches: the recorder takes the
          // raw tracks, so there is no reader for a canvas capture stream.
          compositorRef.current.startPreviewOnly();
          setPreviewStream(screen);
        } else {
          setPreviewStream(compositorRef.current.start());
        }
        setIsPiPActive(true);
      } else if (screen) {
        setPreviewStream(screen);
      } else if (webcam) {
        setPreviewStream(webcam);
      }

      // Initialize recorder (WebCodecs unless the take is composited PiP or
      // audio only — see canUseWebCodecsRecorder)
      //
      // The six callbacks below act on the refs, not on an argument — so a
      // callback that fires after this recorder has been disposed, or replaced
      // by a newer take's, would otherwise run against whatever `recorderRef`,
      // the tickers and the streams belong to *now*. `me` is the exact instance
      // this call builds, captured in the closure once and compared against
      // `recorderRef.current` on every callback: the identity a late onStop or
      // onError needs and the attempt token above gives the start path
      // (ESCSUITE-118). `cancelledRef` alone cannot stand in for it — a start
      // resets that flag, so a live take B reads as "not cancelled" to a chunk
      // that was actually A's.
      const me: AnyRecorder = createRecorder({
        onStart: () => {
          // A start from a recorder that is no longer current is stale — it was
          // disposed by a cancel, or superseded by a newer take — and must not
          // flip the state back to 'recording' or open a second duration ticker
          // over the live one (ESCSUITE-118).
          if (recorderRef.current !== me) return;
          setState('recording');
          analytics.recordingStarted();
          // Start duration timer
          durationIntervalRef.current = window.setInterval(() => {
            if (recorderRef.current) {
              setCurrentDuration(recorderRef.current.getDuration());
            }
          }, 100);
        },
        onPause: () => {
          if (recorderRef.current !== me) return;
          setState('paused');
        },
        onResume: () => {
          if (recorderRef.current !== me) return;
          setState('recording');
        },
        onStop: (blob, companions) => {
          // A stop from a recorder that is no longer the take's — disposed, or
          // replaced by a newer take's — is a chunk nobody asked for
          // (ESCSUITE-118). This also covers a stop landing after the take was
          // cancelled or the screen went away: every path that raises
          // cancelledRef (cancelCountdown, handleCancelRecording, the unmount
          // teardown) calls disposeRecorder() on the same line, which nulls
          // recorderRef.current — so this guard is the one that catches it, and
          // a separate `if (cancelledRef.current) return;` here would never run.
          // The cancel that disposed it zeroed the levels itself (`zeroAudioLevels`,
          // called from handleCancelRecording / cancelCountdown / the unmount
          // teardown), so a dropped stop has nothing left to write (ESCSUITE-114).
          if (recorderRef.current !== me) return;
          // The take is over the instant this fires — whether it was asked
          // for or the recorder found out on its own (the capture ended) —
          // and neither recorder's monitor ever emits a zero of its own
          // (ESCSUITE-114): a take with nothing to measure sends one
          // hard-coded reading at start and then stops, and a take that IS
          // measuring something just keeps emitting whatever it last read.
          // Left alone, the store would carry that reading forever, and the
          // next take's meter — closed only while there is no live take —
          // would open on it before its own monitor had said anything. One
          // call here, the single place both recorders' stop reaches, covers
          // every path that ends a take with a save rather than one
          // recorder's own stop().
          zeroAudioLevels();
          // Four of the ways a part can be lost happen inside the recorder —
          // it was never set up, it encoded nothing, it gave up, its finalize
          // threw — and all four arrive here as a list that is simply shorter,
          // which is exactly what an ordinary take delivers. Only this closure
          // still knows how many the take was resolved to produce. The save
          // hook says the same sentence for a part lost in storage.
          if ((companions?.length ?? 0) < expectedCompanions) {
            setNotice(SEPARATE_TRACK_NOT_SAVED);
          }
          // The recorder can finish a take on its own — the capture ended — so
          // nobody has been through handleStopRecording to stop the ticker.
          clearDurationTicker();
          // Capture duration before resetting
          const recordedDuration = recorderRef.current?.getDuration() || useRecorderStore.getState().currentDuration;
          analytics.recordingCompleted(recordedDuration);
          // Update UI immediately — don't block on save
          setState('saving');
          setCurrentDuration(0);
          stopAllStreams();
          // Save in background
          // Every field travels in the closure, not through a ref: each is a
          // fact about *this* take, resolved before the countdown. A late
          // onStop must not be given the next take's answer — nor the answer
          // the sidebar gives now, which is what the save path would otherwise
          // have to read for the mode (ESCSUITE-68) or for System Audio, the
          // webcam toggle and the overlay geometry (ESCSUITE-104).
          saveRecording(blob, recordedDuration, companions, {
            micAcquired,
            separateTracks,
            systemAudioEnabled,
            webcamEnabled,
            overlayPlacement,
            hasVideoSource,
          }).catch((err) => {
            // The save hook rejects rather than swallowing: without this the
            // take would land back at 'idle' looking exactly like one that
            // had been stored. Said whatever the app is doing by now — the
            // user's recording really is not in the library, and that is worth
            // telling them even if they have moved on to another take. Only
            // the *state* write below belongs to one take alone.
            console.error('Failed to save recording:', err);
            setNotice(SAVE_FAILED);
          }).then(() => {
            // The completion carries the identity of the take it saved
            // (ESCSUITE-174), the same `me` the five callbacks above carry.
            // A save is a container repair, a metadata probe, a thumbnail
            // decode and two IndexedDB writes — seconds on a multi-MB take —
            // and this write used to land in whatever the store held whenever
            // it settled. Anything that took the app out of 'saving' in that
            // window left Record live, and this 'idle' then landed on the take
            // started after it: recording, with the store saying idle, so no
            // Stop and no Cancel, and a Record click that would reassign
            // `recorderRef.current` over a recorder nobody could dispose. Once
            // the ref has moved on — a newer take's recorder, or null after a
            // cancel or the unmount teardown — this take is not the app's any
            // more, and whatever moved it has already set the state it wanted.
            //
            // The invariant this rests on: an ordinary save still passes,
            // because neither `handleStopRecording` nor this `onStop` disposes
            // the recorder — the ref still points at `me` seconds later when
            // the save settles — and every path that DOES move it off `me`
            // writes a state on the way past. A stop that disposed the recorder
            // would have to write `'idle'` itself, or this guard would strand
            // every ordinary save in `'saving'`, which has no other way out.
            if (recorderRef.current !== me) return;
            setState('idle');
          }).finally(() => {
            // Either way the library has changed size — re-read the headroom
            // so the Record button reflects it before the next click.
            void refreshStorageSpace();
          });
        },
        onError: (error) => {
          console.error('Recording error:', error);
          if (recorderRef.current !== me) return;
          // The capture can die before start() — the user stops sharing while
          // the countdown is on screen, and the recorder reports it here. A
          // ticker left running would reach zero and start a sourceless take,
          // and the recorder itself still holds an AudioContext and a level
          // monitor, so both go with the failed take.
          clearCountdownTicker();
          disposeRecorder();
          setState('idle');
          setCurrentDuration(0);
          stopAllStreams();
        },
        // Unguarded on purpose (ESCSUITE-118): both recorders cancel their rAF
        // level-monitor loop synchronously inside dispose()'s cleanup(), so a
        // disposed recorder cannot still be mid-loop when this fires — there is
        // no late meter reading for the guard above to catch.
        onAudioLevels: setAudioLevels,
      }, isPiP, hasVideoSource, separateTracks);
      recorderRef.current = me;
      recorderTypeRef.current = getRecorderType(isPiP, hasVideoSource, separateTracks);

      // This avoids canvas.captureStream() issues with hidden video elements
      let recordingScreen: MediaStream | null = screen;

      if (isPiP && !separateTracks && compositorRef.current) {
        // Composited PiP - use compositor's existing output stream (already created by start())
        // Avoids calling captureStream() a second time, which would double CPU cost
        const compositorStream = compositorRef.current.getOutputStream();
        if (compositorStream) {
          recordingScreen = new MediaStream([
            ...compositorStream.getVideoTracks(),
            ...(screen?.getAudioTracks() || []),
          ]);
        }
      }
      // For single-source recordings (screen-only or webcam-only), and for a
      // separate-tracks take, the recorder gets the raw streams.

      await recorderRef.current.initialize(recordingScreen, webcam, mic, {
        ...config,
        separateTracks,
      });

      // A take can be thrown away while that await is parked, and in two ways
      // that look nothing alike (ESCSUITE-73). The unmount teardown raises the
      // cancelled flag and disposes the recorder synchronously underneath this;
      // the recorder's own `onError` — the capture ended, and the video track's
      // 'ended' listener is installed before `Output.start()`, so it fires
      // during setup for real — disposes it and returns to idle while
      // *cancelling nothing*, so the flag alone cannot see it. The recorder ref
      // can: `disposeRecorder()` nulls it on every path that disposes.
      //
      // Without this, startCountdown() writes 'countdown' back into the
      // module-singleton store that was just reset to idle and leaves an
      // interval ticking against `recorderRef.current === null` — a 3-2-1 over
      // nothing, and a next mount that comes up inside it.
      //
      // It tears down rather than bare-returning (ESCSUITE-93). Every path that
      // reaches it *with nobody else set up* has already disposed the recorder
      // and released the capture — the unmount teardown, the recorder's own
      // `onError`, and `handleCancelRecording` from Escape in 'preparing' while
      // `initialize()` is parked — so both calls are no-ops: `disposeRecorder()`
      // nulls the ref and `stopAllStreams()` is idempotent. A bare return is
      // nevertheless a promise that every *future* way of arriving here will have
      // cleaned up first, and that is the promise this ticket's own window broke.
      //
      // Superseded is not the same as torn down, and this is the one guard where
      // the difference bites (ESCSUITE-109). A cancel frees Record while this
      // await is parked, so by the time it resumes the next take may have
      // acquired its capture and built *its* recorder — and `recorderRef`, the
      // store's streams and `stopAllStreams` all belong to that take now. Tearing
      // down here would dispose the newer take's recorder and put its sharing bar
      // out mid-take, and the newer take's own resume would then find a null
      // recorder ref and return without a state, leaving the UI in 'preparing'
      // with no Record button, no Cancel button and no way out but a reload. So a
      // superseded attempt returns having touched nothing: whatever it owned was
      // released by the cancel that superseded it.
      if (attemptRef.current !== null && attemptRef.current !== myAttempt) return;

      // What is left is this attempt's own, or nobody's. `cancelledRef` is not
      // asked: every path that raises it disposes the recorder on the same line,
      // so the ref answers for it — and asking both would be a decision that can
      // never go the other way.
      if (!recorderRef.current) {
        disposeRecorder();
        stopAllStreams();
        return;
      }

      // Start countdown or record immediately
      if (config.countdownSeconds > 0) {
        startCountdown();
      } else {
        startRecording();
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      // This attempt is no longer the one that owns the app, and it has nothing
      // of its own left: only a cancel or the unmount teardown drops the token
      // mid-flight, and both release the capture and dispose the recorder on
      // their way past. So there is nothing to tear down here — and tearing down
      // anyway would tear down whatever take has started since (ESCSUITE-109).
      // It also says nothing, which is the other half of this guard: the notice
      // lives in the module-singleton store, so one written for a take that was
      // thrown away mid-start would be read out on the next mount, about a
      // recording nobody ever saw (ESCSUITE-73). The console still carries it.
      if (myAttempt !== attemptRef.current) return;
      setNotice(startFailureNotice(error));
      // initialize() can throw after the recorder has already built its audio
      // graph — an all-sources-off take reaches MediaRecorder, which creates
      // the AudioContext before discovering it has no tracks — so a failed
      // start leaks exactly what a cancelled countdown used to.
      disposeRecorder();
      setState('idle');
      stopAllStreams();
    } finally {
      // Per attempt, not a latch: the next click has to be able to start a take.
      // Only *this* attempt's token is dropped — a cancel may already have
      // dropped it and let a newer take take the ref, and that take is still
      // being started (ESCSUITE-109).
      if (attemptRef.current === myAttempt) attemptRef.current = null;
    }
  }, [
    acquireStreams,
    capturedThumbnailRef,
    clearCountdownTicker,
    clearDurationTicker,
    config,
    disposeRecorder,
    setState,
    setStreams,
    setCurrentDuration,
    setAudioLevels,
    zeroAudioLevels,
    startCountdown,
    startRecording,
    stopAllStreams,
    saveRecording,
    compositorRef,
    micStreamRef,
    recorderTypeRef,
    setPreviewStream,
    setIsPiPActive,
    setNotice,
    setSystemAudioShared,
    refreshStorageSpace,
  ]);

  return {
    cancelCountdown,
    handleCancelRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleStopRecording,
    handleStartRecording,
  };
}
