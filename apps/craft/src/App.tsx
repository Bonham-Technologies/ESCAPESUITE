import { useEffect, useRef, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import styles from './App.module.css';
import { useRecorderStore } from './store/recorderStore';
import {
  detectCapabilities,
  requestScreenCapture,
  requestWebcam,
  requestMicrophone,
  stopStream,
} from './core/permissions';
import { createRecorder, getRecorderType, type AnyRecorder } from './core/recorder-factory';
import { Compositor } from './core/compositor';
import { storeVideo, storeThumbnail, deleteVideo, getVideoBlob, createBlobUrl, revokeBlobUrl } from './core/storage';
import { generateThumbnail, extractVideoMetadata } from './core/thumbnailGenerator';
import { fixWebMMetadata } from './core/converter';
import { analytics } from './utils/analytics';
import { sendToEditor } from './utils/sendToEditor';
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme';
import { themeStorage } from './utils/themeStorage';
import { safeFileName } from './utils/recordingFormat';
import { drawThumbnail, createPlaceholderThumbnail } from './utils/previewThumbnail';
import { buildSourceVideo, buildRecordingEntry } from './utils/recordingMetadata';
import { AppHeader } from './components/AppHeader/AppHeader';
import { SourceToggles } from './components/SourceToggles/SourceToggles';
import { WebcamOverlaySettings } from './components/WebcamOverlaySettings/WebcamOverlaySettings';
import { RecordingsList } from './components/RecordingsList/RecordingsList';
import { RecordingPreview } from './components/RecordingPreview/RecordingPreview';
import { RecorderControls } from './components/RecorderControls/RecorderControls';
import { PlaybackDialog } from './components/PlaybackDialog/PlaybackDialog';
import { HelpDialog } from './components/HelpDialog/HelpDialog';

function App() {
  const {
    state,
    config,
    capabilities,
    detailedCapabilities,
    recordings,
    currentDuration,
    countdownValue,
    audioLevels,
    setConfig,
    setCapabilities,
    setDetailedCapabilities,
    setState,
    setCountdown,
    setCurrentDuration,
    setAudioLevels,
    setStreams,
    addRecording,
    removeRecording,
    loadRecordings,
  } = useRecorderStore();

  const recorderRef = useRef<AnyRecorder | null>(null);
  const recorderTypeRef = useRef<'webcodecs' | 'mediarecorder'>('mediarecorder');
  const compositorRef = useRef<Compositor | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasPreviewRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const capturedThumbnailRef = useRef<Blob | null>(null);
  // A recorder can flush its last chunk — and call onStop — after the take has
  // been cancelled or the screen has gone away. The blob is then nobody's: it
  // belongs to a recording the user threw away, and must not be saved.
  const cancelledRef = useRef(false);
  // The screen and webcam streams live in the store (the preview reads them);
  // the microphone stream is only ever handed to the recorder, so it is held
  // here purely so stopAllStreams() can release it with the others.
  const micStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackName, setPlaybackName] = useState<string>('');
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);
  const [showHelpModal, setShowHelpModal] = useState(false);

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
  }, []);

  // Initialize theme on mount
  useEffect(() => {
    initTheme(themeStorage);
    return () => cleanupTheme();
  }, []);

  // Detect capabilities on mount
  useEffect(() => {
    detectCapabilities().then((result) => {
      setCapabilities(result.capabilities);
      setDetailedCapabilities(result.detailed);
    });
    loadRecordings();
  }, [setCapabilities, setDetailedCapabilities, loadRecordings]);

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
  }, []);

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
  }, [capturePreviewThumbnail]);

  // Acquire streams based on config
  const acquireStreams = useCallback(async (): Promise<{
    screen: MediaStream | null;
    webcam: MediaStream | null;
    mic: MediaStream | null;
  }> => {
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

  // Save recording to storage
  const saveRecording = useCallback(async (rawBlob: Blob, recordedDuration: number) => {
    setState('saving');

    try {
      let blob: Blob;
      if (recorderTypeRef.current === 'webcodecs') {
        // WebCodecs output is already a proper WebM with Cues — no fix needed
        blob = rawBlob;
      } else {
        // MediaRecorder output needs duration/Cues metadata fix
        try {
          blob = await fixWebMMetadata(rawBlob);
        } catch {
          blob = rawBlob;
        }
      }

      const id = uuidv4();
      // Pass the known duration since WebM from MediaRecorder often has issues
      const metadata = await extractVideoMetadata(blob, recordedDuration);
      const now = Date.now();

      // Use pre-captured thumbnail from live preview (more reliable than from blob)
      // Fall back to generating from blob if capture failed
      let thumbnail = capturedThumbnailRef.current;
      if (!thumbnail) {
        try {
          thumbnail = await generateThumbnail(blob);
        } catch {
          // Create a simple placeholder thumbnail if all else fails
          thumbnail = await createPlaceholderThumbnail();
        }
      }
      capturedThumbnailRef.current = null; // Clear for next recording

      // Use recorded duration if metadata extraction failed
      const duration = metadata.duration > 0 ? metadata.duration : recordedDuration;

      const sourceVideo = buildSourceVideo({
        id,
        now,
        blob,
        duration,
        width: metadata.width,
        height: metadata.height,
      });

      await storeVideo(id, blob, sourceVideo);
      await storeThumbnail(id, thumbnail);

      addRecording(buildRecordingEntry({
        sourceVideo,
        now,
        size: blob.size,
        thumbnailUrl: createBlobUrl(thumbnail),
        config,
      }));
    } catch (error) {
      console.error('Failed to save recording:', error);
    }
  }, [setState, addRecording, config]);

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
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'r':
          if (state === 'idle') {
            handleStartRecording();
          }
          break;
        case 'p':
          if (state === 'recording') {
            handlePauseRecording();
          } else if (state === 'paused') {
            handleResumeRecording();
          }
          break;
        case 's':
          if (state === 'recording' || state === 'paused') {
            handleStopRecording();
          }
          break;
        case 'escape':
          if (state === 'countdown') {
            cancelCountdown();
          } else if (state !== 'idle') {
            handleCancelRecording();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, handleStartRecording, handlePauseRecording, handleResumeRecording, handleStopRecording, cancelCountdown, handleCancelRecording]);

  // Delete a recording
  const handleDeleteRecording = async (id: string) => {
    await deleteVideo(id);
    removeRecording(id);
  };

  // Send recording to ESCAPEARTIST (or the host, when embedded)
  const handleSendToEditor = (id: string) => {
    sendToEditor(id);
  };

  // Play a recording
  const handlePlayRecording = async (id: string, name: string) => {
    // Clean up any existing playback
    if (playbackUrl) {
      revokeBlobUrl(playbackUrl);
    }

    const blob = await getVideoBlob(id);
    if (blob) {
      const url = createBlobUrl(blob);
      setPlaybackUrl(url);
      setPlaybackName(name);
      // Pass known duration so the player doesn't depend on WebM metadata
      const recording = recordings.find(r => r.id === id);
      setPlaybackDuration(recording?.duration || 0);
    }
  };

  // Close playback
  const handleClosePlayback = () => {
    if (playbackUrl) {
      revokeBlobUrl(playbackUrl);
    }
    setPlaybackUrl(null);
    setPlaybackName('');
  };

  // Download a recording as WebM (instant — blob is already fixed during save)
  const handleDownload = async (id: string, name: string) => {
    const blob = await getVideoBlob(id);
    if (!blob) return;

    analytics.recordingDownloaded();
    const url = createBlobUrl(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = safeFileName(name);
    a.download = `${safeName}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    revokeBlobUrl(url);
  };

  // Toggle source
  const toggleSource = (source: 'screen' | 'webcam' | 'microphone' | 'systemAudio') => {
    switch (source) {
      case 'screen':
        setConfig({ screenEnabled: !config.screenEnabled });
        break;
      case 'webcam':
        setConfig({ webcamEnabled: !config.webcamEnabled });
        break;
      case 'microphone':
        setConfig({ microphoneEnabled: !config.microphoneEnabled });
        break;
      case 'systemAudio':
        setConfig({ systemAudioEnabled: !config.systemAudioEnabled });
        break;
    }
  };

  const isRecordingActive = state === 'recording' || state === 'paused' || state === 'countdown';

  return (
    <div className={styles.app}>
      {/* Header */}
      <AppHeader state={state} onOpenHelp={() => setShowHelpModal(true)} />

      {/* Main content */}
      <main className={styles.main}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Sources */}
          <SourceToggles
            config={config}
            capabilities={capabilities}
            detailedCapabilities={detailedCapabilities}
            audioLevels={audioLevels}
            isRecordingActive={isRecordingActive}
            onToggleSource={toggleSource}
          />

          {/* Webcam overlay settings */}
          {config.screenEnabled && config.webcamEnabled && (
            <WebcamOverlaySettings
              config={config}
              disabled={isRecordingActive}
              onChange={setConfig}
            />
          )}

          {/* Recordings list */}
          <RecordingsList
            recordings={recordings}
            onPlay={handlePlayRecording}
            onDownload={handleDownload}
            onSendToEditor={handleSendToEditor}
            onDelete={handleDeleteRecording}
          />
        </aside>

        {/* Content area */}
        <div className={styles.content}>
          {/* Preview */}
          <RecordingPreview
            isPiPActive={isPiPActive}
            previewStream={previewStream}
            state={state}
            countdownValue={countdownValue}
            previewRef={previewRef}
            canvasPreviewRef={canvasPreviewRef}
          />

          {/* Controls bar and keyboard shortcuts hint */}
          <RecorderControls
            state={state}
            isRecordingActive={isRecordingActive}
            currentDuration={currentDuration}
            onPause={handlePauseRecording}
            onResume={handleResumeRecording}
            onStart={handleStartRecording}
            onStop={handleStopRecording}
            onCancel={state === 'countdown' ? cancelCountdown : handleCancelRecording}
          />
        </div>
      </main>

      {/* Playback Modal */}
      {playbackUrl && (
        <PlaybackDialog
          url={playbackUrl}
          name={playbackName}
          duration={playbackDuration}
          onClose={handleClosePlayback}
        />
      )}

      {/* Help Modal */}
      {showHelpModal && <HelpDialog onClose={() => setShowHelpModal(false)} />}
    </div>
  );
}

export default App;
