// The editor's global keyboard shortcuts: one `keydown` listener on `window`
// holding an ordered cascade of `if`s.
//
// **The order of the branches is the behaviour.** `c` sits below Ctrl+C, `v`
// below Ctrl+V and `o` below Ctrl+O, so each bare letter only ever sees the
// chords that fell through; the Escape cascade runs shortcuts sheet → in/out
// points → multi-selection → single selection, and four tests assert exactly
// that sequence. The block moves as one unit; nothing in it is reordered.
//
// Its effect is the editor's **fourth**, so `App` calls this hook seventh.
//
// The deps array is the one the effect carried inline, character for
// character. It lists `clips.length` while the Ctrl+B branch reads
// `clips.find` — a known staleness, carried deliberately, which is why `clips`
// arrives whole while the dependency stays the count.
//
// The playhead is read through `useEditorStore.getState().currentTime` in four
// branches rather than subscribed to. That is load-bearing: a `currentTime`
// selector anywhere in `App`'s tree re-renders the whole timeline every
// playback tick (`App.rerender.test.tsx`).
import { useEffect } from 'react';
import { useEditorStore } from '../store/projectStore';
import { clipCountMessage, formatTimeForNotification } from './appFormat';
import type { Clip, ToolType } from '../store/types';
import type { ShowNotification } from './useNotification';

/** Everything the cascade reads or calls. */
export interface AppKeyboardShortcutsDeps {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  selectedClipId: string | null;
  removeClipFromTimeline: (clipId: string) => void;
  rippleDeleteClip: (clipId: string) => void;
  activeTool: ToolType;
  duplicateClip: (clipId: string) => void;
  /**
   * Both are `async` at the source (`useProjectActions`), so the type is widened to
   * accept a promise: the shortcut fires and forgets, but an `await` added here — or a
   * caller that wants to chain one — must type-check rather than be silently narrowed.
   */
  handleSaveProject: () => void | Promise<void>;
  handleLoadProject: () => void | Promise<void>;
  /** The timeline's clips: the count gates Ctrl+E, and Ctrl+B looks one up. */
  clips: Clip[];
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  showNotification: ShowNotification;
  keyframePanelOpen: boolean;
  setKeyframePanelOpen: (open: boolean) => void;
  setSelectedClipId: (id: string | null) => void;
  setActiveTool: (tool: ToolType) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  addMarker: (time: number) => void;
  goToNextMarker: () => void;
  goToPreviousMarker: () => void;
  showShortcuts: boolean;
  setShowShortcuts: (open: boolean) => void;
  setShowExport: (open: boolean) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  selectedClipIds: Set<string>;
  deleteSelectedClips: () => void;
  copySelectedClips: () => void;
  pasteClips: () => void;
  clipboard: Clip[] | null;
  clearMultiSelection: () => void;
  setInPoint: (time: number) => void;
  setOutPoint: (time: number) => void;
  clearInOutPoints: () => void;
  inPoint: number | null;
  outPoint: number | null;
}

export function useAppKeyboardShortcuts({
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
}: AppKeyboardShortcutsDeps): void {
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
}
