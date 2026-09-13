import { useState, useCallback, useEffect } from 'react';
import { useEditorStore, DEFAULT_PROJECT_NAME } from './store/projectStore';
import { PreviewPlayer } from './components/Preview/PreviewPlayer';
import { PlaybackControls } from './components/Preview/PlaybackControls';
import { ExportDialog } from './components/Export/ExportDialog';
import { KeyframePanel } from './components/KeyframePanel';
import { Toolbar } from './components/Toolbar';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { saveProject, loadProject, showOpenProjectDialog } from './core/projectManager';
import { ProjectLoadDialog } from './components/ProjectLoadDialog';
import { initIntegration, parseUrlParams, loadVideoFromUrl, sendMessage } from './utils/integration';
import { processVideoFile } from './core/videoProcessor';
import { saveSessionState, getSessionState, clearSessionState, getVideo, getThumbnail, type SessionState } from './core/storage';
import { analytics } from './utils/analytics';
import { initTheme, cleanupTheme, setTheme, getTheme, getResolvedTheme, type ThemePreference } from '@escapesuite/shared/theme';
import { themeStorage } from './utils/themeStorage';
import { AUTO_SAVE_DELAY, DEFAULT_TIMELINE_HEIGHT } from './app/appConstants';
import { clampTimelineHeight, heightFromPointer, readStoredTimelineHeight, storeTimelineHeight } from './app/timelineHeight';
import { clipCountMessage, formatTimeForNotification } from './app/appFormat';
import { buildSessionSnapshot } from './app/sessionSnapshot';
import { AppHeader } from './app/AppHeader';
import { MediaLibrarySidebar } from './app/MediaLibrarySidebar';
import { InspectorSidebar } from './app/InspectorSidebar';
import { MobileInspectorToggle } from './app/MobileInspectorToggle';
import { TimelineResizeHandle } from './app/TimelineResizeHandle';
import { TimelinePane } from './app/TimelinePane';
import { NotificationToast } from './app/NotificationToast';
import { LoadingOverlay } from './app/LoadingOverlay';
import { SessionRestorePrompt } from './app/SessionRestorePrompt';
import styles from './App.module.css';

function App() {
  const [showExport, setShowExport] = useState(false);
  const [exportTimeRange, setExportTimeRange] = useState<{ start: number; end: number } | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showProjectLoadDialog, setShowProjectLoadDialog] = useState(false);
  const [pendingProjectFile, setPendingProjectFile] = useState<File | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(readStoredTimelineHeight);
  const [isResizing, setIsResizing] = useState(false);

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

  // Show notification
  const showNotification = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Handle save project
  const handleSaveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveProject(project, sourceVideos);
      analytics.projectSaved();
      showNotification('Project saved successfully', 'success');
    } catch (error) {
      console.error('Save failed:', error);
      showNotification('Failed to save project', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [project, sourceVideos, showNotification]);

  // Load a project file (shared by Ctrl+O and drag-drop paths)
  const loadProjectFile = useCallback(async (file: File) => {
    setIsLoading(true);
    try {
      const { project: loadedProject, sourceVideos: loadedVideos } = await loadProject(file);

      // Reset current state and load new project
      resetProject();
      setProject(loadedProject);
      loadedVideos.forEach(addSourceVideo);

      showNotification('Project loaded successfully', 'success');
    } catch (error) {
      console.error('Load failed:', error);
      showNotification('Failed to load project', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [resetProject, setProject, addSourceVideo, showNotification]);

  // Handle load project (Ctrl+O / File menu)
  const handleLoadProject = useCallback(async () => {
    const file = await showOpenProjectDialog();
    if (!file) return;

    if (clips.length > 0) {
      setPendingProjectFile(file);
      setShowProjectLoadDialog(true);
    } else {
      loadProjectFile(file);
    }
  }, [clips.length, loadProjectFile]);

  const handleProjectLoadCancel = useCallback(() => {
    setPendingProjectFile(null);
    setShowProjectLoadDialog(false);
  }, []);

  const handleProjectLoadSaveAndLoad = useCallback(async () => {
    setShowProjectLoadDialog(false);
    const file = pendingProjectFile;
    setPendingProjectFile(null);
    if (!file) return;
    try {
      await saveProject(project, sourceVideos);
      showNotification('Project saved', 'success');
    } catch (error) {
      console.error('Failed to save current project:', error);
      showNotification('Failed to save project', 'error');
    }
    await loadProjectFile(file);
  }, [pendingProjectFile, project, sourceVideos, loadProjectFile, showNotification]);

  const handleProjectLoadDiscardAndLoad = useCallback(async () => {
    setShowProjectLoadDialog(false);
    const file = pendingProjectFile;
    setPendingProjectFile(null);
    if (!file) return;
    await loadProjectFile(file);
  }, [pendingProjectFile, loadProjectFile]);

  // Handle new project
  const handleNewProject = useCallback(() => {
    if (clips.length > 0) {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) {
        return;
      }
    }
    resetProject();
    clearHistory();
    clearSessionState();
    analytics.projectCreated();
    showNotification('New project created', 'info');
  }, [clips.length, resetProject, clearHistory, showNotification]);

  // Restore session on app start
  const handleRestoreSession = useCallback((session: SessionState) => {
    setProject(session.project);
    session.sourceVideos.forEach(addSourceVideo);
    setCurrentTime(session.currentTime);
    setSelectedClipId(session.selectedClipId);
    setZoom(session.zoom);
    clearHistory();
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
    showNotification('Session restored', 'success');
  }, [setProject, addSourceVideo, setCurrentTime, setSelectedClipId, setZoom, clearHistory, showNotification]);

  const handleDeclineSession = useCallback(() => {
    clearSessionState();
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
  }, []);

  // Initialize theme on mount
  useEffect(() => {
    initTheme(themeStorage);
    return () => cleanupTheme();
  }, []);

  // Check for saved session on mount
  useEffect(() => {
    if (sessionRestored) return;

    // A host that drives its own state can suppress the prompt with
    // ?suppressRestore=1. The saved session is deliberately left in storage.
    if (urlParams.suppressRestore) {
      setSessionRestored(true);
      return;
    }

    const checkSession = async () => {
      try {
        const session = await getSessionState();
        if (session && session.sourceVideos.length > 0) {
          setPendingSession(session);
          setShowSessionPrompt(true);
        } else {
          setSessionRestored(true);
        }
      } catch (error) {
        console.error('Failed to check session:', error);
        setSessionRestored(true);
      }
    };

    checkSession();
  }, [sessionRestored, urlParams.suppressRestore]);

  // Auto-save session on state changes (debounced)
  //
  // `currentTime` re-arms the debounce but is deliberately NOT a dependency:
  // playback writes it every ~200 ms, and a dependency would re-render App —
  // and with it the whole timeline — on every tick. A store subscription gets
  // the same re-arming without the render, so the behaviour is unchanged: while
  // the playhead is moving the timer never elapses, and the session is written
  // AUTO_SAVE_DELAY after it settles. The payload is read at fire time rather
  // than closed over, so it is always the latest state.
  useEffect(() => {
    if (!sessionRestored) return;

    // ?suppressRestore=1 means the host drives its own state: ESCAPEARTIST
    // neither offers the saved session nor writes over it.
    if (urlParams.suppressRestore) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const arm = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const state = useEditorStore.getState();
        const session: SessionState = buildSessionSnapshot(state, Date.now());
        saveSessionState(session).catch(console.error);
      }, AUTO_SAVE_DELAY);
    };

    arm();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) arm();
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [sessionRestored, urlParams.suppressRestore, project, sourceVideos, selectedClipId, zoom]);

  // Handle zoom
  const handleZoomIn = useCallback(() => {
    setZoom(zoom * 1.25);
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(zoom / 1.25);
  }, [zoom, setZoom]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Ctrl/Cmd + Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
          showNotification('Undo', 'info');
        }
        return;
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y = Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo()) {
          redo();
          showNotification('Redo', 'info');
        }
        return;
      }

      // Delete or Backspace = Delete selected clip(s)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          deleteSelectedClips();
          showNotification(clipCountMessage(selectedClipIds.size, 'deleted'), 'info');
          return;
        } else if (selectedClipId) {
          e.preventDefault();
          if (activeTool === 'ripple') {
            rippleDeleteClip(selectedClipId);
            showNotification('Clip deleted (ripple)', 'info');
          } else {
            removeClipFromTimeline(selectedClipId);
            showNotification('Clip deleted', 'info');
          }
          return;
        }
      }

      // Ctrl/Cmd + C = Copy selected clips
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          copySelectedClips();
          showNotification(clipCountMessage(selectedClipIds.size, 'copied'), 'info');
          return;
        }
      }

      // Ctrl/Cmd + V = Paste clips
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard && clipboard.length > 0) {
          e.preventDefault();
          pasteClips();
          showNotification(clipCountMessage(clipboard.length, 'pasted'), 'info');
          return;
        }
      }

      // Ctrl/Cmd + D = Duplicate selected clip
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedClipId) {
        e.preventDefault();
        duplicateClip(selectedClipId);
        showNotification('Clip duplicated', 'info');
        return;
      }

      // Ctrl/Cmd + S = Save project
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
        return;
      }

      // Ctrl/Cmd + O = Open project
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleLoadProject();
        return;
      }

      // Ctrl/Cmd + E = Export
      if ((e.ctrlKey || e.metaKey) && e.key === 'e' && clips.length > 0) {
        e.preventDefault();
        setShowExport(true);
        return;
      }

      // + or = = Zoom in (Ctrl/Cmd + = is the browser's own page zoom)
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      // - = Zoom out (Ctrl/Cmd + - is the browser's own page zoom)
      if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      // K = Toggle keyframe panel
      if (e.key === 'k' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        setKeyframePanelOpen(!keyframePanelOpen);
        showNotification(keyframePanelOpen ? 'Keyframe panel closed' : 'Keyframe panel opened', 'info');
        return;
      }

      // V = Selection tool
      if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool('select');
        showNotification('Selection Tool', 'info');
        return;
      }

      // C = Razor tool
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool('razor');
        showNotification('Razor Tool', 'info');
        return;
      }

      // B = Ripple edit tool (Ctrl+B is the split below, not this)
      if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTool('ripple');
        showNotification('Ripple Edit Tool', 'info');
        return;
      }

      // S = Toggle snapping
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSnapEnabled(!snapEnabled);
        showNotification(snapEnabled ? 'Snapping Off' : 'Snapping On', 'info');
        return;
      }

      // Ctrl+B = Split clip at playhead
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && selectedClipId) {
        e.preventDefault();
        const clip = clips.find(c => c.id === selectedClipId);
        if (clip) {
          const splitTime = useEditorStore.getState().currentTime - clip.timelinePosition;
          if (splitTime > 0 && splitTime < clip.duration) {
            splitClip(selectedClipId, splitTime);
            showNotification('Clip split', 'info');
          }
        }
        return;
      }

      // M = Add marker (without modifiers)
      if (e.key === 'm' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        addMarker(useEditorStore.getState().currentTime);
        showNotification('Marker added', 'info');
        return;
      }

      // Shift+M = Go to next marker
      if (e.key === 'M' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        goToNextMarker();
        return;
      }

      // Ctrl+M = Go to previous marker
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        goToPreviousMarker();
        return;
      }

      // I = Set in point at playhead
      if (e.key === 'i' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        const inAt = useEditorStore.getState().currentTime;
        setInPoint(inAt);
        showNotification(`In point: ${formatTimeForNotification(inAt)}`, 'info');
        return;
      }

      // O = Set out point at playhead
      if (e.key === 'o' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        const outAt = useEditorStore.getState().currentTime;
        setOutPoint(outAt);
        showNotification(`Out point: ${formatTimeForNotification(outAt)}`, 'info');
        return;
      }

      // ? = Show keyboard shortcuts
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(!showShortcuts);
        return;
      }

      // Escape = Clear in/out points, close shortcuts panel, clear multi-selection, or deselect clip
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (inPoint !== null || outPoint !== null) {
          e.preventDefault();
          clearInOutPoints();
          showNotification('In/Out points cleared', 'info');
          return;
        }
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          clearMultiSelection();
          return;
        }
        if (selectedClipId) {
          e.preventDefault();
          setSelectedClipId(null);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canUndo, canRedo, undo, redo, selectedClipId, removeClipFromTimeline, rippleDeleteClip, activeTool,
    duplicateClip, handleSaveProject, handleLoadProject, clips.length,
    handleZoomIn, handleZoomOut, showNotification, keyframePanelOpen, setKeyframePanelOpen,
    setSelectedClipId, setActiveTool, snapEnabled, setSnapEnabled, addMarker,
    goToNextMarker, goToPreviousMarker, showShortcuts, splitClip,
    selectedClipIds, deleteSelectedClips, copySelectedClips, pasteClips, clipboard, clearMultiSelection,
    setInPoint, setOutPoint, clearInOutPoints, inPoint, outPoint
  ]);

  // Timeline resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleResizeDoubleClick = useCallback(() => {
    setTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
    storeTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
    showNotification('Timeline height reset', 'info');
  }, [showNotification]);

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent) => {
      // Calculate new height based on mouse position from bottom of window
      const newHeight = heightFromPointer(e.clientY, window.innerHeight);
      const clampedHeight = clampTimelineHeight(newHeight);
      setTimelineHeight(clampedHeight);
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
      // Save to localStorage
      storeTimelineHeight(timelineHeight);
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // Add resize cursor to body while dragging
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, timelineHeight]);

  // Initialize integration API
  useEffect(() => {
    const cleanup = initIntegration(async (message) => {
      switch (message.type) {
        case 'LOAD_VIDEO':
          if (message.payload && typeof message.payload === 'object' && 'url' in message.payload) {
            try {
              const { blob, name } = await loadVideoFromUrl((message.payload as { url: string }).url);
              const file = new File([blob], name, { type: blob.type });
              const metadata = await processVideoFile(file);
              addSourceVideo(metadata);
              sendMessage({ type: 'VIDEO_LOADED', payload: { id: metadata.id, name: metadata.name } });
            } catch (error) {
              sendMessage({ type: 'ERROR', payload: { message: 'Failed to load video', code: 'LOAD_ERROR' } });
            }
          }
          break;

        case 'LOAD_PROJECT':
          if (message.payload) {
            setProject(message.payload as any);
          }
          break;

        case 'GET_STATE': {
          // Read the store now — this handler is installed once on mount, so
          // the closed-over project/sourceVideos would be forever stale.
          const state = useEditorStore.getState();
          sendMessage({
            type: 'STATE',
            payload: { project: state.project, videos: state.sourceVideos },
          });
          break;
        }

        case 'SET_THEME':
          if (message.payload && typeof message.payload === 'object' && 'theme' in message.payload) {
            const themeValue = (message.payload as { theme: string }).theme;
            if (['light', 'dark', 'system'].includes(themeValue)) {
              setTheme(themeValue as ThemePreference).then(() => {
                sendMessage({
                  type: 'THEME_CHANGED',
                  payload: { preference: getTheme(), resolved: getResolvedTheme() },
                });
              });
            }
          }
          break;

        case 'GET_THEME':
          sendMessage({
            type: 'THEME_STATE',
            payload: { preference: getTheme(), resolved: getResolvedTheme() },
          });
          break;
      }
    });

    // Check for URL parameters (parsed once at startup)
    const { videos, loadVideoId, title } = urlParams;

    // Load videos from URL parameters
    if (videos.length > 0) {
      videos.forEach(async (url) => {
        try {
          const { blob, name } = await loadVideoFromUrl(url);
          const file = new File([blob], name, { type: blob.type });
          const metadata = await processVideoFile(file);
          addSourceVideo(metadata);
        } catch (error) {
          console.error('Failed to load video from URL:', error);
        }
      });
    }

    // Load video by ID from IndexedDB (ESCAPECRAFT integration)
    if (loadVideoId) {
      (async () => {
        try {
          const videoData = await getVideo(loadVideoId);
          if (videoData) {
            // Check if video is already loaded
            const existingVideos = useEditorStore.getState().sourceVideos;
            if (!existingVideos.some(v => v.id === loadVideoId)) {
              // Get thumbnail if available
              let thumbnailUrl: string | undefined;
              const thumbnailBlob = await getThumbnail(loadVideoId);
              if (thumbnailBlob) {
                thumbnailUrl = URL.createObjectURL(thumbnailBlob);
              }

              // Add video to source videos
              addSourceVideo({
                ...videoData.metadata,
                thumbnailUrl,
              });

              showNotification(`Loaded recording: ${videoData.metadata.name}`, 'success');
            }
          } else {
            console.error('Video not found in IndexedDB:', loadVideoId);
            showNotification('Recording not found', 'error');
          }
        } catch (error) {
          console.error('Failed to load video from IndexedDB:', error);
          showNotification('Failed to load recording', 'error');
        }
      })();
    }

    // Apply a host-supplied title. Only fills in a project that has never been
    // named - it never overrides a name from ?project= data or a restored session.
    if (title) {
      const current = useEditorStore.getState().project;
      if (current.name === DEFAULT_PROJECT_NAME) {
        setProject({ ...current, name: title, modified: Date.now() });
        // Naming the project is the host's doing, not an edit — leave nothing
        // for the user to undo back past (handleRestoreSession does the same).
        useEditorStore.getState().clearHistory();
      }
    }

    return cleanup;
  }, []);

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
