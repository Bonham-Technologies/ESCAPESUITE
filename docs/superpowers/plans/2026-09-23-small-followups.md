# Small follow-ups: hasAudio persisted, the duration tick off App, ARTIST's modal shortcut gate

**Goal:** close three small pinned items, two in ESCAPECRAFT on one branch and one in
ESCAPEARTIST on another.

**Spec:** Jira ESCSUITE-60 (Task A); the pinned follow-ups from the CRAFT quality pass
(Task B: "the once-a-second duration tick still renders craft App once"; Task C: "ARTIST has no
modal-open shortcut gate"). This plan is the working authority.

## Global constraints

1. Branch `fix/craft-hasaudio-and-tick` (Tasks A + B, changeset `@escapesuite/craft: patch`,
   one file naming both) and branch `fix/artist-modal-shortcut-gate` (Task C, changeset
   `@escapesuite/artist: patch`). One PR each.
2. Coverage floors only go up: craft 100/99/96/99, artist 99/98/93/98. Every new line and branch
   executes in a test; read the `test:coverage` summary.
3. Red-then-fix: the pinning test fails against the old code first; record the failure.
4. **Render contracts are behaviour.** `apps/craft/src/App.rerender.test.tsx` and
   `App.mp4rerender.test.tsx` pin exact render counts; every existing count must still hold, and
   Task B adds its own exact pin. `apps/artist/src/App.rerender.test.tsx` likewise for Task C.
5. Docs in the same PR: `apps/craft/CLAUDE.md` (the App selector contract paragraph; the module
   table for any new component), `apps/artist/CLAUDE.md` (keyboard shortcuts section). Lint +
   typecheck clean for the package. Commit trailers as given in the dispatch. No push, no PR.

## Task A — ESCSUITE-60: persist `hasAudio` so the M4A gate is truthful after a reload

`apps/craft/src/hooks/useRecordingLibrary.ts` `loadRecordings()` hard-codes `hasAudio: true`
for every stored recording (a standing TODO), so after a reload a screen-only take shows an
enabled M4A button that then fails, honestly, into the notice channel.

- `apps/craft/src/utils/recordingMetadata.ts` `buildSourceVideo` gains `hasAudio: boolean` in its
  input and writes it to the returned `SourceVideo` (`SourceVideo.hasAudio?` already exists in
  `packages/shared/src/types`). `useRecordingSave` passes
  `config.microphoneEnabled || config.systemAudioEnabled` — the same expression
  `buildRecordingEntry` already uses for the list entry, so the two records agree (if a stronger
  signal is cheaply available — the saved blob actually carrying an audio track — say so in the
  report, but do not add a decode to the save path).
- `loadRecordings()` maps `hasAudio: v.hasAudio ?? true` — recordings saved before this change
  keep today's behaviour; the TODO comment goes.
- Tests, red first: `recordingMetadata.test.ts` (built `SourceVideo` carries `hasAudio`, both
  values), `useRecordingSave.test.ts` (the stored metadata carries the config's answer),
  `useRecordingLibrary.test.ts` (a stored `hasAudio: false` loads as false; a record without
  the field loads as true).

## Task B — the duration tick and the countdown no longer re-render App

`apps/craft/src/App.tsx` selects `currentDuration` and `countdownValue`, so the controller's
once-a-second `setCurrentDuration` and the 3-2-1 countdown re-render App and everything it
draws, for a number that only `RecorderControls`' readout and `RecordingPreview`'s countdown
overlay show. The pattern to follow is `SourceTogglesPanel` (which subscribes to `audioLevels` so
`SourceToggles` stays props-only) and `RecordingsListPanel`.

- Two leaf components that subscribe themselves: `components/RecorderControls/
  RecordingDurationReadout.tsx` (renders `formatDuration(currentDuration)` where
  `RecorderControls` renders it today) and `components/RecordingPreview/CountdownOverlay.tsx`
  (renders the countdown number when `state === 'countdown' && countdownValue > 0`; `state` can
  stay a prop). `RecorderControls` and `RecordingPreview` drop the `currentDuration` /
  `countdownValue` props; App drops the two selectors. Keep the DOM and class names identical
  (their existing tests assert on them — update those tests only where a prop was removed, and
  say which).
- Red-first pin in `App.rerender.test.tsx`: after mount, five `setCurrentDuration` calls and
  three `setCountdown` calls re-render App **0** times, the readout leaf 5 times and the
  overlay leaf 3 times (exact, with the counting helpers the file already has); every existing
  pinned count unchanged. Against the old code App re-renders 8 times.
- Docs: `apps/craft/CLAUDE.md`'s App selector-contract paragraph gains the two fields; the
  module table gains the two leaves.

## Task C — ARTIST: global shortcuts stop while a modal is open

`apps/artist/src/app/useAppKeyboardShortcuts.ts` installs one `keydown` listener on `window` and
only skips inputs/textareas. With the Export dialog, the Keyboard Shortcuts panel or the
Session Restore prompt open, Space still toggles playback, Delete still deletes the selected
clip, Ctrl+Z still undoes — behind a modal the user cannot see. ESCAPECRAFT solved this in PR
#381: `useKeyboardShortcuts` takes `modalOpen: boolean` and returns early ("A modal is in
front; the app behind it is not taking keys"). Escape is already shielded by
`useDialogBehaviour`'s capture-phase `stopPropagation`, which is why only Escape works today.

- The hook gains `modalOpen: boolean` in its deps and returns early from the handler when it
  is true, before every other branch (inputs check can stay first). `App.tsx` passes
  `showExport || showShortcuts || <session-restore-prompt-open> || <loading-overlay-open>` —
  find the two state names (`useSessionRestore`'s prompt flag; whatever drives
  `LoadingOverlay`, which is `role="dialog"` too); if the loading overlay is not modal in
  practice (no focus trap), leave it out and say why.
- Tests, red first, in `useAppKeyboardShortcuts.test.ts` (if the hook has no test file, create
  one with the file's existing patterns from `App.*.test.tsx`): with `modalOpen: true`, Space,
  Delete, Ctrl+Z and the arrow keys change nothing and call nothing; with `false` they behave as
  today; toggling from true to false re-arms (the effect deps). An e2e in
  `apps/e2e/tests/escapeartist/` (find the export-dialog spec): open Export, press Space, the
  transport is still paused (Play button visible, not Pause) — one test.
- Docs: `apps/artist/CLAUDE.md` keyboard section — one paragraph naming the gate and that
  Escape is the dialog hook's, not the global handler's. Changeset artist patch.

## Verification

Per package: `test:coverage` (floors), `lint`, `typecheck`; craft's two rerender suites green;
Task C's e2e against dev servers started from its worktree (check `lsof -nP -iTCP:5174
-iTCP:5175 -sTCP:LISTEN` first).
