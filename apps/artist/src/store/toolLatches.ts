// The preview's per-clip tools close when the selection leaves their clip
// (ESCSUITE-500).
//
// Crop mode (`cropClipId`, ESCSUITE-157) and Zoom to region
// (`zoomRegionClipId`, ESCSUITE-475) are latches naming the clip they were
// opened on, and every reader shows them only while that clip is the selected
// one. That hides a tool the moment the selection moves, but left the latch
// set, so selecting the clip again reopened the tool without being asked.
// The store now drops a latch whenever `selectedClipId` changes to anything
// other than the clip it names: another clip, none, or a clip deleted or
// undone away (which prunes the selection to null). A write that leaves
// `selectedClipId` as it was, such as a multi-selection change that keeps the
// same primary clip, or an undo that keeps the clip, leaves the tools open.
import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

type Latches = Pick<EditorState, 'cropClipId' | 'zoomRegionClipId'>;

/**
 * The latches to clear when a write takes the state from `state` to `next`
 * (a partial update), or null when nothing needs clearing. A latch that
 * `next` itself sets is judged by its new value.
 */
export function releasedLatches(state: EditorState, next: Partial<EditorState>): Partial<Latches> | null {
  if (!('selectedClipId' in next) || next.selectedClipId === state.selectedClipId) return null;
  const selected = next.selectedClipId ?? null;
  const patch: Partial<Latches> = {};
  const crop = 'cropClipId' in next ? next.cropClipId : state.cropClipId;
  const zoom = 'zoomRegionClipId' in next ? next.zoomRegionClipId : state.zoomRegionClipId;
  if (crop != null && crop !== selected) patch.cropClipId = null;
  if (zoom != null && zoom !== selected) patch.zoomRegionClipId = null;
  return 'cropClipId' in patch || 'zoomRegionClipId' in patch ? patch : null;
}

type SetState = (
  partial: EditorState | Partial<EditorState> | ((state: EditorState) => EditorState | Partial<EditorState>),
  replace?: boolean
) => void;

/**
 * Store middleware: every write, through a slice's `set` or the store's
 * `setState`, has {@link releasedLatches} merged into it, in the same write,
 * so no subscriber ever sees a latch that outlived its selection.
 */
export function latchesFollowSelection(
  config: StateCreator<EditorState>
): StateCreator<EditorState> {
  return (set, get, api) => {
    const rawSet = set as SetState;
    const followingSet: SetState = (partial, replace) =>
      rawSet((state) => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        const released = releasedLatches(state, next);
        return released ? { ...next, ...released } : next;
      }, replace);
    api.setState = followingSet as typeof api.setState;
    return config(followingSet as typeof set, get, api);
  };
}
