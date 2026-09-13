// Everything the recorder screen captures with, and everything that releases
// it again: the preview stream, the picture-in-picture compositor, the
// microphone stream the store does not hold, and the two DOM handles the
// preview is shown through.
//
// The hook owns these refs because four concerns read them and only one may
// create them: a second useRef() somewhere else would hand the recorder a
// compositor the teardown never disposes.
//
// It registers two effects, in this order — the preview attach, then the
// stopAllStreams mirror — because that is the order they ran in when they were
// inline, and the unmount teardown (registered later, by
// useRecordingController) reaches the live stopAllStreams through that mirror.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  requestScreenCapture,
  requestWebcam,
  requestMicrophone,
  stopStream,
} from '../core/permissions';
import { Compositor } from '../core/compositor';
import { useRecorderStore } from '../store/recorderStore';
import type { EnvironmentCapabilities, RecordingConfig } from '../store/types';

/** What stream acquisition needs from the store. */
export interface MediaStreamsDeps {
  config: RecordingConfig;
  capabilities: EnvironmentCapabilities;
  setStreams: (screen: MediaStream | null, webcam: MediaStream | null) => void;
}

/** The three captures one attempt can produce; any of them may be null. */
export interface AcquiredStreams {
  screen: MediaStream | null;
  webcam: MediaStream | null;
  mic: MediaStream | null;
}

export interface MediaStreams {
  /** The stream the preview mirrors: a raw capture, or the compositor's output. */
  previewStream: MediaStream | null;
  setPreviewStream: (stream: MediaStream | null) => void;
  /** True while the compositor is running, i.e. its canvas is the preview. */
  isPiPActive: boolean;
  setIsPiPActive: (active: boolean) => void;
  /** The compositor for a screen+webcam take; disposed only by stopAllStreams. */
  compositorRef: RefObject<Compositor | null>;
  /** The microphone stream — held here, not in the store. */
  micStreamRef: RefObject<MediaStream | null>;
  /** The preview <video>. */
  previewRef: RefObject<HTMLVideoElement | null>;
  /** The host element the compositor's canvas is moved into. */
  canvasPreviewRef: RefObject<HTMLDivElement | null>;
  /** Release every capture and the compositor with it. */
  stopAllStreams: () => void;
  /** The current stopAllStreams, for the unmount teardown to reach. */
  stopAllStreamsRef: RefObject<() => void>;
  /** Request the enabled, available sources; releases what it got if one fails. */
  acquireStreams: () => Promise<AcquiredStreams>;
}

export function useMediaStreams({ config, capabilities, setStreams }: MediaStreamsDeps): MediaStreams {
  const compositorRef = useRef<Compositor | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasPreviewRef = useRef<HTMLDivElement>(null);
  // The screen and webcam streams live in the store (the preview reads them);
  // the microphone stream is only ever handed to the recorder, so it is held
  // here purely so stopAllStreams() can release it with the others.
  const micStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isPiPActive, setIsPiPActive] = useState(false);

  // Update preview — use canvas directly for PiP, video element for other modes
  useEffect(() => {
    if (compositorRef.current && canvasPreviewRef.current) {
      // PiP mode: attach compositor canvas directly to the preview div
      const canvas = compositorRef.current.getCanvas();
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'contain';
      canvasPreviewRef.current.innerHTML = '';
      canvasPreviewRef.current.appendChild(canvas);
    } else if (previewRef.current && previewStream) {
      previewRef.current.srcObject = previewStream;
      previewRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  // Stop all streams helper.
  // Read the streams from the store rather than from this render's closure:
  // the recorder's onStop/onError callbacks are captured while handleStart-
  // Recording runs, i.e. one render before setStreams() lands, so a closed-over
  // screenStream/webcamStream would still be null there and the capture would
  // keep running after the take ended.
  const stopAllStreams = useCallback(() => {
    const { screenStream: activeScreen, webcamStream: activeWebcam } = useRecorderStore.getState();
    stopStream(activeScreen);
    stopStream(activeWebcam);
    stopStream(micStreamRef.current);
    micStreamRef.current = null;
    setStreams(null, null);
    setPreviewStream(null);

    if (compositorRef.current) {
      compositorRef.current.dispose();
      compositorRef.current = null;
      setIsPiPActive(false);
    }

    // Clear the canvas preview container (removes stale last frame)
    if (canvasPreviewRef.current) {
      canvasPreviewRef.current.innerHTML = '';
    }
  }, [setStreams]);

  // Release everything when the recorder screen goes away.
  //
  // Nothing else runs on the way out: an unmount mid-countdown would leave the
  // countdown interval ticking, and an unmount mid-take would leave the
  // duration ticker, the recorder and the camera/microphone lights on. The
  // cleanup has to run only on unmount, so it reaches the current
  // stopAllStreams through a ref instead of closing over one render's copy.
  const stopAllStreamsRef = useRef(stopAllStreams);
  useEffect(() => {
    stopAllStreamsRef.current = stopAllStreams;
  }, [stopAllStreams]);

  // Acquire streams based on config
  const acquireStreams = useCallback(async (): Promise<AcquiredStreams> => {
    let screen: MediaStream | null = null;
    let webcam: MediaStream | null = null;
    let mic: MediaStream | null = null;

    try {
      // Get screen capture if enabled
      if (config.screenEnabled && capabilities.screenCapture) {
        screen = await requestScreenCapture(config.systemAudioEnabled);
      }

      // Get webcam if enabled
      if (config.webcamEnabled && capabilities.webcam) {
        webcam = await requestWebcam();
      }

      // Get microphone if enabled (separate from webcam)
      if (config.microphoneEnabled && capabilities.microphone) {
        mic = await requestMicrophone();
      }

      return { screen, webcam, mic };
    } catch (error) {
      // Clean up any acquired streams on error
      stopStream(screen);
      stopStream(webcam);
      stopStream(mic);
      throw error;
    }
  }, [config, capabilities]);

  return {
    previewStream,
    setPreviewStream,
    isPiPActive,
    setIsPiPActive,
    compositorRef,
    micStreamRef,
    previewRef,
    canvasPreviewRef,
    stopAllStreams,
    stopAllStreamsRef,
    acquireStreams,
  };
}
