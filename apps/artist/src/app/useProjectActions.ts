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
import { clearSessionState, revokeSourceThumbnails } from '../core/storage';
import { analytics } from '../utils/analytics';
import { parseProject } from '../store/projectMigration';
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
    // Set once `loadProject(file)` returns, so a throw between here and the
    // reset below (ESCSUITE-113) knows there is something to clean up; and
    // set back to `undefined` once `resetProject()`/`addSourceVideo` have
    // actually taken the sources in, so the catch below never revokes a
    // thumbnail that is already live in the store and on screen.
    let mintedButNotYetOwned: SourceVideo[] | undefined;
    try {
      const { project: loadedProject, sourceVideos: loadedVideos } = await loadProject(file);
      mintedButNotYetOwned = loadedVideos;

      // Validate (and migrate) before touching anything: ensureTimelineHasTracks
      // assumes a shape a malformed .veditor does not have, and used to throw
      // *after* resetProject() had already emptied the editor (ESCSUITE-102).
      const parsed = parseProject(loadedProject);
      if (!parsed.ok) {
        // loadProject already minted a thumbnailUrl for each of these —
        // nothing is ever going to render them now, and nothing else would
        // ever free them either (ESCSUITE-113).
        revokeSourceThumbnails(loadedVideos);
        mintedButNotYetOwned = undefined;
        showNotification(`Failed to load project: ${parsed.reason}`, 'error');
        return;
      }

      // Reset current state and load new project. resetProject() owns
      // revoking the OUTGOING library's thumbnails itself (ESCSUITE-113) —
      // this callback does not also revoke `sourceVideos`, or the same URLs
      // would be freed twice.
      resetProject();
      setProject(parsed.project);
      loadedVideos.forEach(addSourceVideo);
      // Every incoming source has now been handed to the store — a later
      // throw (e.g. from a subscriber) is not this function's thumbnail to
      // unwind any more.
      mintedButNotYetOwned = undefined;

      showNotification('Project loaded successfully', 'success');
    } catch (error) {
      console.error('Load failed:', error);
      if (mintedButNotYetOwned) revokeSourceThumbnails(mintedButNotYetOwned);
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
