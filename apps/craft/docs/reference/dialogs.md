<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Dialogs

Both modals — Recording Tips and playback — get their keyboard behaviour from one hook,
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
`App` computes it as `showHelpModal || playbackUrl !== null`. Before that gate, pressing R inside
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
