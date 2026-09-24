// Project lifecycle for the editor shell: saving to disk, opening from disk
// (with the "you have unsaved work" safety dialog in front of it), and
// starting over.
//
// It owns the *only* project-load dialog in the editor. `VideoUploader` used to
// render a second one for a dropped `.veditor`, with its own pending file and
// its own copies of the replace/merge handlers — and a flag `App`'s `modalOpen`
// knew nothing about, so Ctrl+O stacked App's dialog on top of it (ESCSUITE-63).
// `handleProjectFile` is the entry that path now calls instead.
//
// Binds no effects, so its position in `App`'s hook order does not affect the
// effect order; it sits third because the keyboard-shortcut hook takes
// `handleSaveProject` and `handleLoadProject` as parameters.
//
// `clipCount` arrives as a number rather than the clips array: the two
// callbacks that need it only ever read `clips.length`, and it is the
// dependency both of them carried inline.
import { useCallback, useState } from 'react';
import { saveProject, loadProject, showOpenProjectDialog } from '../core/projectManager';
import { clearSessionState } from '../core/storage';
import { analytics } from '../utils/analytics';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

/** What the project actions need that they cannot reach on their own. */
export interface ProjectActionsDeps {
  /** The project being edited — the thing a save writes. */
  project: Project;
  /** The media library, saved alongside the project. */
  sourceVideos: SourceVideo[];
  /** How many clips are on the timeline; decides whether work is at risk. */
  clipCount: number;
  resetProject: () => void;
  setProject: (project: Project) => void;
  addSourceVideo: (video: SourceVideo) => void;
  clearHistory: () => void;
  showNotification: ShowNotification;
}

/** The project actions, and the two flags the chrome shows while they run. */
export interface ProjectActions {
  /** A save is in flight. */
  isSaving: boolean;
  /** A load is in flight; `App` renders the blocking overlay from it. */
  isLoading: boolean;
  /** The "you have unsaved work" dialog is up. */
  showProjectLoadDialog: boolean;
  handleSaveProject: () => Promise<void>;
  handleLoadProject: () => Promise<void>;
  /**
   * Open the project in `file`: ask first if the timeline holds work, load it
   * outright if it does not.
   *
   * For callers that already have the file — the uploader's drop and pick paths
   * — where `handleLoadProject` is for the ones that need it picked first.
   */
  handleProjectFile: (file: File) => void;
  handleNewProject: () => void;
  handleProjectLoadCancel: () => void;
  handleProjectLoadSaveAndLoad: () => Promise<void>;
  handleProjectLoadDiscardAndLoad: () => Promise<void>;
}

export function useProjectActions({
  project,
  sourceVideos,
  clipCount,
  resetProject,
  setProject,
  addSourceVideo,
  clearHistory,
  showNotification,
}: ProjectActionsDeps): ProjectActions {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showProjectLoadDialog, setShowProjectLoadDialog] = useState(false);
  // Held here rather than in `App`: the three dialog handlers below are the
  // only readers, and the dialog itself is driven by showProjectLoadDialog.
  const [pendingProjectFile, setPendingProjectFile] = useState<File | null>(null);

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

  // Given a project file: ask before replacing work in progress, load it
  // straight away when there is none. Shared by Ctrl+O / the File menu (which
  // picks the file first) and the uploader's drop and pick paths (which are
  // handed one).
  const handleProjectFile = useCallback((file: File) => {
    if (clipCount > 0) {
      setPendingProjectFile(file);
      setShowProjectLoadDialog(true);
    } else {
      loadProjectFile(file);
    }
  }, [clipCount, loadProjectFile]);

  // Handle load project (Ctrl+O / File menu)
  const handleLoadProject = useCallback(async () => {
    const file = await showOpenProjectDialog();
    if (!file) return;

    handleProjectFile(file);
  }, [handleProjectFile]);

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
    if (clipCount > 0) {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) {
        return;
      }
    }
    resetProject();
    clearHistory();
    clearSessionState();
    analytics.projectCreated();
    showNotification('New project created', 'info');
  }, [clipCount, resetProject, clearHistory, showNotification]);

  return {
    isSaving,
    isLoading,
    showProjectLoadDialog,
    handleSaveProject,
    handleLoadProject,
    handleProjectFile,
    handleNewProject,
    handleProjectLoadCancel,
    handleProjectLoadSaveAndLoad,
    handleProjectLoadDiscardAndLoad,
  };
}
