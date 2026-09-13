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

  useEffect(() => () => {
    cancelledRef.current = true;
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.dispose();
      recorderRef.current = null;
    }
    stopAllStreamsRef.current();

    // The store is a module singleton: it outlives this component. Left as it
    // was, the next mount would come up mid-take — 'recording' with a duration
    // and a countdown from a take whose recorder and capture are both gone.
    const recorder = useRecorderStore.getState();
    recorder.setState('idle');
    recorder.setCurrentDuration(0);
    recorder.setCountdown(0);
  }, [stopAllStreamsRef]);

  // Cancel countdown
  const cancelCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setState('idle');
    stopAllStreams();
  }, [setState, stopAllStreams]);

  // Cancel recording
  const handleCancelRecording = useCallback(() => {
    cancelledRef.current = true;
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (recorderRef.current) {
      recorderRef.current.dispose();
      recorderRef.current = null;
    }

    setState('idle');
    setCurrentDuration(0);
    stopAllStreams();
  }, [setState, setCurrentDuration, stopAllStreams]);

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
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Capture thumbnail from live preview BEFORE stopping (more reliable than from blob)
    capturedThumbnailRef.current = await capturePreviewThumbnail();

    if (recorderRef.current) {
      await recorderRef.current.stop();
    }
  }, [capturePreviewThumbnail, capturedThumbnailRef]);

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
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        startRecording();
      } else {
        setCountdown(currentValue - 1);
      }
    }, 1000);
  }, [config.countdownSeconds, setState, setCountdown, startRecording]);

  // Handle start recording button
  const handleStartRecording = useCallback(async () => {
    try {
      cancelledRef.current = false;
      setState('preparing');

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
            console.error('Failed to save recording:', err);
            setState('idle');
          });
        },
        onError: (error) => {
          console.error('Recording error:', error);
          setState('idle');
          setCurrentDuration(0);
          stopAllStreams();
        },
        onAudioLevels: setAudioLevels,
      }, isPiP);
      recorderTypeRef.current = getRecorderType(isPiP);

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
      setState('idle');
      stopAllStreams();
    }
  }, [
    acquireStreams,
    config,
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
