import { useEffect, useRef, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import styles from './App.module.css';
import { useRecorderStore } from './store/recorderStore';
import type { WebcamPosition, WebcamShape } from './store/types';
import {
  detectCapabilities,
  requestScreenCapture,
  requestWebcam,
  requestMicrophone,
  stopStream,
} from './core/permissions';
import { Recorder } from './core/recorder';
import { Compositor } from './core/compositor';
import { StreamWatermarker } from './core/watermark';
import { storeVideo, storeThumbnail, deleteVideo, getVideoBlob, createBlobUrl, revokeBlobUrl } from './core/storage';
import { generateThumbnail, extractVideoMetadata } from './core/thumbnailGenerator';
import { useAuth, isStandaloneMode } from './auth';
import { analytics } from './utils/analytics';
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme';
import { themeStorage } from './utils/themeStorage';

function App() {
  const {
    state,
    config,
    capabilities,
    recordings,
    currentDuration,
    countdownValue,
    audioLevels,
    screenStream,
    webcamStream,
    setConfig,
    setCapabilities,
    setState,
    setCountdown,
    setCurrentDuration,
    setAudioLevels,
    setStreams,
    addRecording,
    removeRecording,
    loadRecordings,
  } = useRecorderStore();

  const { isTrial } = useAuth();

  const recorderRef = useRef<Recorder | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const watermarkerRef = useRef<StreamWatermarker | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const capturedThumbnailRef = useRef<Blob | null>(null);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackName, setPlaybackName] = useState<string>('');

  // Capture thumbnail from preview video element
  const capturePreviewThumbnail = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = previewRef.current;
      if (!video || video.videoWidth === 0) {
        resolve(null);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      try {
        ctx.drawImage(video, 0, 0, 320, 180);
        canvas.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          0.8
        );
      } catch {
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
    detectCapabilities().then(setCapabilities);
    loadRecordings();
  }, [setCapabilities, loadRecordings]);

  // Update preview video element
  useEffect(() => {
    if (previewRef.current && previewStream) {
      previewRef.current.srcObject = previewStream;
      previewRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  // Stop all streams helper
  const stopAllStreams = useCallback(() => {
    stopStream(screenStream);
    stopStream(webcamStream);
    setStreams(null, null);
    setPreviewStream(null);

    if (compositorRef.current) {
      compositorRef.current.dispose();
      compositorRef.current = null;
    }

    if (watermarkerRef.current) {
      watermarkerRef.current.dispose();
      watermarkerRef.current = null;
    }
  }, [screenStream, webcamStream, setStreams]);

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
      recorderRef.current.stop();
    }
  }, [capturePreviewThumbnail]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
  const saveRecording = useCallback(async (blob: Blob, recordedDuration: number) => {
    setState('saving');

    try {
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
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, 320, 180);
            ctx.fillStyle = '#666';
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Recording', 160, 95);
          }
          thumbnail = await new Promise<Blob>((resolve) => {
            canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.8);
          });
        }
      }
      capturedThumbnailRef.current = null; // Clear for next recording

      // Use recorded duration if metadata extraction failed
      const duration = metadata.duration > 0 ? metadata.duration : recordedDuration;

      const sourceVideo = {
        id,
        name: `Recording ${new Date(now).toLocaleString()}`,
        duration,
        width: metadata.width,
        height: metadata.height,
        frameRate: 30,
        mimeType: blob.type,
        size: blob.size,
        mediaType: 'video' as const,
        source: 'recording' as const,
        recordedAt: now,
      };

      await storeVideo(id, blob, sourceVideo);
      await storeThumbnail(id, thumbnail);

      addRecording({
        id,
        name: sourceVideo.name,
        duration,
        createdAt: now,
        size: blob.size,
        thumbnailUrl: createBlobUrl(thumbnail),
        hasWebcam: config.webcamEnabled,
        hasAudio: config.microphoneEnabled || config.systemAudioEnabled,
      });
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
      setState('preparing');

      const { screen, webcam, mic } = await acquireStreams();
      setStreams(screen, webcam);

      // Set up preview (with watermark for trial users)
      const watermarkConfig = isTrial ? {
        text: 'ESCAPE Suite Trial',
        subtext: 'escapesuite.io',
        opacity: 0.5,
        fontSize: 24,
      } : null;

      if (config.screenEnabled && config.webcamEnabled && screen && webcam) {
        // PiP mode - use compositor
        const videoTrack = screen.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        compositorRef.current = new Compositor(
          settings.width || 1920,
          settings.height || 1080,
          {
            webcamPosition: config.webcamPosition,
            webcamSize: config.webcamSize,
            webcamShape: config.webcamShape,
            watermark: watermarkConfig,
          }
        );
        compositorRef.current.setScreenStream(screen);
        compositorRef.current.setWebcamStream(webcam);
        const composedStream = compositorRef.current.start();
        setPreviewStream(composedStream);
      } else if (screen && isTrial) {
        // Single source with watermark for trial users
        const videoTrack = screen.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        watermarkerRef.current = new StreamWatermarker(
          settings.width || 1920,
          settings.height || 1080,
          watermarkConfig || undefined
        );
        watermarkerRef.current.setStream(screen);
        const watermarkedStream = watermarkerRef.current.start();
        setPreviewStream(watermarkedStream);
      } else if (webcam && isTrial) {
        // Webcam only with watermark for trial users
        const videoTrack = webcam.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        watermarkerRef.current = new StreamWatermarker(
          settings.width || 1280,
          settings.height || 720,
          watermarkConfig || undefined
        );
        watermarkerRef.current.setStream(webcam);
        const watermarkedStream = watermarkerRef.current.start();
        setPreviewStream(watermarkedStream);
      } else if (screen) {
        setPreviewStream(screen);
      } else if (webcam) {
        setPreviewStream(webcam);
      }

      // Initialize recorder
      recorderRef.current = new Recorder({
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
        onStop: async (blob) => {
          // Capture duration before resetting
          const recordedDuration = recorderRef.current?.getDuration() || useRecorderStore.getState().currentDuration;
          await saveRecording(blob, recordedDuration);
          analytics.recordingCompleted(recordedDuration);
          setState('idle');
          setCurrentDuration(0);
          stopAllStreams();
        },
        onError: (error) => {
          console.error('Recording error:', error);
          setState('idle');
          setCurrentDuration(0);
          stopAllStreams();
        },
        onAudioLevels: setAudioLevels,
      });

      // Use composed/watermarked stream for recording
      let recordingScreen: MediaStream | null = screen;

      if (config.screenEnabled && config.webcamEnabled && compositorRef.current) {
        // PiP mode - use compositor output
        recordingScreen = new MediaStream([
          ...compositorRef.current.getCanvas().captureStream(30).getVideoTracks(),
          ...(screen?.getAudioTracks() || []),
        ]);
      } else if (watermarkerRef.current) {
        // Single source with watermark
        recordingScreen = new MediaStream([
          ...watermarkerRef.current.getCanvas().captureStream(30).getVideoTracks(),
          ...(screen?.getAudioTracks() || webcam?.getAudioTracks() || []),
        ]);
      }

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
    isTrial,
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

  // Send recording to ESCAPEARTIST
  const handleSendToEditor = (id: string) => {
    analytics.recordingSentToEditor();
    // Open ESCAPEARTIST with the video ID
    const editorUrl = `/artist/?loadVideo=${id}`;
    window.open(editorUrl, 'escapeartist');
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

  // Download a recording
  const handleDownloadRecording = async (id: string, name: string) => {
    const blob = await getVideoBlob(id);
    if (blob) {
      analytics.recordingDownloaded();
      const url = createBlobUrl(blob);
      const a = document.createElement('a');
      a.href = url;
      // Create a safe filename
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeName}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      revokeBlobUrl(url);
    }
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
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          {!isStandaloneMode() && (
            <a href="/dashboard" className={styles.dashboardLink} title="Back to Dashboard">
              ← Dashboard
            </a>
          )}
          <h1 className={styles.logo}>ESCAPECRAFT</h1>
        </div>

        <div className={styles.headerCenter}>
          {state === 'recording' && (
            <span className={styles.recordingIndicator}>
              <span className={styles.recordingDot} />
              Recording
            </span>
          )}
          {state === 'paused' && (
            <span className={styles.pausedIndicator}>Paused</span>
          )}
        </div>

        <div className={styles.headerRight}>
          <button
            className={`${styles.headerButton} ${styles.editorButton}`}
            onClick={() => window.open('/artist/', 'escapeartist')}
            title="Open Editor"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open Editor
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Sources */}
          <section className={styles.sidebarSection}>
            <h3 className={styles.sidebarTitle}>Sources</h3>
            <div className={styles.sourceToggles}>
              <div className={styles.sourceToggle}>
                <span className={styles.sourceLabel}>
                  <ScreenIcon className={styles.sourceIcon} />
                  Screen
                </span>
                <button
                  className={`${styles.toggle} ${config.screenEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('screen')}
                  disabled={!capabilities.screenCapture || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div className={styles.sourceToggle}>
                <span className={styles.sourceLabel}>
                  <WebcamIcon className={styles.sourceIcon} />
                  Webcam
                </span>
                <button
                  className={`${styles.toggle} ${config.webcamEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('webcam')}
                  disabled={!capabilities.webcam || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div className={styles.sourceToggle}>
                <span className={styles.sourceLabel}>
                  <MicIcon className={styles.sourceIcon} />
                  Microphone
                </span>
                <button
                  className={`${styles.toggle} ${config.microphoneEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('microphone')}
                  disabled={!capabilities.microphone || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div className={styles.sourceToggle}>
                <span className={styles.sourceLabel}>
                  <SpeakerIcon className={styles.sourceIcon} />
                  System Audio
                </span>
                <button
                  className={`${styles.toggle} ${config.systemAudioEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('systemAudio')}
                  disabled={!capabilities.systemAudio || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            </div>

            {/* Audio meters */}
            {(config.microphoneEnabled || config.systemAudioEnabled) && isRecordingActive && (
              <div className={styles.audioMeters}>
                {config.microphoneEnabled && (
                  <div className={styles.audioMeter}>
                    <span className={styles.meterLabel}>Mic</span>
                    <div className={styles.meterBar}>
                      <div
                        className={styles.meterFill}
                        style={{ width: `${audioLevels.microphone * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {config.systemAudioEnabled && (
                  <div className={styles.audioMeter}>
                    <span className={styles.meterLabel}>System</span>
                    <div className={styles.meterBar}>
                      <div
                        className={styles.meterFill}
                        style={{ width: `${audioLevels.system * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Webcam overlay settings */}
          {config.screenEnabled && config.webcamEnabled && (
            <section className={styles.sidebarSection}>
              <h3 className={styles.sidebarTitle}>Webcam Overlay</h3>
              <div className={styles.webcamControls}>
                <div className={styles.positionGrid}>
                  {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as WebcamPosition[]).map(
                    (pos) => (
                      <button
                        key={pos}
                        className={`${styles.positionButton} ${
                          config.webcamPosition === pos ? styles.active : ''
                        }`}
                        onClick={() => setConfig({ webcamPosition: pos })}
                        disabled={isRecordingActive}
                      >
                        {pos.replace('-', ' ')}
                      </button>
                    )
                  )}
                </div>

                <div className={styles.sizeSlider}>
                  <span className={styles.meterLabel}>Size</span>
                  <input
                    type="range"
                    className={styles.slider}
                    min="0.1"
                    max="0.4"
                    step="0.05"
                    value={config.webcamSize}
                    onChange={(e) => setConfig({ webcamSize: parseFloat(e.target.value) })}
                    disabled={isRecordingActive}
                  />
                </div>

                <div className={styles.shapeToggle}>
                  {(['circle', 'rectangle'] as WebcamShape[]).map((shape) => (
                    <button
                      key={shape}
                      className={`${styles.shapeButton} ${
                        config.webcamShape === shape ? styles.active : ''
                      }`}
                      onClick={() => setConfig({ webcamShape: shape })}
                      disabled={isRecordingActive}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Recordings list */}
          <section className={styles.sidebarSection} style={{ flex: 1, overflow: 'hidden' }}>
            <h3 className={styles.sidebarTitle}>Recordings</h3>
            <div className={styles.recordingsList}>
              {recordings.length === 0 ? (
                <div className={styles.emptyState}>
                  <RecordIcon className={styles.emptyIcon} />
                  <p>No recordings yet</p>
                </div>
              ) : (
                recordings.map((recording) => (
                  <div key={recording.id} className={styles.recordingItem}>
                    {recording.thumbnailUrl ? (
                      <img
                        src={recording.thumbnailUrl}
                        alt=""
                        className={styles.recordingThumbnail}
                      />
                    ) : (
                      <div className={styles.recordingThumbnail} />
                    )}
                    <div className={styles.recordingInfo}>
                      <div className={styles.recordingName}>{recording.name}</div>
                      <div className={styles.recordingMeta}>
                        {formatDuration(recording.duration)} •{' '}
                        {(recording.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                    </div>
                    <div className={styles.recordingActions}>
                      <button
                        className={styles.iconButton}
                        onClick={() => handlePlayRecording(recording.id, recording.name)}
                        title="Play"
                      >
                        <PlayIcon />
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleDownloadRecording(recording.id, recording.name)}
                        title="Download"
                      >
                        <DownloadIcon />
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleSendToEditor(recording.id)}
                        title="Open in Editor"
                      >
                        <EditIcon />
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleDeleteRecording(recording.id)}
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        {/* Content area */}
        <div className={styles.content}>
          {/* Preview */}
          <div className={styles.previewContainer}>
            <div className={styles.preview}>
              {previewStream ? (
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div className={styles.previewPlaceholder}>
                  <ScreenIcon className={styles.previewIcon} />
                  <p>Click record to start capturing</p>
                </div>
              )}

              {/* Countdown overlay */}
              {state === 'countdown' && countdownValue > 0 && (
                <div className={styles.countdown}>
                  <span className={styles.countdownNumber}>{countdownValue}</span>
                </div>
              )}
            </div>
          </div>

          {/* Controls bar */}
          <div className={styles.controlsBar}>
            {/* Pause/Resume button */}
            {(state === 'recording' || state === 'paused') && (
              <button
                className={styles.controlButton}
                onClick={state === 'recording' ? handlePauseRecording : handleResumeRecording}
                title={state === 'recording' ? 'Pause (P)' : 'Resume (P)'}
              >
                {state === 'recording' ? <PauseIcon /> : <PlayIcon />}
              </button>
            )}

            {/* Timer */}
            <span className={`${styles.timer} ${isRecordingActive ? styles.recording : ''}`}>
              {formatDuration(currentDuration)}
            </span>

            {/* Main record button */}
            <button
              className={`${styles.recordButton} ${isRecordingActive ? styles.recording : ''}`}
              onClick={
                state === 'idle'
                  ? handleStartRecording
                  : isRecordingActive
                  ? handleStopRecording
                  : undefined
              }
              disabled={state === 'preparing' || state === 'saving'}
              title={state === 'idle' ? 'Record (R)' : 'Stop (S)'}
            >
              <span className={styles.recordButtonInner} />
            </button>

            {/* Cancel button */}
            {isRecordingActive && (
              <button
                className={styles.controlButton}
                onClick={state === 'countdown' ? cancelCountdown : handleCancelRecording}
                title="Cancel (Esc)"
              >
                <CloseIcon />
              </button>
            )}
          </div>

          {/* Keyboard shortcuts hint */}
          <div className={styles.shortcutsHint}>
            <span className={styles.shortcut}>
              <kbd className={styles.shortcutKey}>R</kbd> Record
            </span>
            <span className={styles.shortcut}>
              <kbd className={styles.shortcutKey}>P</kbd> Pause
            </span>
            <span className={styles.shortcut}>
              <kbd className={styles.shortcutKey}>S</kbd> Stop
            </span>
            <span className={styles.shortcut}>
              <kbd className={styles.shortcutKey}>Esc</kbd> Cancel
            </span>
          </div>
        </div>
      </main>

      {/* Playback Modal */}
      {playbackUrl && (
        <div className={styles.playbackModal} onClick={handleClosePlayback}>
          <div className={styles.playbackContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.playbackHeader}>
              <span className={styles.playbackTitle}>{playbackName}</span>
              <button
                className={styles.playbackClose}
                onClick={handleClosePlayback}
                title="Close"
              >
                <CloseIcon />
              </button>
            </div>
            <video
              className={styles.playbackVideo}
              src={playbackUrl}
              controls
              autoPlay
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Icons
function ScreenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function WebcamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function RecordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default App;
