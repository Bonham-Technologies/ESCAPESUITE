# ESCSUITE-84 — A locked track is locked for every component

**Status:** approved (operator, 2026-09-26: "option 1; if the track is locked it should be locked for all components").
**Ticket:** ESCSUITE-84. **Related:** ESCSUITE-82 (drops onto a locked row), ESCSUITE-80.

## Problem

`Track.locked` is documented as "Prevent edits", and after ESCSUITE-82 the pointer gestures honour
it end to end — a drag cannot start on a locked row or drop onto one, a trim cannot start on one,
the razor will not cut on one. Every other edit path ignores it: Delete and Backspace remove a
locked-row clip, ripple delete removes it and shifts its row, paste lands clones back on the
locked row they were copied from, the inspector's every control edits a locked-row clip (it can be
selected: the mousedown selects *before* the lock guard so the inspector can show it), split,
duplicate, the keyframe panel, the media library's "Add to timeline" and the ESCAPECRAFT handoff
can all place a clip on an empty locked track through `findEmptyTrack`, and the header's trash
button deletes a locked track and its clips.

## Decision

**The lock is enforced in the store, once, for every mutation of a track's contents.** A store
action that would add a clip to a locked track, or change, move, remove, split, duplicate,
keyframe or restyle a clip already on one, returns the state unchanged — no `modified` write, no
history entry. Group actions are **all-or-nothing**, matching the drop veto: a Delete on a
selection holding one locked-row clip removes nothing; a paste one of whose clones would land on
a locked row pastes nothing; a bulk move one of whose members sits on or would land on a locked
row moves nothing. Refusal is **silent**, like every existing veto — the store is not the place
for a notice, and the two components that can show the state do (below).

**What the lock does not freeze.** The track's *own* properties — name, mute, volume, visibility,
height, order, and the lock itself — stay editable from the header, because they are how a locked
track is managed and reorder moves no clip. `muteSelectedClips` / `unmuteSelectedClips` write the
same track property from the toolbar and stay allowed for the same reason. Deleting the track is
not a track property: it deletes the clips, so `removeTrack` refuses a locked track.

**Placement skips a locked track.** `findEmptyTrack` (the row a new media clip, overlay clip or
handed-over take lands on when no track is named) no longer returns a locked track: the lowest-
index empty *unlocked* track, else a new track at the top. An action handed an explicit locked
`trackId` refuses.

## Design

### `store/trackLock.ts` — pure, no store, no React

```ts
import type { Clip, Track } from './types';

/** Ids of the tracks whose contents are frozen. */
export function lockedTrackIds(tracks: Track[]): Set<string>;

/** Whether `trackId` names a locked track. A track that is not on the timeline is not locked. */
export function isTrackLocked(tracks: Track[], trackId: string | undefined): boolean;

/** Whether the clip with `clipId` sits on a locked track. A clip that is not on the timeline does not. */
export function clipOnLockedTrack(clips: Clip[], tracks: Track[], clipId: string): boolean;

/** Whether ANY of the named clips sits on a locked track — the all-or-nothing question. */
export function anyClipOnLockedTrack(clips: Clip[], tracks: Track[], clipIds: Iterable<string>): boolean;
```

`findEmptyTrack(tracks, clips)` in `projectFactory.ts` gains one filter: `!t.locked`.

### Store actions

Every guard is the first statement of the action's `set` updater and reads `state.project.timeline`
(cross-slice reads go through `state`, never an import — the slice graph stays edge-free). A
refused action `return state`.

| Slice | Action | Refuses when |
|---|---|---|
| project | `removeSourceVideo` | a clip on a locked track uses the source (all-or-nothing: the source and every clip stay) |
| clip | `addClipToTimeline` | an explicit `trackId` is locked (no `trackId`: `findEmptyTrack` skips locked) |
| clip | `placeTakeOnTimeline` | never — the primary goes through `findEmptyTrack`, companions to new tracks |
| clip | `removeClipFromTimeline`, `rippleDeleteClip`, `updateClip`, `splitClip`, `setClipTimelinePosition`, `updateClipTransform`, `updateClipBlendMode`, `updateClipEffects`, `updateClipTransition`, `updateClipAnimation`, `duplicateClip` | the clip is on a locked track |
| clip | `moveClipToTrack` | the clip's track **or** the target track is locked |
| clip | `shiftClipsAfter` | any clip that would shift is on a locked track (all-or-nothing; a defined `trackId` that is locked refuses outright) |
| keyframe | `setClipKeyframe`, `removeClipKeyframe`, `moveClipKeyframe`, `clearClipKeyframes` | the clip is on a locked track |
| overlay | `addTextOverlayClip`, `addShapeOverlayClip` | an explicit `trackId` is locked — the action returns **`null`** and writes nothing (return type widens to `Clip \| null`; the two UI callers pass no `trackId` and are unaffected, but must type-check) |
| overlay | `updateTextOverlayData`, `updateShapeOverlayData` | the clip is on a locked track |
| selection | `moveSelectedClips` | any member's current track or landing track is locked (the drag hook's `canMoveSelectedClips` already vetoes; the store is the authority) |
| selection | `deleteSelectedClips` | any member is on a locked track |
| selection | `pasteClips` | any clone would land on a locked track (clones keep their `trackId`) |
| selection | `muteSelectedClips`, `unmuteSelectedClips` | never — a track property |
| track | `removeTrack` | the track is locked |
| track | `addTrack`, `updateTrack`, `reorderTracks` | never |

### Components

- **Inspector** (`ClipEditor/`): `useClipEditorActions` exposes `trackLocked: boolean`
  (`track?.locked === true`). `ClipEditor.tsx` passes it to every section, and
  `CollapsibleSection` wraps **that section's contents** in `<fieldset disabled>`, leaving its
  header toggle and its `footer` slot outside. (Amended after review: one fieldset around the
  whole panel made `.container` a single flex child and cost every clip's inspector the gap
  between its sections, disabled the collapsible headers so a locked clip's closed sections
  could not be read, and killed Actions' "Go to" and Animation's "Open Keyframe Editor", which
  read rather than edit and stay live.)
  `ClipEditorHeader` takes `locked`, disables the delete button and renders one line under the
  info rows:
  `Track locked — unlock it in the timeline to edit this clip` (the fieldset's disabled state is
  the machine-readable half; this line is the human-readable one).
- **Track header** (`Timeline/TrackHeader.tsx`): the delete button is `disabled` while the track
  is locked, `title="Unlock the track to delete it"`.
- **Everything else** — keyboard shortcuts, the toolbar's delete, the keyframe panel, the media
  library, the handoff — relies on the store's refusal and shows nothing. The keyframe panel
  visibly disabling for a locked clip is a follow-up, not this ticket.

### Tests

Red first, one case per row of the table above in the store's existing test files
(`projectStore.timeline.test.ts`, `projectStore.test.ts`, `__tests__/projectStore.multiSelect.test.ts`,
`keyframeSlice.history.test.ts`, `__tests__/projectStore.takePlacement.test.ts`), each asserting the
clips are unchanged **and** `history.past.length` did not grow. Plus: `findEmptyTrack` skipping a
locked empty track (through `addClipToTimeline` with no track); paste and delete all-or-nothing
with a mixed selection; `useAppKeyboardShortcuts.test.ts` Delete on a locked-row clip through the
real store; `ClipEditor.test.tsx` fieldset disabled + notice; `TrackHeader.test.tsx` delete disabled.
`timelineGestures.perf.test.ts`, `App.rerender.test.tsx` and `ClipEditor.rerender.test.tsx`
byte-unchanged. Artist floors 99 / 98 / 93 / 98 only go up.

### Docs

`apps/artist/CLAUDE.md`: the Track properties bullet says what `locked` freezes; a "Track lock"
paragraph beside ESCSUITE-82's. Root `CLAUDE.md` coverage row re-measured. Changeset:
`@escapesuite/artist` **minor** — "A locked track is locked for everything".
