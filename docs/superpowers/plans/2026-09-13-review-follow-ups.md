# Review follow-ups from the decomposition program (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one PR on branch `chore/review-follow-ups` that clears the **non-performance** follow-ups
accumulated by the four decomposition branch reviews (Timeline #342, ClipEditor #345, craft App
#347, artist App #349) and the three dead-code-resolution reviews (#351/#353/#354). Every candidate
was re-grepped against `main` = `b0534f0`; twelve were already fixed during the program and are
listed as dropped. Performance items are **excluded** and listed at the end so nothing is lost.
ESCSUITE-48 (keyboard access to the keyframe graph) is a separate feature and is **out of scope**.

Four commits (five, counting Task 1's RED commit), one branch, one PR.

## Current structure

**The bugs are all one-liners in files the program created or moved.** `useTrackHeaderActions.ts`
(Timeline task 2), `useNotification.ts` / `useSessionRestore.ts` / `useHostIntegration.ts` (artist
App task 3), `useClipEditorActions.ts` / `TransitionSection.tsx` (ClipEditor tasks 2–3),
`useTimelineSeek.ts` (Timeline task 3). Three of them already carry a **pinned test that asserts the
finding rather than the target** and names the assertion to flip — that is the red half of
red-then-fix, already written.

**`apps/artist/src/store/selectors.ts` is entirely dead, not just its two preview hooks.** The
follow-up ticket named `usePreviewState` (`:86`) and `usePreviewActions` (`:105`). Verification
found more: `grep -rn "store/selectors\|from './selectors'" apps/artist/src apps/e2e services
packages` returns exactly **one** hit — `store/selectors.test.ts:33`. Not one production module
imports the file. The three selectors that *are* live (`selectSelectedClip`, `selectClipCount`,
`selectSelectedTrack`) are separate, duplicate definitions inside `store/projectStore.ts:1504-1508`,
and that is where `components/ClipEditor/useClipEditorActions.ts:31` imports `selectSelectedClip`
from. So the whole 224-line module plus its 341-line test are orphans of the same shape the two
deleted editors were.

**`store/projectStore.ts` still exports three pure helpers that have nothing to do with the store.**
`getSnapPoints` (`:1559`), `findNearestSnapPoint` (`:1572`) and `wouldOverlap` (`:1592`) read only
their parameters. `components/Timeline/timelineGeometry.ts:9` — a file whose own header says
"everything they read is a parameter … without a ref, a store subscription or a React render in
sight" — imports the store module to reach `findNearestSnapPoint`, and apologises for it at
`:5-8`. `components/Timeline/useClipDrag.ts:19` imports the other two. Their tests live in
`store/projectStore.test.ts:562-634`.

**craft's thumbnail constants exist twice.** `utils/previewThumbnail.ts:7-10` exports
`THUMBNAIL_WIDTH`/`THUMBNAIL_HEIGHT` and keeps `THUMBNAIL_TYPE`/`THUMBNAIL_QUALITY` private;
`core/thumbnailGenerator.ts:3-5` re-declares `WIDTH`/`HEIGHT`/`QUALITY` privately and spells
`'image/jpeg'` inline at `:47` and `:109`. **The direction of the dependency is forced:** five test
files `vi.mock('./core/thumbnailGenerator')` wholesale (`App.settings.test.tsx:29`,
`App.saving.test.tsx:44`, `App.recording.test.tsx:40`, `App.library.test.tsx:34`,
`hooks/useRecordingSave.test.ts:18`), so any constant that lived in `core/` would vanish under the
mock. The constants must live in `utils/previewThumbnail.ts` (never mocked) and `core/` must import
them, not the other way round.

**`src/test/fixtures/exportPipeline.ts` is no longer export-specific.** 17 importers; 8 are the
export pipeline (`core/exporter.test.ts`, `core/audioMixer.test.ts`, `core/exportMP4*.test.ts`,
`core/exportWebM.test.ts`, `core/canvasRenderer.*.test.ts`, `workers/exportWorker.test.ts`) and 9
are not (`components/ClipEditor/{AnimationSection,TransformSection,clipEditorModel}.test.*`,
`components/Preview/{hitTest,selectionOverlay,dragGeometry,previewGeometry}.test.ts`,
`components/Timeline/timelineGeometry.test.ts`).

**Coverage as recorded.** Root `CLAUDE.md:303-309`: artist `99.33 / 98.58 / 92.80 / 98.88`, craft
`100.00 / 99.20 / 95.78 / 99.67`. Floors live in three places each —
`apps/{artist,craft}/vite.config.ts`, `scripts/coverage-report.mjs:22-33`, and the root `CLAUDE.md`
table. `**/types.ts` is coverage-excluded in both apps, so `components/Timeline/types.ts` and
`store/types.ts` edits are free.

## Existing tests

| File | What it does that matters here |
|------|-------------------------------|
| `src/components/Timeline/useTrackHeaderActions.test.ts` | `:120-135` `it('pins a finding: lowering an unknown track loses a row')` — asserts `reorderTracks` was called with `[bottom, middle, undefined]` and that the store comes back **one track short**. Its own comment names the replacement: "Flip this to the assertion above (nothing called, order unchanged)". `:111-119` is that assertion, for `moveTrackUp` |
| `src/app/useNotification.test.ts` | `:56-68` `it('FINDING: a second notification does not cancel the first timer, so it is blanked early')`. File header `:5-6`: "Flip the last test when the timer is ever made cancellable". `:45-54` pins the real 3 s clear and must stay green |
| `src/components/ClipEditor/TransitionSection.test.tsx` | `:53-60` `it('reads none for a clip carrying no transition at all, but still shows a duration')` — comment says "A finding, not a target". `:73` `hides the duration while the transition is none` and `:79-87` must stay green |
| `src/components/ClipEditor/useClipEditorActions.test.ts` | `:98` `describe('useClipEditorActions with nothing selected')`; the file is where `handleGoToClip`'s identity and behaviour are pinned |
| `src/components/Timeline/useTimelineSeek.test.ts` | Covers both `handleRulerClick` (`useTimelineSeek.ts:84`) and `handleTrackClick` (`:118`), including the `setIsPlaying(false)` branch |
| `src/app/useSessionRestore.test.ts`, `src/App.session.test.tsx`, `src/App.project.test.tsx` | Assert `clearSessionState` was/was not called (`App.project.test.tsx:108,135,331`, `App.test.tsx:308`) but never on a rejection |
| `src/app/useSessionAutosave.test.ts:148` | `mockRejectedValueOnce(new Error('quota exceeded'))` — **the pattern to copy** for the un-awaited `clearSessionState` |
| `src/App.messages.test.tsx:248-330` | `?loadVideo=` / `loadVideoId` end to end, including the thumbnail branch — where the `revokeObjectURL` test belongs |
| `src/store/selectors.test.ts` | 341 lines, the **only** importer of `store/selectors.ts`. `:189-208` `usePreviewState`, `:210-228` `usePreviewActions` |
| `src/store/projectStore.test.ts:562-634` | `describe('getSnapPoints')`, `describe('findNearestSnapPoint')`, `describe('wouldOverlap')` — the tests that move in Task 3 |
| `src/components/Timeline/timelineGeometry.test.ts:122-138` | `describe('isExtendableClip')` — the only caller of the export Task 2 keeps |
| `apps/craft/src/utils/recordingFormat.test.ts:19` | `it('replaces every non-alphanumeric run with an underscore …')` — the assertion (`'Standup Demo: 9/9'` → `'standup_demo__9_9'`, two underscores for `": "`) proves it is per **character**, not per run |
| `apps/craft/src/utils/previewThumbnail.test.ts` | Does **not** assert the placeholder's `#666` / `24px sans-serif` / `textAlign: 'center'` — verified by grep |
| `src/store/legacyOverlays.test.ts:134` | Pins the legacy **blur** shape conversion directly; the rewritten `PreviewPlayer.overlays.test.tsx` legacy describe does not exercise one |

## Global constraints

- **Red-then-fix for every bug.** Task 1's first commit is the flipped/added assertions **failing**.
  Three of the six already exist as finding-pins; flipping them *is* the red commit. Do not write a
  fix until `pnpm --filter @escapesuite/artist test:run` is red on the named files.
- **Tests never mock the module under test** (`apps/artist/CLAUDE.md`, Testing). The new pure
  snap-point module in Task 3 is tested directly; craft's `previewThumbnail.ts` is never mocked and
  must not become mocked.
- **Floors only go up**, and in all three places at once (the app's `vite.config.ts`,
  `scripts/coverage-report.mjs`, the root `CLAUDE.md` table). Artist: lines 99 / statements 98 /
  branches 92 / functions 98. Craft: lines 100 / statements 99 / branches 95 / functions 99.
  **Craft has ZERO lines headroom** — every new craft production line must be covered. Raise a floor
  only where a re-measure crosses a whole percent. Never lower one.
- Per task: `pnpm --filter @escapesuite/artist lint` and `pnpm --filter @escapesuite/craft lint`
  **0 warnings**; `tsc -b --noEmit` clean in **both** apps; `test:coverage` green.
- ESLint `ecmaVersion` is **2020** in artist — no `Array.prototype.at()`, no `??=`.
- **`App` must never subscribe to `currentTime`** (`App.rerender.test.tsx`, one
  `toBeLessThanOrEqual(1)`). Nothing here touches `App.tsx`'s selectors; do not add one.
- **Headless kit**: Task 3 touches `store/projectStore.ts`'s exports, so run
  `pnpm --filter @escapesuite/headless-artist test:run`. `apps/e2e/fixtures/headless/project.json`
  must stay byte-identical.
- Do not name any new file `types.ts` (coverage-excluded).
- Every commit carries both trailers (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU`).

---

## Task 1: the six carried bugs, pinned red then fixed
- [ ] **Two commits on `chore/review-follow-ups`.**

  **(1) RED first.** One commit containing only test changes, which must fail. Three of these are
  *flips* of existing finding-pins; three are new.

  (a) `useTrackHeaderActions.test.ts:120-135` — rename to
  `it('ignores lowering a track that is not on the timeline')`, replace the body's assertions with
  the pair already used one test above: `expect(reorderTracks).not.toHaveBeenCalled()` and
  `expect(storeOrder()).toEqual([bottom, middle, top])`, and delete the "pins a finding" comment
  block. Fails today (the track really is dropped).

  (b) `useNotification.test.ts:56-68` — rename to
  `it('gives a second notification its own three seconds')`; after
  `advanceTimersByTime(2500)` + a second `showNotification`, assert the toast is **still showing**
  at +500 ms and +2999 ms and null at +3000 ms. Add a new case: an unmounted hook's pending timer
  writes nothing (`renderHook` → `unmount()` → `advanceTimersByTime(3000)` → no
  "update on unmounted component" warning; assert via a `console.error` spy with zero calls).
  Update the file header `:1-6`. Fails today.

  (c) `TransitionSection.test.tsx:53-60` — rename to
  `it('hides the duration for a clip carrying no transition at all')`; keep
  `expect(rowSelect('Type')).toHaveValue('none')` and assert `queryByLabelText('Duration')` is null.
  Delete the "A finding, not a target" comment. Fails today.

  (d) `useSessionRestore.test.ts` — new case: `vi.mocked(clearSessionState)`
  `.mockRejectedValueOnce(new Error('blocked'))`, call `handleDeclineSession`, flush
  microtasks, assert `console.error` was called and that `showSessionPrompt`/`pendingSession`
  still cleared. Copy the shape from `useSessionAutosave.test.ts:148`. Fails today with an
  unhandled rejection.

  (e) `App.messages.test.tsx` (in the `loadVideoId` describe, `:248-330`) — new case: the created
  object URL is revoked when `App` unmounts. Spy on `URL.createObjectURL`/`URL.revokeObjectURL`,
  drive `urlParams({ loadVideoId: 'recording1' })` with a thumbnail blob, unmount, assert
  `revokeObjectURL` was called with the same string `createObjectURL` returned. Fails today.

  (f) `useTimelineSeek.test.ts` — new case: on an **empty** timeline (`timelineDuration: 0`,
  `minTimelineDuration: 60`) a track click at 30 s seeks to 30, not 0, matching the ruler click the
  file already covers. Fails today.

  `handleGoToClip`'s dep fix has no observable behaviour change and is pinned by lint, not a test —
  add `expect(first).not.toBe(second)` on the callback identity across a selection change in
  `useClipEditorActions.test.ts` instead, which also fails today (the identity is stable because
  the dep is missing).

  **Commit:** `test(artist): pin the six carried review bugs red`

  **(2) The fixes.**

  1. **`useTrackHeaderActions.ts:63`** → `if (trackIndex < 0 || trackIndex >= sortedTracks.length - 1) return;`
     `findIndex`'s `-1` currently slips past `>= length - 1`, the swap writes the top row's id to
     index `-1`, and `reorderTracks` drops the resulting `undefined` — the timeline comes back one
     track short. `moveTrackUp:52` (`<= 0`) already reads `-1` correctly and does not change.
     **User-visible.**
  2. **`useNotification.ts:39-42`** → hold the timeout in a `useRef<ReturnType<typeof setTimeout> | null>(null)`;
     `showNotification` clears the held handle before setting the new one; a `useEffect(() => () =>
     { if (ref.current) clearTimeout(ref.current) }, [])` clears it on unmount. Keep the 3000 ms and
     the `'info'` default; keep `showNotification`'s `useCallback([])` identity stable — the ref
     makes that possible, and `useTimelineHeight`/`useSessionRestore`/`useAppKeyboardShortcuts`/
     `useProjectActions`/`useHostIntegration` all take it as a dependency. Rewrite the file header
     and the `:35-38` comment to describe the owned timer. **User-visible.**
  3. **`TransitionSection.tsx:41`** → `{(transition?.type ?? 'none') !== 'none' && (`. **Ruling: this
     is a bug to fix, not behaviour to keep.** The select two lines above already falls back with
     `transition?.type ?? 'none'` (`:31`), so an older clip with no transition object displays
     "Type: None" *and* a Duration slider at the same time; `AnimationSection.tsx:76,123` tests the
     type twice for exactly this reason and is the in-repo precedent. Dragging that phantom slider
     calls `updateClipTransition(id, { duration })` (`useClipEditorActions.ts:221-225`), writing a
     duration onto a transition the clip does not have. **User-visible.**
  4. **`useClipEditorActions.ts:176`** → deps `[selectedClip, clipPosition, setCurrentTime]`. This
     is the directory's one `exhaustive-deps` warning. **Reason about the behaviour and say it in the
     commit body:** the callback's identity now changes whenever the selected clip object changes
     rather than only when `clipPosition` does. Its sole consumer is `ActionsSection`'s button
     `onClick`, which is not memoised and takes no identity dependency, so no render count moves.
     Delete the "kept wrong on purpose" bullet at `:11-16` and leave the `setScaleLocked` bullet
     (`:17-20`) standing — that one is deferred to the performance round.
  5. **`useSessionRestore.ts:73`** → `clearSessionState().catch(console.error);`, matching
     `useSessionAutosave.ts:59`'s `saveSessionState(session).catch(console.error)`. The declining
     user's UI state still clears synchronously; only the rejection stops being unhandled.
  6. **`useHostIntegration.ts:126-131`** → keep the created URL in a local that
     the effect's existing `cleanup` closure revokes, and revoke-and-replace if the branch runs
     twice. **Ruling: revoke on unmount, do not document-why-not.** The blob URL is handed to
     `addSourceVideo({ …, thumbnailUrl })` and lives as long as the media library entry, so revoke
     in the effect's returned `cleanup` (line `:163` already returns one) rather than eagerly. The
     repo's own precedent for balanced create/revoke is `core/videoProcessor.ts:32,37,80,89` and
     `core/frameSource.ts:177,270`. **User-visible** only in that a long session stops leaking one
     blob per host-launched recording.
  7. **`useTimelineSeek.ts:118`** → `clampTime(time, timelineDuration || minTimelineDuration)`, and
     add `minTimelineDuration` to the deps at `:127`. **Decision:** harmonise *down* to the ruler's
     rule, not up. `Timeline.tsx:68` computes `minTimelineDuration = Math.max(timelineDuration, 60)`
     and draws **both** the ruler (`:210,212`) and `div.tracksContent` (`:251`) to it, so the two
     surfaces are the same coordinate space; today a ruler click on an empty project reaches 60 s
     while a track click in the identical pixel pins the playhead at 0. On any non-empty project the
     two expressions are already equal, so this changes behaviour **only** when
     `timelineDuration === 0`. Rewrite the `:13-15` comment. **User-visible.**

  **Reviewer verifies:** the RED commit exists in history and `git stash`-ing the fix commit makes
  the six named tests fail; `moveTrackUp`'s guard is untouched; `showNotification`'s
  `useCallback` dependency array is still `[]` and its identity test at `useNotification.test.ts:70`
  is green; `TransitionSection.test.tsx:73,79-87` unchanged and green; the `handleGoToClip` commit
  body states the identity consequence; `clearSessionState`'s `.catch` matches
  `useSessionAutosave.ts:59` exactly; the revoke runs in the existing `cleanup`, not eagerly;
  `useTimelineSeek.ts`'s two clamps now read identically; `pnpm --filter @escapesuite/artist lint`
  reports **0** warnings (down from 1).

  **Commit:** `fix(artist): fix the six bugs the decomposition reviews pinned as findings`

## Task 2: delete the dead code and the unreachable arms
- [ ] **One commit.**

  1. **Delete `src/store/selectors.ts` (224 lines) and `src/store/selectors.test.ts` (341 lines)
     entirely.** The ticket named only `usePreviewState` (`:86`) and `usePreviewActions` (`:105`);
     verification found the **whole module** has zero production importers —
     `grep -rn "store/selectors\|from './selectors'" apps/artist/src apps/e2e services packages`
     returns one hit, the test file. `selectSelectedClip` / `selectClipCount` / `selectSelectedTrack`
     are separately and identically defined in `store/projectStore.ts:1504-1508`, and that is where
     `components/ClipEditor/useClipEditorActions.ts:31` imports from — nothing regresses.
     **Before deleting, re-run the grep and paste it into the commit body.** If any of the eight
     composite hooks turns out to have a consumer, delete only the orphans and say which stayed.
     *Coverage:* the file scored 47/47 lines, 71/71 statements, 38/38 functions, 12/14 branches in
     the last per-file summary — removing a 100 %-lines, 100 %-functions file moves the aggregate
     **down** on lines/statements/functions and **up** on branches. Arithmetic against the recorded
     99.33 / 98.58 / 92.80 / 98.88 lands near 99.32 / 98.57 / 92.82 / 98.85 — every floor holds with
     headroom. **Re-measure in Task 4 rather than trusting this estimate.**
  2. **`src/app/useNotification.ts` — use the dead exported types rather than delete them.**
     `NotificationType` (`:13`) and `Notification` (`:16`) are exported and imported by nobody;
     `ShowNotification` (`:22`) is live in five modules. The shape `'info' | 'error' | 'success'` is
     spelled three times: `:13`, the `useState` at `:32`, and `NotificationToast.tsx:8`. Annotate the
     state as `useState<Notification | null>(null)` and the callback parameter as `type:
     NotificationType = 'info'`, and have `NotificationToast.tsx` `import type { Notification }` and
     type its prop with it. This is the byte-fidelity contract of the decomposition branch being
     released, deliberately, now that the branch has merged.
  3. **`AnimationSection.tsx` — delete the six unreachable `??` arms, keep the two reachable ones.**
     *Type evidence:* `ClipAnimation` (`store/types.ts:118-129`) declares `in` and `out` as
     `{ type: AnimationPresetType; duration: number; easing: EasingType }` — all three **required**.
     The enclosing guards `animation?.in.type !== 'none' && animation?.in.type` (`:76`) and the
     `out` twin (`:124`) prove `animation` is defined inside, so `animation.in.duration` and
     `.easing` cannot be nullish. Delete `?? 0.5` at `:85`/`:88`/`:133`/`:136` and
     `?? 'ease-out'` / `?? 'ease-in'` at `:94`/`:142`, and drop the now-pointless `?.` inside the
     guarded blocks. **Keep `?? 'none'` at `:66` and `:114`** — those sit *outside* the guard, where
     `animation` really is optional. Expected effect: `AnimationSection.tsx` moves off 80.64 %
     branches toward 100 %.
  4. **Delete the two unreachable guards.** `useClipDrag.ts:181` `el.getAttribute('data-track-id')
     || targetTrackId` → the elements are selected by `querySelectorAll('[data-track-id]')` (`:177`), so the attribute
     is present by construction; assert it with a non-null assertion and a one-line comment naming
     the selector, or keep the `||` and a comment. **Rule: remove only what the selector provably
     makes unreachable.** Same for `useTimelineMarquee.ts:149` `if (trackId)` under the identical
     selector at `:136`. These two are the only uncovered branches in
     `components/Timeline/`; removing them should take the directory to 100 % branches.
  5. **`Timeline.tsx:21` `PIXELS_PER_SECOND_BASE = 50`** → move to `timelineGeometry.ts` beside
     `RULER_MAJOR_INTERVAL` / `RULER_MINOR_INTERVAL` / `MIN_SPLIT_DISTANCE` / `MIN_CLIP_DURATION`
     with a TSDoc line, and import it at `Timeline.tsx:67`. A reader looking for "the timeline's
     constants" currently finds four of five in one file and the fifth in another.
  6. **`timelineGeometry.ts:129` `isExtendableClip`** — keep the `export` (its
     `timelineGeometry.test.ts:122-138` describe is worth keeping addressable) and **add the
     sentence the review asked for** to its doc comment: that its only production call site is
     `computeTrimUpdate` 40 lines below, and it is exported so the four edge×kind branches can be
     asserted by name. Do not un-export — the four sibling constants are test-only importers too
     and the review ruled that trade correct.

  **Reviewer verifies:** the paste-in grep proving `store/selectors.ts` had no production importer;
  `selectSelectedClip` still resolves to `store/projectStore.ts:1505` and
  `useClipEditorActions.ts:115` is unchanged; `useNotification.ts` has no remaining inline
  `'info' | 'error' | 'success'` and `NotificationToast.tsx:8` imports the type;
  `AnimationSection.tsx:66,114` still carry `?? 'none'` while `:85-142`'s six arms are gone, with the
  `ClipAnimation` field requirements quoted in the commit body; the two removed guards each leave a
  comment naming the `[data-track-id]` selector that makes them unreachable;
  `pnpm --filter @escapesuite/artist test:coverage` green.

  **Commit:** `refactor(artist): delete the dead selectors module and the unreachable fallback arms`

## Task 3: module hygiene, no behaviour change
- [ ] **One commit.**

  1. **New `apps/artist/src/store/timelineSnapping.ts`** holding `getSnapPoints`,
     `findNearestSnapPoint` and `wouldOverlap`, moved **verbatim** from `projectStore.ts:1559-1610`
     (same signatures, same `Set([0])` seed, same `<` vs `<=` comparisons, same sort). It imports
     only `type { Clip }` from `./types`, so it creates no cycle. Then:
     - `store/projectStore.ts` **re-exports** the three names
       (`export { getSnapPoints, findNearestSnapPoint, wouldOverlap } from './timelineSnapping';`)
       so no import path anywhere has to move in this commit and the headless bundle's module graph
       is unchanged;
     - `components/Timeline/timelineGeometry.ts:9` changes to
       `import { findNearestSnapPoint } from '../../store/timelineSnapping';` and its apologetic
       header at `:5-8` is rewritten — **this is the point of the task**: the pure geometry module
       stops importing the store;
     - `components/Timeline/useClipDrag.ts:19` likewise for `getSnapPoints` / `wouldOverlap`;
     - the three describes at `store/projectStore.test.ts:562-634` move to a new
       `store/timelineSnapping.test.ts` **unchanged**, and their imports at `:434-436` are removed.
     *Do not name the file `types.ts`* (coverage-excluded). Do not change any body.
  2. **craft — de-duplicate the thumbnail constants.** `utils/previewThumbnail.ts:9-10`: export
     `THUMBNAIL_TYPE` and `THUMBNAIL_QUALITY` alongside the two already-exported dimensions.
     `core/thumbnailGenerator.ts`: delete `:3-5` and
     `import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY, THUMBNAIL_TYPE } from
     '../utils/previewThumbnail';`, replacing the two inline `'image/jpeg'` literals (`:47`, `:109`)
     with `THUMBNAIL_TYPE`. **The direction is forced and must be stated in the commit body:** five
     suites `vi.mock('./core/thumbnailGenerator')` wholesale, so a constant living in `core/` would
     disappear under the mock; `utils/previewThumbnail.ts` is never mocked. *Craft-lines check:* net
     production lines go **down** by two, and the one added line is a module-level import executed
     whenever `thumbnailGenerator.test.ts` loads the module — no new uncovered line, which the
     `lines: 100` floor requires.
  3. **`components/Timeline/types.ts:22-24`** — rename `originalStartTime` / `originalEndTime` /
     `originalTimelinePosition` to a nested `origin: TrimOrigin` (importing the type from
     `timelineGeometry.ts:139`), which collapses `useTrimDrag.ts:101-105`'s field-by-field mapping to
     `origin: trimState.origin`. `types.ts` is coverage-excluded, so this is free; update every
     `TrimState` construction site and `useTrimDrag.test.ts`. If `TrimOrigin`'s import direction
     (component types file → geometry module) reads badly, move `TrimOrigin` into
     `components/Timeline/types.ts` and have `timelineGeometry.ts` import it — either way there must
     be **one** declaration of the three fields.
  4. **One declaration for the two duplicated inline shapes.** `app/TimelinePane.tsx:16`'s
     `onExportSelection: (timeRange: { start: number; end: number }) => void` is structurally
     identical to `components/Timeline/Timeline.tsx:24`'s (modulo required-vs-optional). Export
     `TimeRange` from `components/Timeline/timelineGeometry.ts` (or a new `app/appTypes.ts` —
     **not** `types.ts`) and have both spell `onExportSelection: (timeRange: TimeRange) => void`,
     keeping `Timeline`'s `?`. `app/NotificationToast.tsx:8` is covered by Task 2 item 2.
  5. **Rename `src/test/fixtures/exportPipeline.ts` → `src/test/fixtures/clipFixtures.ts`** and
     update **all 17** importers (`git grep -l exportPipeline`). Rewrite the file header `:1-6`,
     which currently says "Shared fixtures for the export-pipeline test files" — nine of its
     importers are inspector, preview and timeline suites. The `src/test/` location note at `:4-6`
     (outside both the vitest `include` glob and the coverage `include` glob) stays verbatim.
  6. **craft test semicolon dialect — decide: leave it, and say so.** Verified still mixed: the 19
     files the decomposition added (`src/hooks/*.test.ts`, `src/utils/recordingFormat.test.ts`, …)
     use **zero** line-ending semicolons; `src/App.library.test.tsx` has 142. **Ruling: do not
     normalise and do not add a lint rule in this PR.** Reformatting ~20 files would bury every
     other diff in this commit and a `semi` rule would also have to be decided for artist and
     `packages/shared`. Record it instead as a bullet in `apps/craft/CLAUDE.md`'s Testing section
     (near `:198`): new test files omit line-ending semicolons, older ones carry them, match the
     file you are editing. Re-file the lint-rule question as its own ticket.

  **Also verified and dropped from this task:** craft's `RecordingSource` re-spelling is **already
  fixed** — `App.tsx:12` imports `type RecordingSource` and `:130` uses it.
  `ensureTimelineHasTracks`'s "only code that touches either array" wording is **already fixed** —
  both `apps/artist/CLAUDE.md:113-118` and `store/types.ts:227-233` now carry the
  "apart from `ensureTimelineHasTracks` normalising a missing array to `[]` first" clause.

  **Reviewer verifies:** `grep -rn "from '.*store/projectStore'" apps/artist/src/components/Timeline`
  no longer reaches the store for snapping; the three moved function bodies are byte-identical
  (`git diff -w` shows no change inside them) and their tests moved unchanged;
  `pnpm --filter @escapesuite/headless-artist test:run` green and
  `apps/e2e/fixtures/headless/project.json` untouched; craft's `core/thumbnailGenerator.ts` imports
  from `utils/` and not the reverse, with the five `vi.mock` sites still green; no `exportPipeline`
  string survives anywhere; `tsc -b --noEmit` clean in both apps.

  **Commit:** `refactor(artist,craft): move the pure snapping helpers out of the store and de-duplicate shared shapes`

## Task 4: docs, coverage closers, floors and changesets
- [ ] **One commit, last.**

  **(1) Close the cheap coverage gaps** (these pay for Task 2's deletions and are the lever if a
  floor lands short):
  - `useClipEditorActions.test.ts` — two cases calling `handleAnimationInDurationChange` /
    `handleAnimationOutDurationChange` on a clip with **no** `animation`, asserting
    `{ type: 'none', duration: v, easing: 'ease-out' }` and `…'ease-in'`. Closes the only two
    partial branches in the file (`:238`, `:262`).
  - `ClipEditor.test.tsx` — render a clip that actually carries `effects.blur`, closing
    `ClipEditor.tsx:112`'s `selectedClip.effects?.blur ?? 0` (the file's only partial branch).
  - `KeyframePanel.test.tsx` — one case for `handleKeyframeEasingChanged`'s specified **no-op**:
    call it for a `time` no keyframe sits at and assert the store is unchanged
    (`KeyframePanel.tsx:192`'s `if (!existingKf) return`, currently the only untested arm of a
    behaviour the brief explicitly specified).
  - `PreviewPlayer.overlays.test.tsx` — one legacy **blur** shape through `setProject`, closing the
    known gap in the rewritten legacy describe (`legacyOverlays.test.ts:134` pins the conversion
    itself; nothing pins the resulting canvas calls).
  - `apps/craft/src/utils/previewThumbnail.test.ts` — assert the placeholder's `fillStyle` `'#666'`,
    `font` `'24px sans-serif'` and `textAlign` `'center'`. Three lines, and Task 3 moved constants
    out of the file next door, so this is the moment.

  **(2) Doc and type nits, all re-verified as still open:**
  - `app/useAppKeyboardShortcuts.ts:38-39`, `AppHeaderProps` and `FileMenuProps` type
    `handleSaveProject` / `handleLoadProject` as `() => void` while `useProjectActions.ts:42-43`
    returns `() => Promise<void>`. Widen the three declarations to `() => void | Promise<void>`.
    `tsc` is clean either way; the point is that an added `await` should type-check.
  - `utils/integration.ts:89` — `parseUrlParams` returns an inline object literal. Extract and export
    `interface UrlParams`, then `app/useHostIntegration.ts:15` stops doing
    `import { …, type parseUrlParams }` purely to spell `ReturnType<typeof parseUrlParams>` at `:23`,
    and re-exports nothing.
  - `app/appConstants.ts:11-13` — the single `/** Timeline panel height constraints, in pixels. */`
    attaches only to `MIN_TIMELINE_HEIGHT`. Give `MAX_TIMELINE_HEIGHT` and
    `DEFAULT_TIMELINE_HEIGHT` their own lines.
  - `app/AppHeader.tsx:77` — drop the now-redundant `{/* File Menu Dropdown */}` above `<FileMenu/>`.
  - `apps/craft/src/utils/recordingFormat.test.ts:19` — "every non-alphanumeric **run**" →
    "**character**". The assertion is right and proves it: `'Standup Demo: 9/9'` →
    `'standup_demo__9_9'` gives `": "` two underscores, not one.
  - `apps/artist/CLAUDE.md` — a row/line for the new `store/timelineSnapping.ts`; drop any
    `store/selectors.ts` reference (verified: **none exists today**, so this is a no-op — confirm
    with `grep -n "selectors.ts" apps/artist/CLAUDE.md CLAUDE.md`, which returns nothing);
    note the renamed `src/test/fixtures/clipFixtures.ts` wherever `exportPipeline` is named.
  - `apps/craft/CLAUDE.md` — the semicolon-dialect bullet from Task 3 item 6, and a line saying the
    thumbnail constants live in `utils/previewThumbnail.ts` **because** `core/thumbnailGenerator.ts`
    is `vi.mock`ed wholesale by the App suites.
  - **Already fixed, do not re-open:** `apps/artist/CLAUDE.md:422` reads "all **ten** components";
    `:381` reads "the seven `useState` calls the JSX **and the hooks** need" and "the **handful of**
    inline lambdas"; `app/TimelinePane.tsx:31` already carries the `onAddTrack` wrapper comment;
    root `CLAUDE.md:299` already carries the corrected re-measure dates.
  - **Verify before listing as deferred:** the ClipEditor review's M1 (the panel root alternating
    element type across empty↔selected) was fixed in the ClipEditor branch's fix round
    (`ClipEditor.tsx` wraps `ClipEditorEmptyState` in `div.container`). If `ClipEditor.tsx`'s
    empty branch returns `<div className={styles.container}>`, drop item 6 from the deferred list
    below.

  **(3) Re-measure and raise floors only on a whole-percent crossing.**
  `pnpm --filter @escapesuite/artist test:coverage && pnpm --filter @escapesuite/craft test:coverage`
  then `pnpm coverage:report`. Compare against the recorded rows — artist
  `99.33 / 98.58 / 92.80 / 98.88` (root `CLAUDE.md:307`), craft `100.00 / 99.20 / 95.78 / 99.67`
  (`:306`) — and the floors at `apps/artist/vite.config.ts:167-170`,
  `apps/craft/vite.config.ts:46-49`, `scripts/coverage-report.mjs:27-33`.
  **Raise a floor only where the new measurement crosses a whole percent**, and when you do, change
  **all three** locations in the same commit and refresh the date at root `CLAUDE.md:297-299`.
  Expected direction: artist **branches** is the live candidate — Task 2's four unreachable-arm
  removals push it up from 92.80 and 93 is plausible; artist **functions** is the metric to watch,
  since Task 2 deletes 38 fully-covered functions against ~0.88 pp of headroom. If functions lands
  below 98, **the fix is more tests, never a lowered floor** (root `CLAUDE.md:311-313`). Craft gains
  no production lines in this PR, so `lines: 100`'s zero headroom is not at risk — say so in the PR
  description anyway, as the craft review asked.

  **(4) Two changesets.**
  - `.changeset/review-followups-artist.md`, `'@escapesuite/artist': patch` —
    "Moving a track down no longer loses it when the track cannot be found; a second status message
    now gets its own three seconds instead of being blanked early by the previous one's timer, and a
    pending message no longer fires after the editor closes; the clip inspector no longer shows a
    transition-duration slider for a clip that has no transition; clicking the timeline's track area
    on an empty project now moves the playhead where you clicked, as the ruler already did; and a
    recording opened from ESCAPECRAFT no longer leaks its thumbnail's object URL."
  - `.changeset/review-followups-craft.md`, `'@escapesuite/craft': patch` —
    "Internal: the thumbnail size and quality constants now have a single definition, shared between
    the preview-thumbnail helpers and the generator." *(Patch with an explicit "Internal:" lead,
    matching the `remove-legacy-overlay-editors` precedent; craft has no user-visible change in this
    PR.)*
    Module moves, deletions and doc fixes are internal and are deliberately **not** described in the
    artist changeset.

  **Reviewer verifies:** `pnpm coverage:report` output pasted in the PR description; every floor
  raised (if any) appears in all three locations with the same number; the root `CLAUDE.md` table and
  its measurement date match the run; the artist changeset describes only user-visible behaviour and
  names five fixes; the craft changeset is scoped to craft alone; `pnpm build:artist` and
  `pnpm build:craft` green.

  **Commit:** `docs(artist,craft): record the follow-up fixes, close the cheap coverage gaps, and re-measure the floors`

## Done criteria

- The six pinned bugs are fixed, each one preceded in history by a commit where its test is red.
  `useTrackHeaderActions.test.ts`, `useNotification.test.ts` and `TransitionSection.test.tsx` no
  longer contain the words "FINDING" or "a finding, not a target" for these cases.
- `apps/artist/src/store/selectors.{ts,test.ts}` are gone and nothing imports them; the live
  selectors in `store/projectStore.ts:1504-1508` are untouched.
- `components/Timeline/timelineGeometry.ts` and `useClipDrag.ts` no longer import
  `store/projectStore`; `store/timelineSnapping.ts` holds the three pure helpers with their tests,
  and `projectStore.ts` re-exports them so no other path moved.
- craft's thumbnail constants have exactly one definition, in the module that is never `vi.mock`ed.
- No `exportPipeline` identifier or path survives.
- `pnpm --filter @escapesuite/{artist,craft} lint` **0** (artist drops its one `exhaustive-deps`
  warning); `tsc -b --noEmit` clean in both; `test:coverage` green in both with floors held and
  raised only where a whole percent was crossed, in all three places at once;
  `pnpm --filter @escapesuite/headless-artist test:run` green; `pnpm build:artist` and
  `pnpm build:craft` green; two changesets.

## Risks

**The `selectors.ts` deletion is bigger than the ticket said.** The follow-up named two hooks; the
whole 224-line module is dead. The danger is the reverse of the usual one — that someone sees
`selectSelectedClip` in the deleted file and assumes it was live. It was not: `useClipEditorActions.ts:31`
imports the identically-named selector from `store/projectStore.ts:1505`. Re-run the grep at
implementation time and paste it into the commit body; if the tree has moved, delete only the
orphans.

**Deleting 38 fully-covered functions pulls the functions percentage down.** Artist sits at 98.88
against a floor of 98. The arithmetic says ~98.85 afterwards, which holds, but it is the tightest
metric in the PR and the estimate comes from a stale per-file summary. **Re-measure; do not size the decision from that file.**
Task 4's five coverage closers exist partly as the lever if this lands short.

**Craft has zero lines headroom.** `lines: 100` means one uncovered production line turns the build
red. Task 3's craft change is net **−2** production lines and adds only an import, and Task 4 adds
no craft production code at all. Do not let a "while I'm here" craft refactor into this PR.

**The transition-guard fix is a visible behaviour change on old projects.** Any clip saved without a
`transition` object stops showing a Duration slider. The ruling is that the slider was never
meaningful there — the select beside it already said "None" and dragging it wrote a duration onto a
transition that does not exist — but a user who has been dragging it will notice. It is in the
changeset for that reason.

**The seek harmonisation touches a hot path.** `useTimelineSeek.ts:118` is the track-area click.
The change is confined to `timelineDuration === 0` (on any non-empty project
`timelineDuration || minTimelineDuration` and `timelineDuration` are the same number), but the deps
array at `:127` grows by one entry, which changes `handleTrackClick`'s identity cadence. Nothing
memoises it; confirm that in the commit body.

**`handleGoToClip`'s dep fix changes a callback identity.** That is exactly why the decomposition
left it alone. Its one consumer is an unmemoised `onClick`, so no render count moves — but if
`ActionsSection` is ever memoised, this becomes load-bearing. Say so in the commit body.

**Moving the snap helpers must not move behaviour.** `getSnapPoints` seeds its `Set` with `0`,
`findNearestSnapPoint` uses strict `<` against the threshold (so a point exactly at the threshold
does *not* snap), and `wouldOverlap` treats touching edges as non-overlapping (`position < clipEnd &&
end > clip.timelinePosition`). Copy the bodies verbatim and prove it with `git diff -w`; a "tidy" of
any one of those three comparisons changes drag feel on every clip.

**The `exportPipeline` rename touches 17 files at once.** It is mechanical, but it is also the commit
most likely to hide a real change in the noise. Do it as its own hunk within Task 3 and confirm with
`git diff --stat` that every one of the 17 files shows exactly a one-line import change.

---

## Deferred to performance round 2 (measured, separate PR — not in this plan)

1. Clip-drag / trim / marquee effects tear down and re-add their `document` listeners on **every
   pointer frame**, because the state each move writes is in the effect's dependency array —
   `useClipDrag.ts:234`, `useTrimDrag.ts:139`, `useTimelineMarquee.ts:180`.
2. Per-mousemove forced layout: `querySelectorAll('[data-track-id]')` plus a
   `getBoundingClientRect()` per row, in both the clip drag (`useClipDrag.ts:177-183`) and the
   marquee mouseup (`useTimelineMarquee.ts:136-152`).
3. `getSnapPoints(clips, …)` rebuilds a `Set` and a sorted array on every drag frame
   (`useClipDrag.ts:163`).
4. `TimelineTrack`, `TrackHeader` and the ruler's tick list are not memoised, and
   `getTrackClips(track.id)` allocates a fresh array per row per render.
5. `setScaleLocked` depends on `[]` and calls `useEditorStore.getState()` three times instead of
   closing over the clip it has; and two separate subscriptions both find the selected clip
   (`useClipEditorActions.ts:99-115`). Merging either changes re-render frequency.
6. craft's unmemoised library handlers and `toggleSource`; the preview-attach effect's
   `[previewStream]` deps while it reads two refs; `handleStartRecording` depending on the whole
   `config` object.
