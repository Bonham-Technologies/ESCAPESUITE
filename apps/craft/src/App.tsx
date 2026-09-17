import { useRef, useState } from 'react';
import styles from './App.module.css';
import { useRecorderStore } from './store/recorderStore';
import { useThemeLifecycle } from './hooks/useThemeLifecycle';
import { useCapabilityBootstrap } from './hooks/useCapabilityBootstrap';
import { useMediaStreams } from './hooks/useMediaStreams';
import { useRecordingSave } from './hooks/useRecordingSave';
import { useRecordingController } from './hooks/useRecordingController';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useRecordingLibrary } from './hooks/useRecordingLibrary';
import { recordBlockedReason } from './utils/recordReadiness';
import { AppHeader } from './components/AppHeader/AppHeader';
import type { RecordingSource } from './components/SourceToggles/SourceToggles';
import { SourceTogglesPanel } from './components/SourceToggles/SourceTogglesPanel';
import { WebcamOverlaySettings } from './components/WebcamOverlaySettings/WebcamOverlaySettings';
import { RecordingsListPanel } from './components/RecordingsList/RecordingsListPanel';
import { RecordingPreview } from './components/RecordingPreview/RecordingPreview';
import { RecorderControls } from './components/RecorderControls/RecorderControls';
import { PlaybackDialog } from './components/PlaybackDialog/PlaybackDialog';
import { HelpDialog } from './components/HelpDialog/HelpDialog';

function App() {
  // One selector per field, not a whole-store `useRecorderStore()`: a
  // subscription with no selector re-renders App — and with it every component
  // below and every hook it calls — on *every* store write, including the ~12
  // audio levels a second a running take pushes. The fields only the Sources
  // panel draws (`detailedCapabilities`, `audioLevels`, `systemAudioShared`)
  // are deliberately absent: `SourceTogglesPanel` subscribes to those itself,
  // so a level push redraws the meters and nothing else. `App.rerender.test.tsx`
  // counts it.
  //
  // The actions are selected the same way and cost nothing: zustand creates
  // them once, and `set` only ever merges state over them, so each is a stable
  // reference and no hook's dependency array changes identity because of this.
  const state = useRecorderStore((s) => s.state);
  const config = useRecorderStore((s) => s.config);
  const capabilities = useRecorderStore((s) => s.capabilities);
  const capabilitiesReady = useRecorderStore((s) => s.capabilitiesReady);
  const recordings = useRecorderStore((s) => s.recordings);
  const notice = useRecorderStore((s) => s.notice);
  const hasStorageSpace = useRecorderStore((s) => s.hasStorageSpace);
  const currentDuration = useRecorderStore((s) => s.currentDuration);
  const countdownValue = useRecorderStore((s) => s.countdownValue);
  const setConfig = useRecorderStore((s) => s.setConfig);
  const setCapabilities = useRecorderStore((s) => s.setCapabilities);
  const setDetailedCapabilities = useRecorderStore((s) => s.setDetailedCapabilities);
  const setCapabilitiesReady = useRecorderStore((s) => s.setCapabilitiesReady);
  const setNotice = useRecorderStore((s) => s.setNotice);
  const setSystemAudioShared = useRecorderStore((s) => s.setSystemAudioShared);
  const setState = useRecorderStore((s) => s.setState);
  const setCountdown = useRecorderStore((s) => s.setCountdown);
  const setCurrentDuration = useRecorderStore((s) => s.setCurrentDuration);
  const setAudioLevels = useRecorderStore((s) => s.setAudioLevels);
  const setStreams = useRecorderStore((s) => s.setStreams);
  const addRecording = useRecorderStore((s) => s.addRecording);
  const removeRecording = useRecorderStore((s) => s.removeRecording);
  const loadRecordings = useRecorderStore((s) => s.loadRecordings);
  const refreshStorageSpace = useRecorderStore((s) => s.refreshStorageSpace);

  // The two refs the take and the save share. They are created here, once, and
  // handed to both hooks: useRecordingSave is called before the controller
  // that writes them, and a ref recreated in either hook would leave the save
  // reading a recorder type and a thumbnail nobody wrote.
  const recorderTypeRef = useRef<'webcodecs' | 'mediarecorder'>('mediarecorder');
  const capturedThumbnailRef = useRef<Blob | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // The hooks are called in the order their effects ran in when they were
  // inline, because that order is the behaviour: theme, capability bootstrap,
  // the preview attach and the stopAllStreams mirror, then the unmount
  // teardown that reaches stopAllStreams through that mirror, then the
  // keyboard listener. useRecordingLibrary binds nothing, so where it sits
  // among the others is free — it is called just before the shortcuts because
  // they need its playbackUrl.
  useThemeLifecycle();
  useCapabilityBootstrap({
    setCapabilities,
    setDetailedCapabilities,
    setCapabilitiesReady,
    setNotice,
    loadRecordings,
    refreshStorageSpace,
  });

  const {
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
  } = useMediaStreams({ config, capabilities, setStreams });

  const saveRecording = useRecordingSave({
    recorderTypeRef,
    capturedThumbnailRef,
    config,
    setState,
    addRecording,
    setNotice,
  });

  // Why the Record button (and the R shortcut with it) cannot start a take.
  // Computed here because it is a fact about the store, not about the bar.
  const blockedReason = recordBlockedReason(capabilitiesReady, config, capabilities, hasStorageSpace);

  const {
    cancelCountdown,
    handleCancelRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleStopRecording,
    handleStartRecording,
  } = useRecordingController({
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
  });

  const {
    playbackUrl,
    playbackName,
    playbackDuration,
    handleDeleteRecording,
    handleSendToEditor,
    handlePlayRecording,
    handleClosePlayback,
    handleDownload,
  } = useRecordingLibrary({ recordings, removeRecording, refreshStorageSpace });

  useKeyboardShortcuts({
    state,
    canRecord: blockedReason === null,
    // Either dialog makes the app behind it deaf to R / P / S / Escape.
    // useRecordingLibrary owns playbackUrl, which is why it is called above
    // rather than last; it registers no effect, so the effect order the
    // comment above describes is unchanged.
    modalOpen: showHelpModal || playbackUrl !== null,
    handleStartRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleStopRecording,
    cancelCountdown,
    handleCancelRecording,
  });

  // Toggle source
  const toggleSource = (source: RecordingSource) => {
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
      <AppHeader state={state} notice={notice} onOpenHelp={() => setShowHelpModal(true)} />

      {/* Main content */}
      <main className={styles.main}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Sources */}
          <SourceTogglesPanel
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

          {/* Recordings list — the panel owns the MP4 conversion state, so a
              progress report redraws the library and not this whole tree. */}
          <RecordingsListPanel
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
            blockedReason={blockedReason}
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
