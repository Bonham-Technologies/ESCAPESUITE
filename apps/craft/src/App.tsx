import { useEffect, useRef, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import styles from './App.module.css';
import { VideoPlayer } from './components/VideoPlayer';
import { useRecorderStore } from './store/recorderStore';
import type { WebcamPosition, WebcamShape } from './store/types';
import {
  detectCapabilities,
  requestScreenCapture,
  requestWebcam,
  requestMicrophone,
  stopStream,
} from './core/permissions';
import { createRecorder, type AnyRecorder } from './core/recorder-factory';
import { Compositor } from './core/compositor';
import { storeVideo, storeThumbnail, deleteVideo, getVideoBlob, createBlobUrl, revokeBlobUrl } from './core/storage';
import { generateThumbnail, extractVideoMetadata } from './core/thumbnailGenerator';
import { convertToMP4, fixWebMMetadata, remuxToWebM, isMP4ConversionSupported, isWebMRemuxSupported, ConversionAbortedError, type ConversionProgress } from './core/converter';
import { isStandaloneMode } from './auth';
import { analytics } from './utils/analytics';
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme';
import { themeStorage } from './utils/themeStorage';

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
    screenStream,
    webcamStream,
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
  const compositorRef = useRef<Compositor | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const capturedThumbnailRef = useRef<Blob | null>(null);
  const conversionAbortRef = useRef<AbortController | null>(null);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackName, setPlaybackName] = useState<string>('');
  const [downloadMenuOpen, setDownloadMenuOpen] = useState<string | null>(null); // recording ID or null
  const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);

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
    detectCapabilities().then((result) => {
      setCapabilities(result.capabilities);
      setDetailedCapabilities(result.detailed);
    });
    loadRecordings();
  }, [setCapabilities, setDetailedCapabilities, loadRecordings]);

  // Update preview video element
  useEffect(() => {
    if (previewRef.current && previewStream) {
      previewRef.current.srcObject = previewStream;
      previewRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  // Close download menu when clicking outside
  useEffect(() => {
    if (!downloadMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(`.${styles.downloadDropdown}`)) {
        setDownloadMenuOpen(null);
        setDownloadMenuPosition(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [downloadMenuOpen]);

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

      // Set up preview
      // Note: Watermarks are NOT applied during recording - they are added at export time
      // This avoids canvas.captureStream() issues with hidden video elements

      if (config.screenEnabled && config.webcamEnabled && screen && webcam) {
        // PiP mode - use compositor (no watermark during recording, applied at export)
        const videoTrack = screen.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        compositorRef.current = new Compositor(
          settings.width || 1920,
          settings.height || 1080,
          {
            webcamPosition: config.webcamPosition,
            webcamSize: config.webcamSize,
            webcamShape: config.webcamShape,
            // No watermark during recording - applied at export for trial users
          }
        );
        compositorRef.current.setScreenStream(screen);
        compositorRef.current.setWebcamStream(webcam);
        const composedStream = compositorRef.current.start();
        setPreviewStream(composedStream);
      } else if (screen) {
        // Screen only - use raw stream (watermark applied at export for trial users)
        setPreviewStream(screen);
      } else if (webcam) {
        setPreviewStream(webcam);
      }

      // Initialize recorder (uses WebCodecs if available for proper WebM containers)
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

      // Use raw streams for recording - watermarks are applied at export time
      // This avoids canvas.captureStream() issues with hidden video elements
      let recordingScreen: MediaStream | null = screen;

      if (config.screenEnabled && config.webcamEnabled && compositorRef.current) {
        // PiP mode - use compositor output (required to combine screen + webcam)
        // Note: PiP compositor is still needed but watermark will be added at export
        recordingScreen = new MediaStream([
          ...compositorRef.current.getCanvas().captureStream(30).getVideoTracks(),
          ...(screen?.getAudioTracks() || []),
        ]);
      }
      // For single-source recordings (screen-only or webcam-only), use raw stream
      // Watermark will be applied during export for trial users

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
      // Fix WebM metadata for proper seeking/scrubbing
      // MediaRecorder WebM files lack seek cues, making timeline scrubbing unreliable
      try {
        const fixedBlob = await fixWebMMetadata(blob);
        const url = createBlobUrl(fixedBlob);
        setPlaybackUrl(url);
        setPlaybackName(name);
      } catch (error) {
        // Fall back to raw blob if metadata fix fails
        console.warn('WebM metadata fix failed for playback:', error);
        const url = createBlobUrl(blob);
        setPlaybackUrl(url);
        setPlaybackName(name);
      }
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

  // Download a recording as WebM
  const handleDownloadWebM = async (id: string, name: string) => {
    setDownloadMenuOpen(null);
    setDownloadMenuPosition(null);

    const blob = await getVideoBlob(id);
    if (!blob) return;

    try {
      // Fix WebM metadata for proper seeking/playback (near-instant, no re-encoding)
      const fixedBlob = await fixWebMMetadata(blob);

      analytics.recordingDownloaded();
      const url = createBlobUrl(fixedBlob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeName}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      revokeBlobUrl(url);
    } catch (error) {
      console.error('WebM metadata fix failed:', error);
      // Fall back to raw download
      analytics.recordingDownloaded();
      const url = createBlobUrl(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeName}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      revokeBlobUrl(url);
    }
  };

  // Download a recording as MP4 (convert from WebM)
  const handleDownloadMP4 = async (id: string, name: string) => {
    setDownloadMenuOpen(null);
    setDownloadMenuPosition(null);
    setConvertingId(id);
    setConversionProgress({ phase: 'preparing', progress: 0, message: 'Starting conversion...' });

    // Create AbortController for cancellation
    conversionAbortRef.current = new AbortController();

    try {
      const blob = await getVideoBlob(id);
      if (!blob) {
        throw new Error('Recording not found');
      }

      const mp4Blob = await convertToMP4(blob, (progress) => {
        setConversionProgress(progress);
      }, conversionAbortRef.current.signal);

      // Download the MP4
      analytics.recordingDownloaded();
      const url = createBlobUrl(mp4Blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeName}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      revokeBlobUrl(url);
    } catch (error) {
      if (error instanceof ConversionAbortedError) {
        console.log('MP4 conversion cancelled by user');
      } else {
        console.error('MP4 conversion failed:', error);
        alert('Failed to convert to MP4. Please try downloading as WebM instead.');
      }
    } finally {
      conversionAbortRef.current = null;
      setConvertingId(null);
      setConversionProgress(null);
    }
  };

  // Download a recording as WebM with proper container (re-encoded for compatibility)
  const handleDownloadWebMCompatible = async (id: string, name: string) => {
    setDownloadMenuOpen(null);
    setDownloadMenuPosition(null);

    // Find the recording to get its duration
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    setConvertingId(id);
    setConversionProgress({ phase: 'preparing', progress: 0, message: 'Preparing WebM...' });

    // Create AbortController for cancellation
    conversionAbortRef.current = new AbortController();

    try {
      const blob = await getVideoBlob(id);
      if (!blob) {
        throw new Error('Recording not found');
      }

      const remuxedBlob = await remuxToWebM(blob, recording.duration, (progress) => {
        setConversionProgress(progress);
      }, conversionAbortRef.current.signal);

      // Download the remuxed WebM
      analytics.recordingDownloaded();
      const url = createBlobUrl(remuxedBlob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${safeName}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      revokeBlobUrl(url);
    } catch (error) {
      if (error instanceof ConversionAbortedError) {
        console.log('WebM conversion cancelled by user');
      } else {
        console.error('WebM remuxing failed:', error);
        alert('Failed to create compatible WebM. Please try MP4 instead.');
      }
    } finally {
      conversionAbortRef.current = null;
      setConvertingId(null);
      setConversionProgress(null);
    }
  };

  // Cancel ongoing conversion
  const handleCancelConversion = () => {
    if (conversionAbortRef.current) {
      conversionAbortRef.current.abort();
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

        <div className={styles.headerCenter} aria-live="polite" aria-atomic="true">
          {state === 'recording' && (
            <span className={styles.recordingIndicator} role="status">
              <span className={styles.recordingDot} aria-hidden="true" />
              Recording
            </span>
          )}
          {state === 'paused' && (
            <span className={styles.pausedIndicator} role="status">Paused</span>
          )}
        </div>

        <div className={styles.headerRight}>
          <button
            className={styles.headerButton}
            onClick={() => setShowHelpModal(true)}
            title="Recording Tips"
            aria-label="Help - Recording Tips"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Help
          </button>
          <button
            className={`${styles.headerButton} ${styles.editorButton}`}
            onClick={() => window.open('/artist/', 'escapeartist')}
            title="Open Editor"
            aria-label="Open Editor in new window"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
              <div
                className={`${styles.sourceToggle} ${!detailedCapabilities.screenCapture.available ? styles.sourceUnavailable : ''}`}
                title={detailedCapabilities.screenCapture.message}
              >
                <span className={styles.sourceLabel}>
                  <ScreenIcon className={styles.sourceIcon} />
                  Screen
                  {!detailedCapabilities.screenCapture.available && (
                    <UnavailableIcon className={styles.unavailableIcon} />
                  )}
                </span>
                <button
                  className={`${styles.toggle} ${config.screenEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('screen')}
                  disabled={!capabilities.screenCapture || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div
                className={`${styles.sourceToggle} ${!detailedCapabilities.webcam.available ? styles.sourceUnavailable : ''}`}
                title={detailedCapabilities.webcam.message}
              >
                <span className={styles.sourceLabel}>
                  <WebcamIcon className={styles.sourceIcon} />
                  Webcam
                  {!detailedCapabilities.webcam.available && (
                    <UnavailableIcon className={styles.unavailableIcon} />
                  )}
                </span>
                <button
                  className={`${styles.toggle} ${config.webcamEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('webcam')}
                  disabled={!capabilities.webcam || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div
                className={`${styles.sourceToggle} ${!detailedCapabilities.microphone.available ? styles.sourceUnavailable : ''}`}
                title={detailedCapabilities.microphone.message}
              >
                <span className={styles.sourceLabel}>
                  <MicIcon className={styles.sourceIcon} />
                  Microphone
                  {!detailedCapabilities.microphone.available && (
                    <UnavailableIcon className={styles.unavailableIcon} />
                  )}
                </span>
                <button
                  className={`${styles.toggle} ${config.microphoneEnabled ? styles.active : ''}`}
                  onClick={() => toggleSource('microphone')}
                  disabled={!capabilities.microphone || isRecordingActive}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              <div
                className={`${styles.sourceToggle} ${!detailedCapabilities.systemAudio.available ? styles.sourceUnavailable : ''}`}
                title={detailedCapabilities.systemAudio.message}
              >
                <span className={styles.sourceLabel}>
                  <SpeakerIcon className={styles.sourceIcon} />
                  System Audio
                  {!detailedCapabilities.systemAudio.available && (
                    <UnavailableIcon className={styles.unavailableIcon} />
                  )}
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
                  <label htmlFor="webcam-size-slider" className={styles.meterLabel}>Size</label>
                  <input
                    id="webcam-size-slider"
                    type="range"
                    className={styles.slider}
                    min="0.1"
                    max="0.4"
                    step="0.05"
                    value={config.webcamSize}
                    onChange={(e) => setConfig({ webcamSize: parseFloat(e.target.value) })}
                    disabled={isRecordingActive}
                    aria-label="Webcam overlay size"
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
                        aria-label={`Play ${recording.name}`}
                      >
                        <PlayIcon />
                      </button>
                      <div className={styles.downloadDropdown}>
                        <button
                          className={styles.iconButton}
                          onClick={(e) => {
                            if (downloadMenuOpen === recording.id) {
                              setDownloadMenuOpen(null);
                              setDownloadMenuPosition(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setDownloadMenuPosition({
                                top: rect.bottom + 4,
                                left: rect.left + rect.width / 2 - 70, // Center the 140px menu
                              });
                              setDownloadMenuOpen(recording.id);
                            }
                          }}
                          title="Download"
                          aria-label={`Download ${recording.name}`}
                          aria-expanded={downloadMenuOpen === recording.id}
                          aria-haspopup="menu"
                          disabled={convertingId === recording.id}
                        >
                          {convertingId === recording.id ? (
                            <span className={styles.spinnerSmall} aria-label="Converting..." />
                          ) : (
                            <DownloadIcon />
                          )}
                        </button>
                        {downloadMenuOpen === recording.id && downloadMenuPosition && (
                          <div
                            className={styles.downloadMenu}
                            style={{ top: downloadMenuPosition.top, left: downloadMenuPosition.left }}
                          >
                            <button
                              className={styles.downloadMenuItem}
                              onClick={() => handleDownloadWebM(recording.id, recording.name)}
                              title="Fast download, works in browsers and VLC"
                            >
                              <span>WebM</span>
                              <span className={styles.downloadMenuHint}>Instant</span>
                            </button>
                            {isWebMRemuxSupported() && (
                              <button
                                className={styles.downloadMenuItem}
                                onClick={() => handleDownloadWebMCompatible(recording.id, recording.name)}
                                title="Re-encoded for Windows Media Player compatibility"
                              >
                                <span>WebM</span>
                                <span className={styles.downloadMenuHint}>Compatible</span>
                              </button>
                            )}
                            {isMP4ConversionSupported() && (
                              <button
                                className={styles.downloadMenuItem}
                                onClick={() => handleDownloadMP4(recording.id, recording.name)}
                                title="Universal compatibility (H.264 + AAC)"
                              >
                                <span>MP4</span>
                                <span className={styles.downloadMenuHint}>Universal</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleSendToEditor(recording.id)}
                        title="Open in Editor"
                        aria-label={`Open ${recording.name} in Editor`}
                      >
                        <EditIcon />
                      </button>
                      <button
                        className={styles.iconButton}
                        onClick={() => handleDeleteRecording(recording.id)}
                        title="Delete"
                        aria-label={`Delete ${recording.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                    {convertingId === recording.id && conversionProgress && (
                      <div className={styles.conversionProgress}>
                        <div className={styles.conversionProgressHeader}>
                          <span className={styles.conversionProgressText}>
                            {conversionProgress.message}
                          </span>
                          <button
                            className={styles.conversionCancelButton}
                            onClick={handleCancelConversion}
                            title="Cancel conversion"
                            aria-label="Cancel conversion"
                          >
                            ✕
                          </button>
                        </div>
                        <div className={styles.conversionProgressBar}>
                          <div
                            className={styles.conversionProgressFill}
                            style={{ width: `${conversionProgress.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
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
                aria-label={state === 'recording' ? 'Pause recording' : 'Resume recording'}
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
              aria-label={state === 'idle' ? 'Start recording' : 'Stop recording'}
            >
              <span className={styles.recordButtonInner} aria-hidden="true" />
            </button>

            {/* Cancel button */}
            {isRecordingActive && (
              <button
                className={styles.controlButton}
                onClick={state === 'countdown' ? cancelCountdown : handleCancelRecording}
                title="Cancel (Esc)"
                aria-label="Cancel recording"
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
        <div className={styles.playbackModal} onClick={handleClosePlayback} role="dialog" aria-modal="true" aria-labelledby="playback-title">
          <div className={styles.playbackContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.playbackHeader}>
              <span id="playback-title" className={styles.playbackTitle}>{playbackName}</span>
              <button
                className={styles.playbackClose}
                onClick={handleClosePlayback}
                title="Close (Esc)"
                aria-label="Close playback"
              >
                <CloseIcon />
              </button>
            </div>
            <VideoPlayer
              src={playbackUrl}
              title={playbackName}
              autoPlay
              onClose={handleClosePlayback}
              onError={(error) => console.error('Video playback error:', error)}
            />
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelpModal && (
        <div className={styles.helpModal} onClick={() => setShowHelpModal(false)} role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className={styles.helpContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.helpHeader}>
              <h2 id="help-title" className={styles.helpTitle}>Recording Tips</h2>
              <button
                className={styles.helpClose}
                onClick={() => setShowHelpModal(false)}
                title="Close"
                aria-label="Close help"
              >
                <CloseIcon />
              </button>
            </div>

            <div className={styles.helpBody}>
              <section className={styles.helpSection}>
                <h3>Choosing What to Record</h3>
                <p>When you start recording, your browser will ask what you want to capture:</p>
                <ul>
                  <li>
                    <strong>Entire Screen</strong> (Recommended) - Captures everything on your monitor.
                    Best for tutorials and demos where you switch between apps.
                  </li>
                  <li>
                    <strong>Window</strong> - Captures a specific application window.
                    Note: For browser windows, only the active tab is visible.
                  </li>
                  <li>
                    <strong>Browser Tab</strong> - Captures a single browser tab.
                    Good for recording web content without distractions.
                  </li>
                </ul>
              </section>

              <section className={styles.helpSection}>
                <h3>Best Practices</h3>
                <ul>
                  <li>
                    <strong>Use "Entire Screen" for multi-app recordings</strong> - This ensures
                    everything you do is captured, regardless of which window is focused.
                  </li>
                  <li>
                    <strong>Keep ESCAPECRAFT in a separate window</strong> - If using window capture,
                    run ESCAPECRAFT in its own browser window so it doesn't appear in your recording.
                  </li>
                  <li>
                    <strong>Check "Share system audio"</strong> - Enable this in the capture dialog
                    to record sounds from videos, games, and other applications.
                  </li>
                  <li>
                    <strong>Use keyboard shortcuts</strong> - Press <kbd>R</kbd> to start,
                    <kbd>P</kbd> to pause, <kbd>S</kbd> to stop, and <kbd>Esc</kbd> to cancel.
                  </li>
                </ul>
              </section>

              <section className={styles.helpSection}>
                <h3>Recording Modes</h3>
                <ul>
                  <li><strong>Screen Only</strong> - Just your screen, no audio</li>
                  <li><strong>Screen + Mic</strong> - Screen with your voice narration</li>
                  <li><strong>Screen + System Audio</strong> - Screen with app sounds</li>
                  <li><strong>Screen + Both</strong> - Screen with mic and system audio</li>
                  <li><strong>Webcam Only</strong> - Just your camera with microphone</li>
                  <li><strong>Picture-in-Picture</strong> - Screen with webcam overlay</li>
                </ul>
              </section>

              <section className={styles.helpSection}>
                <h3>Download Formats</h3>
                <ul>
                  <li>
                    <strong>WebM</strong> - Native browser format. Instant download, works great
                    in Chrome, Firefox, and most video editors.
                  </li>
                  <li>
                    <strong>MP4</strong> - Universal format. Takes a moment to convert but plays
                    everywhere including Windows Media Player and QuickTime.
                  </li>
                </ul>
              </section>
            </div>
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

function UnavailableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
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
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default App;
