// Applying an `EditorBlock` (ESCSUITE-245) to the store: the in/out points and
// the markers a project file or a session snapshot carried.
//
// Not an edit, so it never pushes history: `setMarkers` writes the list in one
// `set` and the point setters have never recorded any. Reads the store at call
// time, like `useSessionAutosave`, rather than taking six actions as deps.
import { useEditorStore } from '../store/projectStore';
import type { EditorBlock } from '../store/types';

/** The store's current in/out points and markers, as a file or snapshot carries them. */
export function currentEditorBlock(): EditorBlock {
  const { inPoint, outPoint, markers } = useEditorStore.getState();
  return { inPoint, outPoint, markers };
}

/** Replace the store's in/out points and markers with `editor`'s. */
export function applyEditorBlock(editor: EditorBlock): void {
  const { clearInOutPoints, setInPoint, setOutPoint, setMarkers } = useEditorStore.getState();
  // The block is already ordered (in < out), so neither setter swaps.
  clearInOutPoints();
  if (editor.inPoint !== null) setInPoint(editor.inPoint);
  if (editor.outPoint !== null) setOutPoint(editor.outPoint);
  setMarkers(editor.markers);
}
