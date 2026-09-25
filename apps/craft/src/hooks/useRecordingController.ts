// The take itself: countdown, start, pause, resume, stop, cancel, the two
// interval tickers, and the teardown that runs when the screen goes away.
//
// Three refs are created here and nowhere else — the recorder, the cancelled
// flag and the two interval handles — because each is written by one path and
// read by three. The cancelled flag in particular is reset by
// handleStartRecording, raised by handleCancelRecording and by the unmount
// teardown, and read by the recorder's onStop: a second copy of it would let a
// late chunk from a thrown-away take be saved.
//
// The recorder's six callbacks are captured once, when createRecorder runs, so
// they close over the stopAllStreams and saveRecording of the render that
// started the take. That is deliberate: a late onStop has to release the
// capture that take was using, not whatever the current render holds.
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
import { hasSystemAudio } from '../core/permissions';
import {
  CAPTURE_REFUSED,
  NO_SYSTEM_AUDIO,
  SAVE_FAILED,
  START_FAILED,
  WEBCAM_TRACK_NOT_SAVED,
} from '../utils/notices';
import { Compositor } from '../core/compositor';
import { analytics } from '../utils/analytics';
import { drawThumbnail } from '../utils/previewThumbnail';
import { useRecorderStore } from '../store/recorderStore';
import type { AudioLevels, RecordingConfig, RecordingState } from '../store/types';
import type { AcquiredStreams } from './useMediaStreams';
import type { SaveRecording } from './useRecordingSave';

export interface RecordingControllerDeps {
  config: RecordingConfig;
  setState: (state: RecordingState) => void;
  setCountdown: (value: number) => void;
  setCurrentDuration: (duration: number) => void;
  setAudioLevels: (levels: AudioLevels) => void;
  setStreams: (screen: MediaStream | null, webcam: MediaStream | null) => void;
  /** From useMediaStreams: the capture, the release, and the handles both use. */
  acquireStreams: () => Promise<AcquiredStreams>;
  stopAllStreams: () => void;
  stopAllStreamsRef: RefObject<() => void>;
  compositorRef: RefObject<Compositor | null>;
  micStreamRef: RefObject<MediaStream | null>;
  previewRef: RefObject<HTMLVideoElement | null>;
  setPreviewStream: (stream: MediaStream | null) => void;
  setIsPiPActive: (active: boolean) => void;
  /** Written here at createRecorder time, read by saveRecording. */
  recorderTypeRef: RefObject<'webcodecs' | 'mediarecorder'>;
  /** Written by handleStopRecording, read and cleared by saveRecording. */
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
 * Why a take never started, as far as the user needs to know.
 *
 * `NotAllowedError` is the browser refusing the capture — the picker was
 * cancelled, the permission is denied, or the click's user activation had
 * expired by the time `getDisplayMedia` ran. It is worth its own sentence
 * because "nothing happened" is otherwise indistinguishable from a bug.
 */
function startFailureNotice(error: unknown): string {
  return (error as { name?: string } | null)?.name === 'NotAllowedError'
    ? CAPTURE_REFUSED
    : START_FAILED;
}

export interface RecordingController {
  cancelCountdown: () => void;
  handleCancelRecording: () => void;
  handlePauseRecording: () => void;
  handleResumeRecording: () => void;
  handleStopRecording: () => Promise<void>;
  handleStartRecording: () => Promise<void>;
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

  useEffect(() => () => {
    cancelledRef.current = true;
    clearDurationTicker();
    clearCountdownTicker();
    disposeRecorder();
    stopAllStreamsRef.current();

    // The store is a module singleton: it outlives this component. Left as it
    // was, the next mount would come up mid-take — 'recording' with a duration
    // and a countdown from a take whose recorder and capture are both gone.
    const recorder = useRecorderStore.getState();
    recorder.setState('idle');
    recorder.setCurrentDuration(0);
    recorder.setCountdown(0);
  }, [clearCountdownTicker, clearDurationTicker, disposeRecorder, stopAllStreamsRef]);

  // Cancel countdown
  const cancelCountdown = useCallback(() => {
    clearCountdownTicker();
    disposeRecorder();
    setState('idle');
    stopAllStreams();
  }, [clearCountdownTicker, disposeRecorder, setState, stopAllStreams]);

  // Cancel recording
  const handleCancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearDurationTicker();
    disposeRecorder();

    setState('idle');
    setCurrentDuration(0);
    stopAllStreams();
  }, [clearDurationTicker, disposeRecorder, setState, setCurrentDuration, stopAllStreams]);

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
    capturedThumbnailRef.current = await capturePreviewThumbnail();

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
    try {
      cancelledRef.current = false;
      // Starting a take is the "next successful action" that clears whatever
      // the last one had to report. The System meter goes back with it. The
      // flag is NOT display-only: `useRecordingSave` reads it at save time to
      // decide the stored `hasAudio` (ESCSUITE-62), so it must describe the
      // take just finished until the next one starts — which is exactly when
      // it is reset, here, and nowhere else.
      setNotice(null);
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
      const { screen, webcam, mic } = await acquireStreams();
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

      // Which take this is, decided once and handed to everything below: the
      // compositor's mode, the factory, the recorder type the save path keys
      // the container repair off, and the config the recorder initializes with.
      // A config that still claimed `separateTracks` in a browser that cannot
      // serve it would have the recorder building a pipeline it cannot read.
      const isPiP = config.screenEnabled && config.webcamEnabled && !!screen && !!webcam;
      const separateTracks =
        isPiP && config.separateTracks && canUseWebCodecsRecorder(true, true, true);
      // Whether there is a video track to encode at all — the same test both
      // recorders apply when they pick one (a stream AND its toggle). Without
      // one the take is audio only, which the WebCodecs recorder cannot serve.
      const hasVideoSource = (config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam);

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
      recorderRef.current = createRecorder({
        onStart: () => {
          setState('recording');
          analytics.recordingStarted();
          // Start duration timer
          durationIntervalRef.current = window.setInterval(() => {
            if (recorderRef.current) {
              setCurrentDuration(recorderRef.current.getDuration());
            }
          }, 100);
        },
        onPause: () => setState('paused'),
        onResume: () => setState('recording'),
        onStop: (blob, companion) => {
          // A stop that lands after the take was cancelled or the screen went
          // away is a chunk nobody asked for: drop it rather than save it.
          if (cancelledRef.current) return;
          // Three of the four ways the camera half can be lost happen inside
          // the recorder — no frame encoded, the pipeline gave up, the muxer's
          // finalize threw — and all three arrive here as `companion: null`,
          // which is exactly what an ordinary take delivers. Only this closure
          // still knows the take was *resolved* on separate tracks, so this is
          // the only place that can tell "lost" from "never asked for". The
          // save hook says the same sentence for a companion lost in storage.
          if (separateTracks && !companion) {
            setNotice(WEBCAM_TRACK_NOT_SAVED);
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
          saveRecording(blob, recordedDuration, companion).then(() => {
            setState('idle');
          }).catch((err) => {
            // The save hook rejects rather than swallowing: without this the
            // take would land back at 'idle' looking exactly like one that
            // had been stored.
            console.error('Failed to save recording:', err);
            setNotice(SAVE_FAILED);
            setState('idle');
          }).finally(() => {
            // Either way the library has changed size — re-read the headroom
            // so the Record button reflects it before the next click.
            void refreshStorageSpace();
          });
        },
        onError: (error) => {
          console.error('Recording error:', error);
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
        onAudioLevels: setAudioLevels,
      }, isPiP, hasVideoSource, separateTracks);
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

      // Start countdown or record immediately
      if (config.countdownSeconds > 0) {
        startCountdown();
      } else {
        startRecording();
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      // A start that died here used to leave the app back at idle with
      // nothing said — the same silence this work exists to delete.
      setNotice(startFailureNotice(error));
      // initialize() can throw after the recorder has already built its audio
      // graph — an all-sources-off take reaches MediaRecorder, which creates
      // the AudioContext before discovering it has no tracks — so a failed
      // start leaks exactly what a cancelled countdown used to.
      disposeRecorder();
      setState('idle');
      stopAllStreams();
    }
  }, [
    acquireStreams,
    clearCountdownTicker,
    clearDurationTicker,
    config,
    disposeRecorder,
    setState,
    setStreams,
    setCurrentDuration,
    setAudioLevels,
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
