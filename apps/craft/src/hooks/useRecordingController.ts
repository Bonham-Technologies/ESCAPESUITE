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
import { createRecorder, getRecorderType, type AnyRecorder } from '../core/recorder-factory';
import { hasSpaceForRecording } from '../core/storage';
import { NO_STORAGE_SPACE, SAVE_FAILED } from '../utils/notices';
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
}

/**
 * What one take is assumed to cost, for the pre-flight storage check.
 *
 * There is no way to know before the fact, and `hasSpaceForRecording` keeps a
 * 50MB buffer of its own on top, so this is a floor rather than an estimate:
 * refuse a take when there is not comfortably 100MB to put it in.
 */
const ESTIMATED_RECORDING_BYTES = 50 * 1024 * 1024;

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
      // the last one had to report.
      setNotice(null);
      setState('preparing');

      // Ask before capturing anything: a take that cannot be stored is worse
      // than one that never started, and the user can act on this one.
      if (!(await hasSpaceForRecording(ESTIMATED_RECORDING_BYTES))) {
        setNotice(NO_STORAGE_SPACE);
        setState('idle');
        return;
      }

      const { screen, webcam, mic } = await acquireStreams();
      setStreams(screen, webcam);
      micStreamRef.current = mic;

      // Set up preview
      // This avoids canvas.captureStream() issues with hidden video elements

      if (config.screenEnabled && config.webcamEnabled && screen && webcam) {
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
        const composedStream = compositorRef.current.start();
        setPreviewStream(composedStream);
        setIsPiPActive(true);
      } else if (screen) {
        setPreviewStream(screen);
      } else if (webcam) {
        setPreviewStream(webcam);
      }

      // Determine if we're in PiP mode (screen + webcam with compositor)
      const isPiP = config.screenEnabled && config.webcamEnabled && !!compositorRef.current;
      // Whether there is a video track to encode at all — the same test both
      // recorders apply when they pick one (a stream AND its toggle). Without
      // one the take is audio only, which the WebCodecs recorder cannot serve.
      const hasVideoSource = (config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam);

      // Initialize recorder (uses WebCodecs for non-PiP if available)
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
        onStop: (blob) => {
          // A stop that lands after the take was cancelled or the screen went
          // away is a chunk nobody asked for: drop it rather than save it.
          if (cancelledRef.current) return;
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
          saveRecording(blob, recordedDuration).then(() => {
            setState('idle');
          }).catch((err) => {
            // The save hook rejects rather than swallowing: without this the
            // take would land back at 'idle' looking exactly like one that
            // had been stored.
            console.error('Failed to save recording:', err);
            setNotice(SAVE_FAILED);
            setState('idle');
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
      }, isPiP, hasVideoSource);
      recorderTypeRef.current = getRecorderType(isPiP, hasVideoSource);

      // This avoids canvas.captureStream() issues with hidden video elements
      let recordingScreen: MediaStream | null = screen;

      if (config.screenEnabled && config.webcamEnabled && compositorRef.current) {
        // PiP mode - use compositor's existing output stream (already created by start())
        // Avoids calling captureStream() a second time, which would double CPU cost
        const compositorStream = compositorRef.current.getOutputStream();
        if (compositorStream) {
          recordingScreen = new MediaStream([
            ...compositorStream.getVideoTracks(),
            ...(screen?.getAudioTracks() || []),
          ]);
        }
      }
      // For single-source recordings (screen-only or webcam-only), use raw stream

      await recorderRef.current.initialize(recordingScreen, webcam, mic, config);

      // Start countdown or record immediately
      if (config.countdownSeconds > 0) {
        startCountdown();
      } else {
        startRecording();
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
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
