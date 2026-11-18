<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Dialogs

All three modals — Recording Tips, playback and the delete confirmation — get their keyboard behaviour from one hook,
`useDialogBehaviour`, which lives in **`packages/shared/src/hooks`** and is imported as
`@escapesuite/shared/hooks`. ESCAPEARTIST's export dialog uses the same hook; it is the one
implementation for all three dialogs in the suite, and the place to change any of this.

It takes the `onClose` the dialog already has and returns the ref to put on the dialog
element; on mount it remembers what was focused, moves focus to the first focusable control
inside (or, if there is none, to the dialog itself, which is why both carry `tabIndex={-1}`),
and on unmount it puts focus back where it found it. Both CRAFT dialogs render only while
they are open, so they pass `onClose` and nothing else — the hook's second argument,
`isOpen`, defaults to `true` and exists for ARTIST's export dialog, which stays mounted and
returns `null` when closed. While it is open it holds one `keydown` listener on `document`
**in the capture phase**:

- **Escape** closes the dialog and is stopped there.
- **Tab / Shift+Tab** wrap at the ends of the dialog, and pull focus back in if it has strayed
  outside.
- **everything else passes straight through**, which is how the playback dialog's `VideoPlayer`
  keeps Space, M and the arrows — it binds its own `window` listener, and `window`'s bubble
  phase is below `document`'s capture phase.

The hook began as ESCAPEARTIST's `ExportDialog` focus trap, lifted rather than re-invented —
same focusable-element selector, same capture listener, same restore — then lived in CRAFT for
as long as CRAFT was the only app with two dialogs. It moved into `packages/shared` when
ARTIST adopted it, which is also what fixed the one way the two copies had diverged: CRAFT's
Shift+Tab arm treats focus parked on the dialog **container** as "at the start" and wraps to
the last control, where ARTIST's copy let it walk backwards out of an `aria-modal` dialog.
Its own tests moved with it (`packages/shared/src/hooks/useDialogBehaviour.test.tsx`).

Stopping Escape is not enough on its own, because R, P and S never reach the dialog at all.
`useKeyboardShortcuts` therefore takes **`modalOpen`** and ignores every key while it is true —
`App` computes it as `showHelpModal || playbackUrl !== null || confirmRequest !== null`. Before that gate, pressing R inside
the Help dialog put a screen-capture prompt up from behind it.

**No dialog in either app can reach a two-open state today**: each backdrop is
`position: fixed; inset: 0` at `z-index: 1000`, so a click aimed at the Help button while
playback is open lands on the playback backdrop and closes it instead, and the focus trap keeps
that button out of Tab's reach. But the hook no longer *assumes* one dialog at a time either
(ESCSUITE-208): two mounted at once each bind their own capture listener on `document`, and
`stopPropagation()` does nothing for a second listener on the same node — so one Escape used to
close both and fire two focus restores. A module-level stack of open dialogs now means only the
topmost instance's `onClose` actually runs; every instance still claims the key first (so the
app's own shortcuts behind it still see nothing), it is only *acting* on it that is now
exclusive to the top of the stack. `stopImmediatePropagation()` would have picked the *wrong*
one: capture listeners on one node fire in the order they were added, so the earliest-opened
(bottommost) dialog's listener runs first, and unconditionally stopping there would close the
dialog underneath instead of the one on top.

The focus trap itself also used to miss two things a real browser exposes that jsdom's test
doubles were hiding (ESCSUITE-208, hunt-i I-U2/I-U3): `getFocusable()` filtered on
`el.offsetParent !== null`, which a real browser also sets `null` for any `position: fixed`
control — dropping it from the trap entirely rather than treating it as merely hidden — so it
now reads `el.getClientRects().length > 0` instead, which means "is this actually rendered"
without caring what positioning scheme put it there. And the focusable-element selector only
named the control types the seven dialogs across both apps happen to use; it now also matches
`[contenteditable]`, `audio[controls]`, `video[controls]`, `iframe` and `summary`, so a rich-text
field or a native media player inside a future dialog can no longer walk Tab straight out of an
`aria-modal` dialog. Neither gap is reachable through either app's dialogs as shipped today —
none contains such a control — so both are hardening, pinned in
`packages/shared/src/hooks/useDialogBehaviour.test.tsx` and in
`apps/e2e/tests/accessibility/dialog-trap.spec.ts` (against this app's own Recording Tips
dialog, since CRAFT's modals are the simplest ones to inject a probe element into).

**What axe covers.** `apps/e2e/tests/accessibility/core.spec.ts` audits CRAFT in four states,
not one: idle, Help open, the playback dialog open over a real saved take, and a take in
progress. The last two need `mockSyntheticMedia` (the inert `mockGetUserMedia` stub has no
tracks, so a take never reaches `recording`). Adding the last two found a WCAG AA contrast
failure as well: `--error` as *text* on `--bg-secondary` is 4.22:1, which is what the live
"Recording" label, the running timer and the notice line were drawn in. They use
**`--error-text`** now; non-text uses of `--error` — the pulsing dot, the record button — keep
the brand red, since the rule does not apply to them.

`--error-text` has a value in **both** palettes — `#f87171` (5.7:1 on `#16213e`) for the dark
`:root` and `#b91c1c` (6.0:1 on `#f5f7fa`) for `:root[data-theme="light"]` — because a token
defined on `:root` alone is inherited by the light theme, where a red tuned for navy lands at
2.6:1. Two things stop that recurring: the take-in-progress axe run is executed **in both
themes** (`?theme=dark` / `?theme=light`, the shared theme module's own URL override), and
`src/themeTokens.test.ts` reads `index.css` and fails if any colour token in `:root` has no
counterpart in the light block. Add a colour to one palette and you are made to add it to the
other.

A second contrast failure (ESCSUITE-177) surfaced the same way, in Firefox only: the light
theme's `--text-muted` — an unavailable source row's label and the "no system audio" meter
label — was 3.74:1 on `--bg-secondary`, under AA. Chromium's run of the same test never
happened to mark the row that colour applies to as unavailable, so only a cross-browser sweep
caught it; the fix (`#606d80`, 4.90:1) and a numeric pin in `src/themeTokens.test.ts` are the
same shape as `--error-text`'s. The lesson generalises: a palette token can fail AA in one
theme only, and a single-theme or single-browser axe run can miss it either way.

`apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` proves the round trip in a real
browser: open Help from the keyboard, Tab six times without leaving it, Escape, focus back on
the Help button.

## The delete confirmation (ESCSUITE-483)

The library's Delete button used to delete at once — a take and every companion file of it, with
no question and no undo, from an icon next to "Open in Editor". It now asks first, in CRAFT's own
**`ConfirmDialog`** (`src/components/ConfirmDialog/`), not the browser's `confirm()`: in an iframe
sandboxed without `allow-modals`, `confirm()` answers false without showing anything, so an
embedded CRAFT's Delete would silently do nothing (ESCAPEARTIST's ESCSUITE-448 found that for its
own confirmations; this is the same shape, kept in CRAFT because the apps share no state).

- **Asking.** `utils/confirmAction.ts` holds the one question in a module-level slot:
  `confirmAction({ title, message, confirmLabel, returnFocus })` returns a promise of the answer,
  `answerConfirm` answers it, `useConfirmRequest` reads it. A second question replaces the first,
  which resolves false. `RecordingsListPanel` asks; `App` draws the dialog and reads the same slot
  for `modalOpen`, so **R, P, S and Escape are inert while it is up** — it can be up mid-take,
  since the library is not locked while recording.
- **Wording** (`utils/deleteConfirmation.ts`): the title names the row — `Delete "<name>"?` — and
  the message is "This can't be undone.", preceded, when the row is a take with companion parts,
  by how many files go and which: "This take is 3 files, and all of them will be deleted: the
  recording, the webcam track and the microphone track." `companionsOf` is the same
  `takeId === id && id !== id` test the cascade delete uses. A companion row deletes only itself
  and gets no count.
- **Answers.** Only the dialog's own Delete button is a yes. Cancel (which has the initial focus,
  so Enter straight away is a no), Escape and a click on the backdrop are all no, and a no deletes
  nothing and leaves an MP4/M4A conversion of that take running.
- **Focus** goes back to the row's Delete button on a no. The hook's own restore is not enough
  there: WebKit does not focus a button on click, so what was focused when the dialog opened can
  be the page body. The row hands its button over as `returnFocus`, and the dialog focuses it in an
  effect declared after the hook's, so its cleanup runs after the hook's restore.
- **Always mounted.** Unlike the other two dialogs, `ConfirmDialog` is rendered for the life of
  the app and draws nothing while no question is up, passing the hook its own `isOpen` as
  ARTIST's export dialog does. It answers no if the app unmounts with a question up, and an
  unmount effect on a dialog mounted per question answered every question at once in development:
  React's StrictMode mounts, unmounts and remounts each new component once.
- **After the answer, the panel re-reads.** The question can stay up for as long as the user
  likes, and meanwhile a take can be saved (the "Float controls" window is not behind the
  backdrop) or a conversion can finish. So the panel reads the list, the conversion in flight and
  `onDelete` (whose closure holds the list the cascade runs over) as they are *after* the yes,
  through a ref an effect keeps current: a take already gone is not deleted again, and a
  conversion of it is cancelled only then (ESCSUITE-103's rule, applied to a yes rather than a
  click).

Pinned by `ConfirmDialog.test.tsx` (StrictMode included), `deleteConfirmation.test.ts`,
`RecordingsListPanel.test.tsx`, `App.library.test.tsx` (Cancel, Escape and the inert R) and the
Playwright `apps/e2e/tests/regressions/ESCSUITE-483.spec.ts` (Cancel, Escape and Delete on a real
take, focus, storage after a reload, axe in both themes, in Chromium, Firefox and WebKit).
