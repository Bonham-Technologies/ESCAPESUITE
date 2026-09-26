# ESCSUITE-84 — A locked track is locked for every component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Track.locked` freezes a track's contents everywhere — every store action that would add, change, move, remove, split, duplicate, keyframe or restyle a clip on a locked track refuses, all-or-nothing, silently — and the two components that can show it (the inspector, the track header's delete button) do.

**Architecture:** One pure helper module (`store/trackLock.ts`) answers "is this track / this clip / any of these clips locked"; every mutating slice action asks it as its first statement and `return state` on refusal (no `modified`, no history). `findEmptyTrack` skips locked tracks. The inspector wraps its body in a `<fieldset disabled>` and shows one line; the track header disables delete.

**Tech Stack:** React 19, Zustand, Vitest + Testing Library (jsdom). Run everything from `apps/artist`: `npx vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-09-26-escsuite-84-track-lock-design.md` — the binding authority.

## Global Constraints

- A refused action returns the **same** `state` object — no `project.modified` write, no `pushToHistory`. Tests assert `history.past.length` unchanged and the clips array `toBe` the same reference where the action would otherwise have replaced it.
- Group actions are **all-or-nothing**: one locked member (or one locked landing row) refuses the whole action.
- The store is silent. No notice, no console output, on refusal.
- Cross-slice reads go through `state` (the `set` updater's argument) or `get()`, never through an import of another slice. `store/trackLock.ts` is a pure helper (imports only `./types`), like `timelineSnapping.ts`.
- Track properties stay editable: `updateTrack`, `reorderTracks`, `addTrack`, `muteSelectedClips`, `unmuteSelectedClips` are **not** guarded.
- Red first: every new behaviour test must fail on the code before its task's implementation step. Run it, see it fail, then implement.
- Byte-unchanged: `components/Timeline/timelineGestures.perf.test.ts`, `App.rerender.test.tsx`, `components/ClipEditor/ClipEditor.rerender.test.tsx`.
- Coverage floors for `@escapesuite/artist` are 99 / 98 / 93 / 98 (lines / statements / branches / functions) and only go up. Every new branch gets a test.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
  ```
- No Playwright. No subagents.

---

### Task 1: `store/trackLock.ts` and `findEmptyTrack` skipping locked tracks

**Files:**
- Create: `apps/artist/src/store/trackLock.ts`
- Create: `apps/artist/src/store/trackLock.test.ts`
- Modify: `apps/artist/src/store/projectFactory.ts` (`findEmptyTrack`)
- Test: `apps/artist/src/store/projectStore.timeline.test.ts` (describe `automatic track creation`)

**Interfaces:**
- Produces:
  ```ts
  export function lockedTrackIds(tracks: Track[]): Set<string>
  export function isTrackLocked(tracks: Track[], trackId: string | undefined): boolean
  export function clipOnLockedTrack(clips: Clip[], tracks: Track[], clipId: string): boolean
  export function anyClipOnLockedTrack(clips: Clip[], tracks: Track[], clipIds: Iterable<string>): boolean
  ```
  Later tasks import these from `./trackLock` inside the slices.

- [ ] **Step 1: Write the failing unit tests**

`apps/artist/src/store/trackLock.test.ts`:
```ts
// The lock's four questions, over the clips and tracks they are handed (ESCSUITE-84).
import { describe, it, expect } from 'vitest'
import { anyClipOnLockedTrack, clipOnLockedTrack, isTrackLocked, lockedTrackIds } from './trackLock'
import type { Clip, Track } from './types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from './types'

const track = (id: string, locked: boolean): Track => ({
  id, name: id, index: 0, visible: true, locked, muted: false, volume: 1, height: 60,
})
const clip = (id: string, trackId: string): Clip => ({
  id, sourceVideoId: 'v', name: id, startTime: 0, endTime: 1, duration: 1, trackId,
  timelinePosition: 0, blendMode: 'normal', transform: { ...DEFAULT_TRANSFORM },
  effects: { ...DEFAULT_EFFECTS }, transition: { ...DEFAULT_TRANSITION },
})
const tracks = [track('free', false), track('held', true)]
const clips = [clip('a', 'free'), clip('b', 'held')]

describe('lockedTrackIds', () => {
  it('names the locked tracks and nothing else', () => {
    expect([...lockedTrackIds(tracks)]).toEqual(['held'])
  })
})

describe('isTrackLocked', () => {
  it('is true for a locked track', () => { expect(isTrackLocked(tracks, 'held')).toBe(true) })
  it('is false for an unlocked track', () => { expect(isTrackLocked(tracks, 'free')).toBe(false) })
  it('is false for a track that is not on the timeline', () => { expect(isTrackLocked(tracks, 'gone')).toBe(false) })
  it('is false for no track at all', () => { expect(isTrackLocked(tracks, undefined)).toBe(false) })
})

describe('clipOnLockedTrack', () => {
  it('is true for a clip on a locked track', () => { expect(clipOnLockedTrack(clips, tracks, 'b')).toBe(true) })
  it('is false for a clip on an unlocked track', () => { expect(clipOnLockedTrack(clips, tracks, 'a')).toBe(false) })
  it('is false for a clip that is not on the timeline', () => { expect(clipOnLockedTrack(clips, tracks, 'zz')).toBe(false) })
})

describe('anyClipOnLockedTrack', () => {
  it('is true when one of the clips is on a locked track', () => {
    expect(anyClipOnLockedTrack(clips, tracks, ['a', 'b'])).toBe(true)
  })
  it('is false when none is', () => { expect(anyClipOnLockedTrack(clips, tracks, ['a'])).toBe(false) })
  it('is false for no clips', () => { expect(anyClipOnLockedTrack(clips, tracks, [])).toBe(false) })
  it('takes a Set as well as an array', () => {
    expect(anyClipOnLockedTrack(clips, tracks, new Set(['b']))).toBe(true)
  })
})
```

- [ ] **Step 2: Run them, expect failure** — `npx vitest run src/store/trackLock.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `store/trackLock.ts`**

```ts
// Which rows are frozen, and whether a given clip sits on one.
//
// `Track.locked` means "prevent edits" (ESCSUITE-84): every store action that
// would add a clip to a locked track, or change, move, remove, split, duplicate,
// keyframe or restyle a clip already on one, asks one of these four questions
// first and returns its state untouched when the answer is yes. Pure functions
// over the clips and tracks they are handed — no store, no React — so a slice
// can import them without an edge to any other slice, the way it imports
// `timelineSnapping.ts` and `projectFactory.ts`.
//
// A track that is not on the timeline is not locked, and a clip that is not on
// the timeline is not on a locked track: both are "nothing to protect", and the
// action that asked already has its own answer for a missing id.
import type { Clip, Track } from './types';

/** Ids of the tracks whose contents are frozen. */
export function lockedTrackIds(tracks: Track[]): Set<string> {
  const ids = new Set<string>();
  for (const track of tracks) {
    if (track.locked) ids.add(track.id);
  }
  return ids;
}

/** Whether `trackId` names a locked track. */
export function isTrackLocked(tracks: Track[], trackId: string | undefined): boolean {
  if (trackId === undefined) return false;
  const track = tracks.find((t) => t.id === trackId);
  return track !== undefined && track.locked;
}

/** Whether the clip with `clipId` sits on a locked track. */
export function clipOnLockedTrack(clips: Clip[], tracks: Track[], clipId: string): boolean {
  const clip = clips.find((c) => c.id === clipId);
  return clip !== undefined && isTrackLocked(tracks, clip.trackId);
}

/**
 * Whether ANY of the named clips sits on a locked track — the all-or-nothing
 * question a group action asks before it touches anything.
 */
export function anyClipOnLockedTrack(
  clips: Clip[],
  tracks: Track[],
  clipIds: Iterable<string>
): boolean {
  const wanted = clipIds instanceof Set ? clipIds : new Set(clipIds);
  if (wanted.size === 0) return false;
  const locked = lockedTrackIds(tracks);
  if (locked.size === 0) return false;
  for (const clip of clips) {
    if (wanted.has(clip.id) && locked.has(clip.trackId)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run them, expect pass.**

- [ ] **Step 5: Write the failing `findEmptyTrack` test** — in `projectStore.timeline.test.ts`, inside `describe('automatic track creation')`:

```ts
    it('never places a clip on an empty track that is locked (ESCSUITE-84)', () => {
      // One track, empty and locked: the clip must go to a NEW track, not this one.
      const lockedId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().updateTrack(lockedId, { locked: true })

      useEditorStore.getState().addClipToTimeline({
        sourceVideoId: video.id, name: 'x', startTime: 0, endTime: 1, duration: 1, timelinePosition: 0,
      } as Parameters<typeof useEditorStore.getState>['0'] extends never ? never : Omit<Clip, 'id' | 'trackId' | 'blendMode' | 'transform' | 'effects' | 'transition'>)
      // Use the exact argument shape the file's neighbouring tests already pass to addClipToTimeline; copy it.

      const { tracks, clips } = useEditorStore.getState().project.timeline
      expect(tracks).toHaveLength(2)
      expect(clips[0].trackId).not.toBe(lockedId)
    })
```
(Copy the `addClipToTimeline` argument literal from the neighbouring tests in that describe rather than the placeholder cast above; the assertion is what matters.)

- [ ] **Step 6: Run it, expect failure** (the clip lands on the locked track; `tracks` has length 1).

- [ ] **Step 7: Implement** — in `projectFactory.ts`:
```ts
// Find an empty track (no clips assigned) - returns lowest index empty track.
// A locked track is never chosen (ESCSUITE-84): its contents are frozen, and an
// empty locked track is still locked.
function findEmptyTrack(tracks: Track[], clips: Clip[]): Track | null {
  const usedTrackIds = new Set(clips.map(c => c.trackId));
  const emptyTracks = tracks.filter(t => !usedTrackIds.has(t.id) && !t.locked);
  if (emptyTracks.length === 0) return null;
  // Return the one with lowest index
  return emptyTracks.reduce((a, b) => a.index < b.index ? a : b);
}
```

- [ ] **Step 8: Run `npx vitest run src/store`**, expect all green. **Commit:** `feat(artist): trackLock helpers, and findEmptyTrack never picks a locked track (ESCSUITE-84)`.

---

### Task 2: clipSlice guards

**Files:**
- Modify: `apps/artist/src/store/clipSlice.ts`
- Test: `apps/artist/src/store/projectStore.timeline.test.ts` (new `describe('a locked track (ESCSUITE-84)')`)

**Interfaces:**
- Consumes: `clipOnLockedTrack`, `isTrackLocked`, `anyClipOnLockedTrack` from `./trackLock`.

- [ ] **Step 1: Write the failing tests.** Add at the end of `projectStore.timeline.test.ts` (inside the top-level describe), one `it` per action. Shape (use the file's own `addClip` / `store` fixtures; `addClip(id, position, duration, trackId)` as elsewhere in the artist suite):

```ts
  describe('a locked track (ESCSUITE-84)', () => {
    let held: string
    let free: string
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      held = useEditorStore.getState().project.timeline.tracks[0].id
      free = store().addTrack('Free').id
      addClip('h1', 0, 2, held)
      addClip('h2', 4, 2, held)
      addClip('f1', 0, 2, free)
      store().updateTrack(held, { locked: true })
    })

    /** Assert the action wrote nothing: same clips array, no history entry. */
    const refuses = (act: () => void) => {
      const before = clipsRef(); const entries = past()
      act()
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses to add a clip to it by explicit track id', () => refuses(() =>
      store().addClipToTimeline({ /* the file's usual literal */ } as never, held)))
    it('refuses to remove a clip on it', () => refuses(() => store().removeClipFromTimeline('h1')))
    it('refuses to ripple-delete a clip on it', () => refuses(() => store().rippleDeleteClip('h1')))
    it('refuses to update a clip on it', () => refuses(() => store().updateClip('h1', { endTime: 1 })))
    it('refuses to split a clip on it', () => refuses(() => store().splitClip('h1', 1)))
    it('refuses to move a clip on it in time', () => refuses(() => store().setClipTimelinePosition('h1', 8)))
    it('refuses to move a clip on it to another track', () => refuses(() => store().moveClipToTrack('h1', free)))
    it('refuses to move a clip onto it from another track', () => refuses(() => store().moveClipToTrack('f1', held)))
    it('refuses to transform a clip on it', () => refuses(() => store().updateClipTransform('h1', { x: 0.2 })))
    it('refuses to change the blend mode of a clip on it', () => refuses(() => store().updateClipBlendMode('h1', 'multiply')))
    it('refuses to change the effects of a clip on it', () => refuses(() => store().updateClipEffects('h1', { blur: 3 })))
    it('refuses to change the transition of a clip on it', () => refuses(() => store().updateClipTransition('h1', { type: 'fade' })))
    it('refuses to change the animation of a clip on it', () => refuses(() => store().updateClipAnimation('h1', { inPreset: 'fade' })))
    it('refuses to duplicate a clip on it', () => refuses(() => store().duplicateClip('h1')))
    it('refuses to shift the clips on it', () => refuses(() => store().shiftClipsAfter(held, 1, 2)))
    it('refuses a shift over every track when any shifted clip is on it', () => refuses(() => store().shiftClipsAfter(undefined, 1, 2)))
    it('still shifts the clips on an unlocked track', () => {
      addClip('f2', 4, 2, free)
      store().shiftClipsAfter(free, 1, 2)
      expect(clipsRef().find((c) => c.id === 'f2')!.timelinePosition).toBe(6)
    })
    it('still edits a clip on an unlocked track while another track is locked', () => {
      store().updateClipBlendMode('f1', 'multiply')
      expect(clipsRef().find((c) => c.id === 'f1')!.blendMode).toBe('multiply')
    })
  })
```
Check each action's real argument types in `store/types.ts` (`Partial<Transition>` field names, `Partial<ClipAnimation>` field names) and use valid ones; the placeholders `{ type: 'fade' }` / `{ inPreset: 'fade' }` are to be replaced by whatever the types actually name.

- [ ] **Step 2: Run, expect every `refuses` case to FAIL** (the clips array is replaced and an entry pushed) and the two `still` cases to pass.

- [ ] **Step 3: Implement.** In `clipSlice.ts`, `import { anyClipOnLockedTrack, clipOnLockedTrack, isTrackLocked } from './trackLock';` and add as the **first statement** of each updater:

- `addClipToTimeline`: `if (isTrackLocked(state.project.timeline.tracks, trackId)) return state;` (only an explicit id can be locked — `findEmptyTrack` skips locked ones from Task 1).
- `removeClipFromTimeline`, `rippleDeleteClip`, `updateClip`, `splitClip`, `setClipTimelinePosition`, `updateClipTransform`, `updateClipBlendMode`, `updateClipEffects`, `updateClipTransition`, `updateClipAnimation`, `duplicateClip`:
  `if (clipOnLockedTrack(state.project.timeline.clips, state.project.timeline.tracks, clipId)) return state;`
- `moveClipToTrack`: the clip guard above **and** `if (isTrackLocked(state.project.timeline.tracks, trackId)) return state;`
- `shiftClipsAfter`: after the existing `if (delta === 0) return state;`:
  ```ts
  // A locked track holds its clips where they are (ESCSUITE-84) — and the
  // shift is all-or-nothing, so one locked row among the rows that would move
  // refuses the whole call. With a `trackId` that is the same as asking whether
  // that row is locked; without one, whether any clip past `afterTime` is.
  const { clips, tracks } = state.project.timeline;
  const shifting = clips.filter(
    (clip) => (trackId === undefined || clip.trackId === trackId) && clip.timelinePosition >= afterTime
  );
  if (anyClipOnLockedTrack(clips, tracks, shifting.map((clip) => clip.id))) return state;
  ```
- `placeTakeOnTimeline`: no guard (spec).

Add one comment block above the first guarded action, once, saying what the guards are and pointing at `trackLock.ts` and the spec; do not repeat it per action — a one-line `// ESCSUITE-84: a locked track's contents are frozen.` beside each guard is enough.

- [ ] **Step 4: Run `npx vitest run src/store src/components/Timeline`**, expect green (the drag hooks' own tests must still pass — they veto before the store). **Commit:** `feat(artist): every clipSlice mutation refuses a clip on a locked track (ESCSUITE-84)`.

---

### Task 3: keyframeSlice and overlaySlice guards

**Files:**
- Modify: `apps/artist/src/store/keyframeSlice.ts`, `apps/artist/src/store/overlaySlice.ts`, `apps/artist/src/store/types.ts` (the two add-overlay signatures)
- Test: `apps/artist/src/store/keyframeSlice.history.test.ts`, `apps/artist/src/store/projectStore.test.ts` (describe `overlay clips`)

**Interfaces:**
- `addTextOverlayClip(...)` and `addShapeOverlayClip(...)` return `Clip | null` — `null` when the explicit `trackId` is locked. Update `EditorState` in `types.ts`. Check every caller compiles: `useClipEditorActions.ts` ignores the return; grep `addTextOverlayClip\|addShapeOverlayClip` across `src` for any that read it (tests included) and adjust with a non-null assertion where the test passes no track.

- [ ] **Step 1: Failing tests.** In `keyframeSlice.history.test.ts` add a describe `a locked track (ESCSUITE-84)` with the same `refuses` shape as Task 2 (lock the clip's track with `store().updateTrack(id, { locked: true })` after `addClip`), one case each for `setClipKeyframe`, `removeClipKeyframe` (add a keyframe first, then lock), `moveClipKeyframe`, `clearClipKeyframes`. In `projectStore.test.ts` `overlay clips`: `addTextOverlayClip(undefined, lockedTrackId)` returns `null` and adds nothing; same for `addShapeOverlayClip({ type: 'rectangle' }, lockedTrackId)`; `updateTextOverlayData` / `updateShapeOverlayData` on a clip whose track is then locked write nothing (same `refuses` shape); and `addTextOverlayClip()` with no track, when the only empty track is locked, lands on a **new** track.

- [ ] **Step 2: Run, expect the refusals to fail.**

- [ ] **Step 3: Implement.** keyframeSlice: `clipOnLockedTrack` guard first in all four clip actions (the five panel-UI setters are untouched). overlaySlice: in both add actions, right after `const state = get();`:
  ```ts
  // An explicit locked track takes nothing (ESCSUITE-84); with no track named,
  // `findEmptyTrack` already skips the locked ones.
  if (isTrackLocked(state.project.timeline.tracks, trackId)) return null;
  ```
  and the two `update*OverlayData` actions get the `clipOnLockedTrack` guard. Widen the two return types in `types.ts` to `Clip | null` and fix callers.

- [ ] **Step 4: `pnpm --filter=@escapesuite/artist run typecheck` and `npx vitest run src/store src/components/ClipEditor`**, green. **Commit:** `feat(artist): keyframes and overlay data refuse a clip on a locked track; an overlay is never added to one (ESCSUITE-84)`.

---

### Task 4: selectionSlice and trackSlice guards

**Files:**
- Modify: `apps/artist/src/store/selectionSlice.ts`, `apps/artist/src/store/trackSlice.ts`
- Test: `apps/artist/src/store/__tests__/projectStore.multiSelect.test.ts`, `apps/artist/src/store/projectStore.timeline.test.ts` (`track management`)

- [ ] **Step 1: Failing tests** (multiSelect file, using its own clip/track helpers; lock with `updateTrack`):
  - `deleteSelectedClips` with a selection holding one locked-row clip and one free clip removes **nothing** (both still present, no history entry, selection unchanged).
  - `deleteSelectedClips` with only free clips selected still removes them (control).
  - `pasteClips` after copying a clip from a track that is then locked pastes nothing (clip count unchanged, no history entry, `selectedClipIds` unchanged).
  - `pasteClips` where the clipboard holds one free-track clip and one locked-track clip pastes nothing (all-or-nothing).
  - `moveSelectedClips(1, 0)` with a locked-row member moves nothing; `moveSelectedClips(0, 1)` where a free member would land on a locked row moves nothing (build three tracks; lock the middle one).
  - `muteSelectedClips` with a locked-row member **still mutes** that track (control — a track property).
  - `projectStore.timeline.test.ts` `track management`: `removeTrack` on a locked track removes neither the track nor its clips and pushes no entry; `removeTrack` on an unlocked track still works (control exists already).

- [ ] **Step 2: Run, expect the refusals to fail.**

- [ ] **Step 3: Implement.**
  - `deleteSelectedClips`: after the size check, `if (anyClipOnLockedTrack(clips, tracks, state.selectedClipIds)) return state;`
  - `pasteClips`: after computing `newClips`, `if (newClips.some((clip) => locked.has(clip.trackId))) return state;` with `const locked = lockedTrackIds(state.project.timeline.tracks);` — clones keep their `trackId`, so the check is on the clones.
  - `moveSelectedClips`: compute the landing track for each member exactly the way the action already does (its `Math.max(0, Math.min(len - 1, idx + deltaTrack))` clamp), and refuse if any member's current or landing track is locked. Do it before any write; keep the existing arithmetic byte-for-byte.
  - `trackSlice.removeTrack`: after the `tracks.length <= 1` check, `if (isTrackLocked(tracks, trackId)) return state;`.

- [ ] **Step 4: `npx vitest run src/store src/components/Timeline`**, green. **Commit:** `feat(artist): a selection touching a locked track is deleted, pasted or moved all-or-nothing; a locked track cannot be removed (ESCSUITE-84)`.

---

### Task 5: The inspector and the track header show the lock; the shortcuts go through the store

**Files:**
- Modify: `apps/artist/src/components/ClipEditor/useClipEditorActions.ts` (expose `trackLocked`), `ClipEditor.tsx` (fieldset), `ClipEditorHeader.tsx` (`locked` prop + notice line), `ClipEditor.module.css` (`.body` fieldset reset, `.lockedNotice`), `apps/artist/src/components/Timeline/TrackHeader.tsx` (delete disabled)
- Test: `components/ClipEditor/ClipEditor.test.tsx`, `components/ClipEditor/useClipEditorActions.test.ts`, `components/Timeline/TrackHeader.test.tsx`, `app/useAppKeyboardShortcuts.test.ts`

- [ ] **Step 1: Failing tests.**
  - `ClipEditor.test.tsx`: select a clip, lock its track → the panel's `<fieldset>` (`screen.getByRole('group')` — a fieldset has the implicit `group` role — or `container.querySelector('fieldset')`) is `disabled`; the text `Track locked — unlock it in the timeline to edit this clip` is shown; the Delete button is disabled; unlock → enabled and the line gone. Add a control: with the track unlocked the fieldset is not disabled.
  - `useClipEditorActions.test.ts`: `trackLocked` is `true` when the selected clip's track is locked, `false` otherwise and when there is no track.
  - `TrackHeader.test.tsx`: with `locked: true` the delete button is disabled and titled `Unlock the track to delete it`; with `locked: false` (and `trackCount > 1`) it is enabled and titled `Delete track`.
  - `useAppKeyboardShortcuts.test.ts`: the hook takes actions through `deps` (mocks), so the lock is the store's — add **one** test in a new `describe('a locked track (ESCSUITE-84)')` that mounts the hook with `deps` wired to the **real store** (`useEditorStore.getState().removeClipFromTimeline` etc.), adds a clip, locks its track, selects it, presses Delete, and asserts the clip is still there. If the file's `mountShortcuts` cannot take real actions, put this test in `App.shortcuts.test.tsx` instead, where the real store is already driven, and say so in the report.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.**
  - `useClipEditorActions.ts`: `const trackLocked = track?.locked === true;` returned beside `track`; add to the hook's result type with a doc comment.
  - `ClipEditor.tsx`: replace the fragment after the container `div` with
    ```tsx
    <fieldset className={styles.body} disabled={trackLocked}>
      <ClipEditorHeader … locked={trackLocked} />
      …every section exactly as it is…
    </fieldset>
    ```
    The section **guards and their order do not move** (see the `CollapsibleSection` note in `apps/artist/CLAUDE.md`).
  - `ClipEditorHeader.tsx`: `locked: boolean` prop; after the info rows, `{locked && <p className={styles.lockedNotice} role="status">Track locked — unlock it in the timeline to edit this clip</p>}`.
  - `ClipEditor.module.css`: `.body { border: 0; margin: 0; padding: 0; min-width: 0; }` (a fieldset's UA defaults would otherwise add a border and padding) and `.lockedNotice` (muted colour, small, margin-top 8px).
  - `TrackHeader.tsx`: `disabled={trackCount <= 1 || track.locked}` and `title={track.locked ? 'Unlock the track to delete it' : 'Delete track'}`.

- [ ] **Step 4: `npx vitest run src/components/ClipEditor src/components/Timeline src/app`** green; **also** `npx vitest run src/components/ClipEditor/ClipEditor.rerender.test.tsx src/components/Timeline/timelineGestures.perf.test.ts src/App.rerender.test.tsx` green and `git diff --stat main -- <those three files>` empty. **Commit:** `feat(artist): the inspector and the track header show a locked track (ESCSUITE-84)`.

---

### Task 5b: The keyboard shortcuts stop announcing an edit the store refused

**Why (found writing Task 5's shortcut test):** `app/useAppKeyboardShortcuts.ts` calls a store
action and then `showNotification('Clip deleted', …)` regardless — the action returns nothing,
so after the lock the toast says *deleted*, *pasted*, *duplicated* or *split* while the store
refused and nothing happened. That is the one place ESCSUITE-84 would put a wrong sentence in
front of the user, so the hook asks the lock question itself, on demand, before it acts.

**Files:**
- Modify: `apps/artist/src/app/useAppKeyboardShortcuts.ts`
- Test: `apps/artist/src/App.shortcuts.test.tsx` (real store), `apps/artist/src/app/useAppKeyboardShortcuts.test.ts` (the branch contract with mocks)

**Rule:** before each of the five branches that edit a clip — Delete/Backspace (multi and single, ripple included), Ctrl+V paste, Ctrl+D duplicate, Ctrl+B split — read `useEditorStore.getState().project.timeline` **on demand** (the same shape the hook already uses for `currentTime`; **no new selector, no new dependency**, so `App.rerender.test.tsx` and the 38-entry deps array stay as they are) and ask `anyClipOnLockedTrack(clips, tracks, ids)` / `lockedTrackIds` from `store/trackLock.ts`:
- Delete (multi): the selection; Delete (single, either tool): the one clip; Ctrl+D: the one clip; Ctrl+B: the one clip; Ctrl+V: whether any clipboard clone's `trackId` is locked (`clipboard` is already a dep; check `clipboard.some((clip) => locked.has(clip.trackId))`).
- If locked: `e.preventDefault()`, **do not call the action**, `showNotification('Track is locked', 'info')`, `return`. Otherwise the branch is unchanged.

- [ ] **Step 1: Failing tests.** In `App.shortcuts.test.tsx`: Delete on a locked-row clip → clip still there and the toast reads `Track is locked` (replace the stated-limit assertion Task 5 left, and its comment); Ctrl+D on a locked-row clip → one clip, `Track is locked`; Ctrl+V after copying a clip and locking its track → clip count unchanged, `Track is locked`; Ctrl+B with the playhead inside a locked-row clip → one clip, `Track is locked`; Delete on a multi-selection with one locked member → both clips remain, `Track is locked`. Controls already exist for the unlocked cases. In `useAppKeyboardShortcuts.test.ts` nothing changes unless a branch's mock contract moved; if it did, say so.
- [ ] **Step 2: Run, expect the five to fail** (the old toasts appear).
- [ ] **Step 3: Implement** as above; one helper inside the hook file, `const lockedIn = (ids: Iterable<string>) => { const { clips, tracks } = useEditorStore.getState().project.timeline; return anyClipOnLockedTrack(clips, tracks, ids); }`, with a comment saying why it reads on demand.
- [ ] **Step 4:** `npx vitest run src/app src/App.shortcuts.test.tsx src/App.rerender.test.tsx src/app/useAppKeyboardShortcuts.rebinds.test.tsx` green; the rebinds test's measured count must not move (its assertion is the pin). **Commit:** `feat(artist): the shortcuts say "Track is locked" instead of announcing an edit the store refused (ESCSUITE-84)`.

---

### Task 6: Docs, changeset, coverage

**Files:**
- Modify: `apps/artist/CLAUDE.md`, root `CLAUDE.md` (coverage row + sentence), create `.changeset/artist-track-lock-everywhere.md`

- [ ] **Step 1:** `apps/artist/CLAUDE.md`: the Track properties bullet gains "— `locked` freezes the track's contents everywhere (ESCSUITE-84, see Timeline)"; a new paragraph **A locked track is locked for every component** after the ESCSUITE-82 one, covering: the store as the single enforcement point (`store/trackLock.ts`'s four questions, the table of actions from the spec condensed to prose), all-or-nothing, silence, what stays editable (track properties, mute/unmute), `findEmptyTrack` skipping locked, the overlay adds returning `null`, the inspector's fieldset and notice, the header's delete button, and the stated limit (the keyframe panel and the toolbar rely on the store and show nothing). Add `trackLock.ts` to the **Pure helpers** table.
- [ ] **Step 2:** Changeset:
  ```md
  ---
  '@escapesuite/artist': minor
  ---

  A locked track is locked for everything

  Locking a track used to stop clips being dragged, trimmed or cut on it and nothing else: Delete removed them, paste put clones back on the track, the inspector edited them, split and duplicate worked, the keyframe panel wrote keyframes, a new clip could land on an empty locked track, and the track itself could be deleted. Every one of those now refuses — all of it or none of it for a selection — so a locked track holds exactly what it had when it was locked. The inspector greys out for a clip on a locked track and says why; the track's own delete button is disabled. The track's name, mute, volume, visibility and order are still yours to change.
  ```
- [ ] **Step 3:** `cd apps/artist && npx vitest run --coverage 2>&1 | grep "All files"`, record the four figures; update the root `CLAUDE.md` row for `@escapesuite/artist` and add one sentence in the paragraph above the table ("re-measured 2026-09-26 at the end of ESCSUITE-84 … no floor crossed" or, if a whole percent is crossed upward, raise that floor in `apps/artist/vite.config.ts` and `scripts/coverage-report.mjs`). Run `pnpm --filter=@escapesuite/artist run typecheck` and `lint` (warning count must equal `main`'s 21).
- [ ] **Step 4: Commit:** `docs(artist): a locked track is locked for every component (ESCSUITE-84)`.
