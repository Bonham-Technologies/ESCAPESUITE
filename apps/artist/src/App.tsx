import { useState } from 'react';
import { useEditorStore } from './store/projectStore';
import { PreviewPlayer } from './components/Preview/PreviewPlayer';
import { PlaybackControls } from './components/Preview/PlaybackControls';
import { ExportDialog } from './components/Export/ExportDialog';
import { KeyframePanel } from './components/KeyframePanel';
import { Toolbar } from './components/Toolbar';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { ProjectLoadDialog } from './components/ProjectLoadDialog';
import { parseUrlParams } from './utils/integration';
import { AppHeader } from './app/AppHeader';
import { MediaLibrarySidebar } from './app/MediaLibrarySidebar';
import { InspectorSidebar } from './app/InspectorSidebar';
import { MobileInspectorToggle } from './app/MobileInspectorToggle';
import { TimelineResizeHandle } from './app/TimelineResizeHandle';
import { TimelinePane } from './app/TimelinePane';
import { NotificationToast } from './app/NotificationToast';
import { LoadingOverlay } from './app/LoadingOverlay';
import { SessionRestorePrompt } from './app/SessionRestorePrompt';
import { useThemeLifecycle } from './app/useThemeLifecycle';
import { useNotification } from './app/useNotification';
import { useProjectActions } from './app/useProjectActions';
import { useSessionRestore } from './app/useSessionRestore';
import { useSessionAutosave } from './app/useSessionAutosave';
import { useTimelineZoom } from './app/useTimelineZoom';
import { useAppKeyboardShortcuts } from './app/useAppKeyboardShortcuts';
import { useTimelineHeight } from './app/useTimelineHeight';
import { useHostIntegration } from './app/useHostIntegration';
import styles from './App.module.css';

function App() {
  const [showExport, setShowExport] = useState(false);
  const [exportTimeRange, setExportTimeRange] = useState<{ start: number; end: number } | undefined>(undefined);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // URL parameters are read once at startup; later URL changes are ignored.
  const [urlParams] = useState(parseUrlParams);

  const project = useEditorStore((state) => state.project);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const zoom = useEditorStore((state) => state.zoom);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);

  const setProject = useEditorStore((state) => state.setProject);
  const addSourceVideo = useEditorStore((state) => state.addSourceVideo);
  const setZoom = useEditorStore((state) => state.setZoom);
  const resetProject = useEditorStore((state) => state.resetProject);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const removeClipFromTimeline = useEditorStore((state) => state.removeClipFromTimeline);
  const rippleDeleteClip = useEditorStore((state) => state.rippleDeleteClip);
  const activeTool = useEditorStore((state) => state.activeTool);
  const duplicateClip = useEditorStore((state) => state.duplicateClip);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);
  const clearHistory = useEditorStore((state) => state.clearHistory);
  const keyframePanelOpen = useEditorStore((state) => state.keyframePanelState.isOpen);
  const setKeyframePanelOpen = useEditorStore((state) => state.setKeyframePanelOpen);
  const addTrack = useEditorStore((state) => state.addTrack);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const addMarker = useEditorStore((state) => state.addMarker);
  const goToNextMarker = useEditorStore((state) => state.goToNextMarker);
  const goToPreviousMarker = useEditorStore((state) => state.goToPreviousMarker);
  const splitClip = useEditorStore((state) => state.splitClip);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const deleteSelectedClips = useEditorStore((state) => state.deleteSelectedClips);
  const copySelectedClips = useEditorStore((state) => state.copySelectedClips);
  const pasteClips = useEditorStore((state) => state.pasteClips);
  const clipboard = useEditorStore((state) => state.clipboard);
  const clearMultiSelection = useEditorStore((state) => state.clearMultiSelection);
  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);
  const setInPoint = useEditorStore((state) => state.setInPoint);
  const setOutPoint = useEditorStore((state) => state.setOutPoint);
  const clearInOutPoints = useEditorStore((state) => state.clearInOutPoints);

  // The hooks below are called in a fixed order, because that order is the
  // order their effects run in — and it is the order the six effects ran in
  // when they were all inline in this file: theme, session check, autosave,
  // keydown, timeline resize, host integration. The three hooks that bind no
  // effect sit where their results are needed.
  useThemeLifecycle();

  const { notification, showNotification } = useNotification();

  const {
    isSaving,
    isLoading,
    showProjectLoadDialog,
    handleSaveProject,
    handleLoadProject,
    handleNewProject,
    handleProjectLoadCancel,
    handleProjectLoadSaveAndLoad,
    handleProjectLoadDiscardAndLoad,
  } = useProjectActions({
    project,
    sourceVideos,
    clipCount: clips.length,
    resetProject,
    setProject,
    addSourceVideo,
    clearHistory,
    showNotification,
  });

  const {
    sessionRestored,
    showSessionPrompt,
    pendingSession,
    handleRestoreSession,
    handleDeclineSession,
  } = useSessionRestore({
    suppressRestore: urlParams.suppressRestore,
    setProject,
    addSourceVideo,
    setCurrentTime,
    setSelectedClipId,
    setZoom,
    clearHistory,
    showNotification,
  });

  useSessionAutosave({
    sessionRestored,
    suppressRestore: urlParams.suppressRestore,
    project,
    sourceVideos,
    selectedClipId,
    zoom,
  });

  const { handleZoomIn, handleZoomOut } = useTimelineZoom({ zoom, setZoom });

  useAppKeyboardShortcuts({
    canUndo,
    canRedo,
    undo,
    redo,
    selectedClipId,
    removeClipFromTimeline,
    rippleDeleteClip,
    activeTool,
    duplicateClip,
    handleSaveProject,
    handleLoadProject,
    clips,
    handleZoomIn,
    handleZoomOut,
    showNotification,
    keyframePanelOpen,
    setKeyframePanelOpen,
    setSelectedClipId,
    setActiveTool,
    snapEnabled,
    setSnapEnabled,
    addMarker,
    goToNextMarker,
    goToPreviousMarker,
    showShortcuts,
    setShowShortcuts,
    setShowExport,
    splitClip,
    selectedClipIds,
    deleteSelectedClips,
    copySelectedClips,
    pasteClips,
    clipboard,
    clearMultiSelection,
    setInPoint,
    setOutPoint,
    clearInOutPoints,
    inPoint,
    outPoint,
  });

  const { timelineHeight, isResizing, handleResizeStart, handleResizeDoubleClick } = useTimelineHeight({
    showNotification,
  });

  useHostIntegration({ urlParams, addSourceVideo, setProject, showNotification });

  return (
    <div className={styles.app}>
      {/* Header */}
      <AppHeader
        projectName={project.name}
        onRenameProject={(name) => setProject({ ...project, name, modified: Date.now() })}
        fileMenuOpen={showFileMenu}
        onToggleFileMenu={() => setShowFileMenu(!showFileMenu)}
        onCloseFileMenu={() => setShowFileMenu(false)}
        onNewProject={handleNewProject}
        onLoadProject={handleLoadProject}
        onSaveProject={handleSaveProject}
        onExport={() => setShowExport(true)}
        isLoading={isLoading}
        isSaving={isSaving}
        canExport={clips.length > 0}
      />

      {/* Toolbar */}
      <Toolbar onShowShortcuts={() => setShowShortcuts(true)} />

      {/* Main content */}
      <main className={styles.main}>
        {/* Left sidebar - Video library */}
        <MediaLibrarySidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Center - Preview */}
        <section className={styles.previewSection}>
          <PreviewPlayer />
          <PlaybackControls />
        </section>

        {/* Right sidebar - Clip Inspector */}
        <InspectorSidebar
          collapsed={inspectorCollapsed}
          onToggle={() => setInspectorCollapsed(!inspectorCollapsed)}
        />

        {/* Mobile inspector toggle button */}
        <MobileInspectorToggle
          collapsed={inspectorCollapsed}
          onToggle={() => setInspectorCollapsed(!inspectorCollapsed)}
        />
      </main>

      {/* Resize handle */}
      <TimelineResizeHandle
        isResizing={isResizing}
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
      />

      {/* Timeline */}
      <TimelinePane
        height={timelineHeight}
        zoom={zoom}
        onAddTrack={addTrack}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onExportSelection={(timeRange) => { setExportTimeRange(timeRange); setShowExport(true); }}
      />

      {/* Export dialog */}
      <ExportDialog isOpen={showExport} onClose={() => { setShowExport(false); setExportTimeRange(undefined); }} timeRange={exportTimeRange} />

      {/* Keyframe panel */}
      <KeyframePanel />

      {/* Notification */}
      {notification && <NotificationToast notification={notification} />}

      {/* Loading overlay */}
      {isLoading && <LoadingOverlay />}

      {/* Session restore prompt */}
      {showSessionPrompt && pendingSession && (
        <SessionRestorePrompt
          session={pendingSession}
          onRestore={handleRestoreSession}
          onDecline={handleDeclineSession}
        />
      )}

      {/* Keyboard shortcuts panel */}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Project load safety dialog */}
      <ProjectLoadDialog
        isOpen={showProjectLoadDialog}
        onCancel={handleProjectLoadCancel}
        onSaveAndLoad={handleProjectLoadSaveAndLoad}
        onDiscardAndLoad={handleProjectLoadDiscardAndLoad}
      />
    </div>
  );
}

export default App;
