import { useState, useCallback, useEffect } from 'react';
import { useEditorStore } from './store/projectStore';
import { VideoUploader, VideoLibrary } from './components/VideoUploader';
import { Timeline } from './components/Timeline/Timeline';
import { PreviewPlayer, PlaybackControls } from './components/Preview/PreviewPlayer';
import { ClipEditor } from './components/ClipEditor/ClipEditor';
import { ExportDialog } from './components/Export/ExportDialog';
import { KeyframePanel } from './components/KeyframePanel';
import { Toolbar } from './components/Toolbar';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { saveProject, loadProject, showOpenProjectDialog } from './core/projectManager';
import { initIntegration, parseUrlParams, loadVideoFromUrl, sendMessage } from './utils/integration';
import { processVideoFile } from './core/videoProcessor';
import { saveSessionState, getSessionState, clearSessionState, getVideo, getThumbnail, type SessionState } from './core/storage';
import { analytics } from './utils/analytics';
import { initTheme, cleanupTheme, setTheme, getTheme, getResolvedTheme, type ThemePreference } from '@escapesuite/shared/theme';
import { themeStorage } from './utils/themeStorage';
import { isStandaloneMode } from './auth';
import styles from './App.module.css';

// Auto-save debounce delay (milliseconds)
const AUTO_SAVE_DELAY = 2000;

// Timeline height constraints
const MIN_TIMELINE_HEIGHT = 120;
const MAX_TIMELINE_HEIGHT = 600;
const DEFAULT_TIMELINE_HEIGHT = 320;

// LocalStorage key for timeline height
const TIMELINE_HEIGHT_KEY = 'escapeartist-timeline-height';

function App() {
  const [showExport, setShowExport] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = localStorage.getItem(TIMELINE_HEIGHT_KEY);
    return saved ? Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, parseInt(saved, 10))) : DEFAULT_TIMELINE_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);

  const project = useEditorStore((state) => state.project);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const zoom = useEditorStore((state) => state.zoom);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const currentTime = useEditorStore((state) => state.currentTime);

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

  // Handle load project
  const handleLoadProject = useCallback(async () => {
    const file = await showOpenProjectDialog();
    if (!file) return;

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
  }, [sessionRestored]);

  // Auto-save session on state changes (debounced)
  useEffect(() => {
    if (!sessionRestored) return;

    const timeoutId = setTimeout(() => {
      const session: SessionState = {
        project,
        sourceVideos,
        currentTime,
        selectedClipId,
        zoom,
        timestamp: Date.now(),
      };
      saveSessionState(session).catch(console.error);
    }, AUTO_SAVE_DELAY);

    return () => clearTimeout(timeoutId);
  }, [sessionRestored, project, sourceVideos, currentTime, selectedClipId, zoom]);

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

      // Delete or Backspace = Delete selected clip
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
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

      // + or = = Zoom in
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      // - = Zoom out
      if (e.key === '-') {
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
      if (e.key === 'v' || e.key === 'V') {
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

      // B = Ripple edit tool
      if (e.key === 'b' || e.key === 'B') {
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
          const splitTime = currentTime - clip.timelinePosition;
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
        addMarker(currentTime);
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

      // ? = Show keyboard shortcuts
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(!showShortcuts);
        return;
      }

      // Escape = Close shortcuts panel or deselect clip
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
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
    setSelectedClipId, setActiveTool, snapEnabled, setSnapEnabled, addMarker, currentTime,
    goToNextMarker, goToPreviousMarker, showShortcuts, splitClip
  ]);

  // Timeline resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleResizeDoubleClick = useCallback(() => {
    setTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
    localStorage.setItem(TIMELINE_HEIGHT_KEY, DEFAULT_TIMELINE_HEIGHT.toString());
    showNotification('Timeline height reset', 'info');
  }, [showNotification]);

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent) => {
      // Calculate new height based on mouse position from bottom of window
      const newHeight = window.innerHeight - e.clientY;
      const clampedHeight = Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, newHeight));
      setTimelineHeight(clampedHeight);
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
      // Save to localStorage
      localStorage.setItem(TIMELINE_HEIGHT_KEY, timelineHeight.toString());
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

        case 'GET_STATE':
          sendMessage({
            type: 'STATE',
            payload: { project, videos: sourceVideos },
          });
          break;

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

    // Check for URL parameters
    const { videos, loadVideoId } = parseUrlParams();

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

    return cleanup;
  }, []);

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
          <h1 className={styles.logo}>ESCAPEARTIST</h1>
        </div>

        <div className={styles.headerCenter}>
          <input
            type="text"
            value={project.name}
            onChange={(e) =>
              setProject({ ...project, name: e.target.value, modified: Date.now() })
            }
            className={styles.projectName}
            placeholder="Project Name"
            aria-label="Project name"
          />
        </div>

        <div className={styles.headerRight}>
          {/* File Menu Dropdown */}
          <div className={styles.menuContainer}>
            <button
              className={styles.headerButton}
              onClick={() => setShowFileMenu(!showFileMenu)}
              aria-expanded={showFileMenu}
              aria-haspopup="menu"
              aria-label="File menu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              File
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showFileMenu && (
              <>
                <div className={styles.menuBackdrop} onClick={() => setShowFileMenu(false)} aria-hidden="true" />
                <div className={styles.menuDropdown} role="menu" aria-label="File options">
                  <button
                    className={styles.menuItem}
                    onClick={() => { handleNewProject(); setShowFileMenu(false); }}
                  >
                    <span className={styles.menuItemLabel}>New Project</span>
                    <span className={styles.menuItemShortcut}>Ctrl+N</span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => { handleLoadProject(); setShowFileMenu(false); }}
                    disabled={isLoading}
                  >
                    <span className={styles.menuItemLabel}>Open Project...</span>
                    <span className={styles.menuItemShortcut}>Ctrl+O</span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => { handleSaveProject(); setShowFileMenu(false); }}
                    disabled={isSaving}
                  >
                    <span className={styles.menuItemLabel}>Save Project</span>
                    <span className={styles.menuItemShortcut}>Ctrl+S</span>
                  </button>
                  <div className={styles.menuDivider} />
                  <button
                    className={styles.menuItem}
                    onClick={() => { setShowExport(true); setShowFileMenu(false); }}
                    disabled={clips.length === 0}
                  >
                    <span className={styles.menuItemLabel}>Export Video...</span>
                    <span className={styles.menuItemShortcut}>Ctrl+E</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Quick action buttons */}
          <button className={styles.headerButton} onClick={handleSaveProject} disabled={isSaving} title="Save (Ctrl+S)" aria-label="Save project">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>

          <button
            className={`${styles.headerButton} ${styles.exportButton}`}
            onClick={() => setShowExport(true)}
            disabled={clips.length === 0}
            title="Export (Ctrl+E)"
            aria-label="Export video"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <Toolbar onShowShortcuts={() => setShowShortcuts(true)} />

      {/* Main content */}
      <main className={styles.main}>
        {/* Left sidebar - Video library */}
        <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
          <div className={styles.sidebarHeader}>
            {!sidebarCollapsed && <span id="media-library-title">Media Library</span>}
            <button
              className={styles.collapseButton}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand media library sidebar' : 'Collapse media library sidebar'}
              aria-expanded={!sidebarCollapsed}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {sidebarCollapsed ? (
                  <polyline points="9 18 15 12 9 6" />
                ) : (
                  <polyline points="15 18 9 12 15 6" />
                )}
              </svg>
            </button>
          </div>

          {!sidebarCollapsed && (
            <>
              <div className={styles.uploaderContainer}>
                <VideoUploader />
              </div>

              <div className={styles.libraryContainer}>
                <VideoLibrary />
              </div>
            </>
          )}
        </aside>

        {/* Center - Preview */}
        <section className={styles.previewSection}>
          <PreviewPlayer />
          <PlaybackControls />
        </section>

        {/* Right sidebar - Clip Inspector */}
        <aside className={`${styles.propertiesSidebar} ${inspectorCollapsed ? styles.inspectorCollapsed : ''}`} aria-labelledby="inspector-title">
          <div className={styles.sidebarHeader}>
            <span id="inspector-title">Inspector</span>
            <button
              className={styles.collapseButton}
              onClick={() => setInspectorCollapsed(!inspectorCollapsed)}
              title={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
              aria-label={inspectorCollapsed ? 'Show inspector panel' : 'Hide inspector panel'}
              aria-expanded={!inspectorCollapsed}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {inspectorCollapsed ? (
                  <polyline points="15 18 9 12 15 6" />
                ) : (
                  <polyline points="9 18 15 12 9 6" />
                )}
              </svg>
            </button>
          </div>
          {!inspectorCollapsed && <ClipEditor />}
        </aside>

        {/* Mobile inspector toggle button */}
        <button
          className={styles.mobileInspectorToggle}
          onClick={() => setInspectorCollapsed(!inspectorCollapsed)}
          title="Toggle inspector"
          aria-label={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
          aria-expanded={!inspectorCollapsed}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </main>

      {/* Resize handle */}
      <div
        className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ''}`}
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
        title="Drag to resize timeline (double-click to reset)"
      >
        <div className={styles.resizeHandleGrip} />
      </div>

      {/* Timeline */}
      <footer className={styles.footer} style={{ height: timelineHeight }}>
        <div className={styles.timelineControls}>
          <button className={styles.addTrackButton} onClick={() => addTrack()} title="Add new track" aria-label="Add new track">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add Track</span>
          </button>
          <div className={styles.controlsDivider} aria-hidden="true" />
          <button className={styles.zoomButton} onClick={handleZoomOut} title="Zoom out" aria-label="Zoom out timeline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <span className={styles.zoomLabel} aria-label={`Zoom level ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}%</span>
          <button className={styles.zoomButton} onClick={handleZoomIn} title="Zoom in" aria-label="Zoom in timeline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        </div>
        <Timeline />
      </footer>

      {/* Export dialog */}
      <ExportDialog isOpen={showExport} onClose={() => setShowExport(false)} />

      {/* Keyframe panel */}
      <KeyframePanel />

      {/* Notification */}
      {notification && (
        <div className={`${styles.notification} ${styles[notification.type]}`} role="status" aria-live="polite">
          {notification.message}
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className={styles.loadingOverlay} role="dialog" aria-modal="true" aria-labelledby="loading-message">
          <div className={styles.spinner} aria-hidden="true" />
          <p id="loading-message">Loading project...</p>
        </div>
      )}

      {/* Session restore prompt */}
      {showSessionPrompt && pendingSession && (
        <div className={styles.loadingOverlay} role="dialog" aria-modal="true" aria-labelledby="session-prompt-title">
          <div className={styles.sessionPrompt}>
            <h3 id="session-prompt-title">Resume Previous Session?</h3>
            <p>
              You have an unsaved session from{' '}
              {new Date(pendingSession.timestamp).toLocaleString()}
            </p>
            <p>
              Project: <strong>{pendingSession.project.name}</strong>
              <br />
              {pendingSession.sourceVideos.length} video(s),{' '}
              {pendingSession.project.timeline.clips.length} clip(s) on timeline
            </p>
            <div className={styles.sessionPromptButtons}>
              <button
                className={styles.sessionRestoreButton}
                onClick={() => handleRestoreSession(pendingSession)}
              >
                Restore Session
              </button>
              <button
                className={styles.sessionDeclineButton}
                onClick={handleDeclineSession}
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts panel */}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}

export default App;
