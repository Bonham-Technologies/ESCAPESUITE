// The editor's global keyboard shortcuts: one `keydown` listener on `window`
// holding an ordered cascade of `if`s.
//
// **The order of the branches is the behaviour.** `c` sits below Ctrl+C, `v`
// below Ctrl+V and `o` below Ctrl+O, so each bare letter only ever sees the
// chords that fell through; the Escape cascade runs shortcuts sheet → crop mode
// → in/out points → multi-selection → single selection, and tests assert
// exactly that sequence. The block moves as one unit; nothing in it is reordered.
//
// Above the whole cascade sits `modalOpen`: while a dialog is up, the editor
// behind it takes no key at all. The transport's own window listener
// (`components/Preview/PlaybackControls.tsx`) carries the same gate, because
// Space and the arrows live there rather than here.
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
import { anyClipOnLockedTrack, lockedTrackIds } from '../store/trackLock';
import type { Clip, ToolType } from '../store/types';
import type { ShowNotification } from './useNotification';

/** Everything the cascade reads or calls. */
export interface AppKeyboardShortcutsDeps {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  selectedClipId: string | null;
  removeClipFromTimeline: (clipId: string) => boolean;
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
  /**
   * True while a modal is on screen — the export dialog, the shortcuts sheet or
   * the session-restore prompt. A dialog is modal, so nothing behind it may act
   * on a key: Space used to start playback, Delete used to remove the selected
   * clip and Ctrl+Z used to undo, all from behind a dialog the user could not
   * see past. Each modal owns whichever keys are its own — the export dialog's
   * Escape never reaches this listener at all, because `useDialogBehaviour`
   * stops it in the capture phase, and the shortcuts sheet binds its own
   * Escape and `?` for the same reason.
   */
  modalOpen: boolean;
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
  deleteSelectedClips: () => boolean;
  copySelectedClips: () => void;
  pasteClips: () => boolean;
  clipboard: Clip[] | null;
  clearMultiSelection: () => void;
  setInPoint: (time: number) => void;
  setOutPoint: (time: number) => void;
  clearInOutPoints: () => void;
  inPoint: number | null;
  outPoint: number | null;
  /** The clip the preview's crop mode is open on, and how to close it (ESCSUITE-157). */
  cropClipId: string | null;
  setCropClipId: (clipId: string | null) => void;
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
  modalOpen,
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
  cropClipId,
  setCropClipId,
}: AppKeyboardShortcutsDeps): void {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // A modal is in front; the app behind it is not taking keys.
      if (modalOpen) {
        return;
      }

      // Read the lock on demand — the same reason `currentTime` is read through
      // `getState()` rather than subscribed to (see the file banner): a `tracks`
      // dependency here would re-run this whole effect, and re-render the app,
      // on every lock toggle, for a question five branches ask only once each,
      // right before they would otherwise act on a clip the store has already
      // refused to touch.
      const lockedIn = (ids: Iterable<string>) => {
        const { clips: currentClips, tracks } = useEditorStore.getState().project.timeline;
        return anyClipOnLockedTrack(currentClips, tracks, ids);
      };

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
          if (lockedIn(selectedClipIds)) {
            showNotification('Track is locked', 'info');
            return;
          }
          // ESCSUITE-101: a selection that named only clips already gone
          // (an id left stale by something other than this Delete) refuses
          // silently — there is nothing to announce, the same way a pointer
          // veto is silent elsewhere in this file.
          if (deleteSelectedClips()) {
            showNotification(clipCountMessage(selectedClipIds.size, 'deleted'), 'info');
          }
          return;
        } else if (selectedClipId) {
          e.preventDefault();
          if (lockedIn([selectedClipId])) {
            showNotification('Track is locked', 'info');
            return;
          }
          if (activeTool === 'ripple') {
            rippleDeleteClip(selectedClipId);
            showNotification('Clip deleted (ripple)', 'info');
          } else if (removeClipFromTimeline(selectedClipId)) {
            // ESCSUITE-115: an id that names no clip (a stale selection, the
            // same way deleteSelectedClips's above can be) refuses silently —
            // nothing to announce; the toast is for a clip that actually went.
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
          // The clones haven't landed on the timeline yet, so `lockedIn` (which
          // looks a clip's *current* trackId up by id) is the wrong shape here —
          // ask about the clipboard clones' own `trackId` instead.
          const locked = lockedTrackIds(useEditorStore.getState().project.timeline.tracks);
          if (clipboard.some((clip) => locked.has(clip.trackId))) {
            showNotification('Track is locked', 'info');
            return;
          }
          // ESCSUITE-100: a clone can also refuse because its clipboard
          // trackId names no track at all (a project load replaced the
          // tracks) — the lock check above can't see that, so the store's own
          // all-or-nothing refusal is the one source of truth here.
          if (!pasteClips()) {
            showNotification('Nothing to paste here', 'info');
            return;
          }
          showNotification(clipCountMessage(clipboard.length, 'pasted'), 'info');
          return;
        }
      }

      // Ctrl/Cmd + D = Duplicate selected clip
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedClipId) {
        e.preventDefault();
        if (lockedIn([selectedClipId])) {
          showNotification('Track is locked', 'info');
          return;
        }
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
        if (lockedIn([selectedClipId])) {
          showNotification('Track is locked', 'info');
          return;
        }
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
        // Crop mode is a mode, so Escape leaves it before Escape touches a
        // selection (ESCSUITE-157). Below the shortcuts sheet, which is a modal
        // on top of everything; above the in/out points and the two selection
        // branches, because deselecting would leave crop mode as a side effect
        // and take the selection with it.
        //
        // Gated on the resolved target — `cropClipId === selectedClipId` — not
        // the raw latch (ESCSUITE-170): every other reader (`cropTarget`,
        // `cropOnCanvas`) already treats a latch that no longer names the
        // selected clip as inert, and this branch has to agree or it claims
        // Escape for a mode that is already off on screen, clearing nothing
        // and leaving the in/out points behind it for a second Escape to
        // reach.
        if (cropClipId && cropClipId === selectedClipId) {
          e.preventDefault();
          setCropClipId(null);
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
    handleZoomIn, handleZoomOut, showNotification, modalOpen, keyframePanelOpen, setKeyframePanelOpen,
    setSelectedClipId, setActiveTool, snapEnabled, setSnapEnabled, addMarker,
    goToNextMarker, goToPreviousMarker, showShortcuts, splitClip,
    selectedClipIds, deleteSelectedClips, copySelectedClips, pasteClips, clipboard, clearMultiSelection,
    setInPoint, setOutPoint, clearInOutPoints, inPoint, outPoint, cropClipId, setCropClipId
  ]);
}
