# ARTIST dialogs II: the resolution-change confirm joins the modals; one project-load dialog

**Goal:** close ESCSUITE-64 and ESCSUITE-63 on one branch.

**Spec:** the two Jira tickets. This plan is the working authority.

## Global constraints

1. Branch `fix/artist-resolution-confirm-and-one-load-dialog`, one PR, changeset
   `@escapesuite/artist: patch` naming both.
2. Coverage floors artist 99/98/93/98 only go up; every new line and branch executes in a test.
3. Red-then-fix; record the failure. `App.rerender.test.tsx` must not change.
4. Docs in the same PR: `apps/artist/CLAUDE.md` keyboard/dialog section (the "fifth live modal"
   paragraph becomes adopted; the double-dialog sentence becomes fixed). Lint + typecheck clean
   (artist + e2e). Commit trailers as given in the dispatch. No push, no PR.

## Task 1 — ESCSUITE-64: the resolution-change confirm is a real modal

`components/ResolutionPicker.tsx` shows a full-screen `--z-modal` overlay (`showConfirm`,
`pendingResolution`) with an `<h3>` and Cancel/Confirm buttons when the project resolution is
changed with clips on the timeline; no role, no name, no trap, no Escape, not in `modalOpen`.

- Adopt `useDialogBehaviour(handleCancel, showConfirm)` exactly as the other four dialogs do:
  `ref` on `.confirmDialog`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title
  (give it an id), heading level consistent with the other dialogs (`<h2>` if that is what they
  use — check), initial focus, Tab trap, Escape = cancel (non-destructive: the picker's value is
  restored by `handleCancel` already — confirm), focus restored to the select.
- The flag must reach `App`'s `modalOpen`. `ResolutionPicker` is rendered by
  `app/MediaLibrarySidebar.tsx` with no props. Choose the smaller of: (a) a
  `onConfirmOpenChange?: (open: boolean) => void` prop threaded `App → MediaLibrarySidebar →
  ResolutionPicker`, App holding `resolutionConfirmOpen` state; (b) a boolean in the store's ui
  slice. Prefer (a) unless it forces a third hop; say which and why. `modalOpen` gains it.
- Tests, red first: the confirm has `role="dialog"` with an accessible name; opening moves focus
  inside; Escape cancels (resolution unchanged, select restored) and does not reach the global
  handler; with the confirm open, Space/Delete/Ctrl+Z do nothing (an App-level test the way the
  other four are pinned in `App.shortcuts.test.tsx` or its sibling); one axe e2e in
  `apps/e2e/tests/accessibility/core.spec.ts`'s ESCAPEARTIST describe, shaped like the three
  from #424, red on main for the missing role.

## Task 2 — ESCSUITE-63: one project-load dialog

`components/VideoUploader.tsx` keeps its own `showProjectLoadDialog` / `pendingProjectFile`
state and renders a second `ProjectLoadDialog` when a project file is dropped; `App`'s instance
(driven by `app/useProjectActions.ts`) is the one in `modalOpen`. With the uploader's open,
Ctrl+O is live and stacks App's on top: duplicate ids, two traps.

- One dialog. `useProjectActions` already owns "given a project file: if the timeline has clips,
  ask; else load" (`~lines 105-113`). Expose that entry (`handleProjectFile(file)` or whatever
  it is called) from `useProjectActions`, thread it `App → MediaLibrarySidebar → VideoUploader`
  as an `onProjectFile` prop, and delete the uploader's dialog, its two state hooks and its
  copies of the replace/merge handlers. The uploader's drop/pick path calls the prop. If the
  uploader's handlers differ from `useProjectActions`' in any way (merge semantics, error
  handling), list the differences in the report before unifying and keep the behaviour a user
  saw from the drop path unless it was simply wrong.
- Tests, red first: an App test drops a project file with clips on the timeline, presses Ctrl+O,
  and asserts exactly one `role="dialog"` named for project load; the existing `VideoUploader`
  tests that drove its own dialog move to assert the prop is called (say which changed and why);
  `useProjectActions`' tests for the exposed entry.
- Docs: `apps/artist/CLAUDE.md` — the double-dialog sentence becomes "one dialog, served from
  `useProjectActions`".

## Verification

`pnpm --filter @escapesuite/artist test:coverage` (floors), `lint`, `typecheck`; e2e lint +
typecheck; the accessibility spec on Chromium against dev servers from this worktree (check
`lsof -nP -iTCP:5174 -iTCP:5175 -sTCP:LISTEN` and `uptime` first).
