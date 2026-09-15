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
import { SourceToggles, type RecordingSource } from './components/SourceToggles/SourceToggles';
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
    capabilitiesReady,
    recordings,
    notice,
    systemAudioShared,
    currentDuration,
    countdownValue,
    audioLevels,
    setConfig,
    setCapabilities,
    setDetailedCapabilities,
    setCapabilitiesReady,
    setNotice,
    setSystemAudioShared,
    setState,
    setCountdown,
    setCurrentDuration,
    setAudioLevels,
    setStreams,
    addRecording,
    removeRecording,
    loadRecordings,
  } = useRecorderStore();

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
  // keyboard listener. useRecordingLibrary binds nothing and comes last.
  useThemeLifecycle();
  useCapabilityBootstrap({
    setCapabilities,
    setDetailedCapabilities,
    setCapabilitiesReady,
    setNotice,
    loadRecordings,
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
  const blockedReason = recordBlockedReason(capabilitiesReady, config, capabilities);

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
  });

  useKeyboardShortcuts({
    state,
    canRecord: blockedReason === null,
    handleStartRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleStopRecording,
    cancelCountdown,
    handleCancelRecording,
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
  } = useRecordingLibrary({ recordings, removeRecording });

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
          <SourceToggles
            config={config}
            capabilities={capabilities}
            detailedCapabilities={detailedCapabilities}
            audioLevels={audioLevels}
            isRecordingActive={isRecordingActive}
            systemAudioShared={systemAudioShared}
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
