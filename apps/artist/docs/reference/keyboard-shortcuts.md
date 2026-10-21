<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Keyboard shortcuts (ESCSUITE-247)

Two `window` listeners own the editor's keys: the cascade in `app/useAppKeyboardShortcuts.ts` and the
transport in `components/Preview/PlaybackControls.tsx` (Space, the arrows, Home, End). Three rules:

- **The typing guard exempts text entry only.** `isTextEntryTarget(target)` (exported from the hook's
  module and reused by `PlaybackControls`) is true for a `textarea`, a contenteditable element and an
  `input` whose `type` is text-like (`text`, `search`, `url`, `email`, `password`, `number`, `tel`).
  A range, checkbox, radio, colour, file or button input and a `select` no longer swallow the cascade,
  so Ctrl+Z works right after a slider, select or checkbox edit (a focused select
  therefore loses letter type-ahead to the tool keys). The transport additionally keeps
  ignoring every `input` and `select` for the arrows and Space: an arrow on a slider moves the slider.
- **Chords compare the letter case-insensitively** (`e.key.toLowerCase()`), because Caps Lock, and Shift
  on Windows/Linux, report `'Z'`. Shift stays a separate discriminator, so every chord except redo also refuses it
  (`!e.shiftKey`): Ctrl+Shift+C/V/D/S/O/E/B/M stay the browser's on every platform (on macOS Cmd+Shift+letter already
  arrived lower-case, so this also makes them inert there, consistently). redo is `z` + Shift, and
  `'M'` + Shift is its own shortcut (next marker) beside `m`, tested by `shiftKey` and not by the
  letter's case. The single-key shortcuts keep exactly the
  cases they accepted (`v`/`V`, `b`/`B`; `k`, `s`, `c`, `m`, `i`, `o` lowercase only) — widening them is a
  product change.
- **Space belongs to the focused control.** `PlaybackControls` leaves Space alone when the target
  matches `button, [role="button"], a[href]` (a select or contenteditable never gets that far: the typing guard returns first), so the browser's own click
  fires instead of a play/pause; it stays the transport's key on the canvas, the timeline and body. The
  twin of ESCAPECRAFT's `spaceBelongsToTarget` (ESCSUITE-185).
  A control the mouse focused does not keep Space (ESCSUITE-270): a button clicked with the mouse holds focus,
  and Space would press it a second time. `Preview/focusModality.ts` records the modality with three
  capture-phase listeners on `window` (`pointerdown` arms, `keydown` disarms, `focusin` consumes), installed by
  `PlaybackControls`; `:focus-visible` cannot be read because Chromium turns it on for the Space keystroke itself
  before any handler runs. ESCAPECRAFT's player is left as it is: three buttons, no toolbar, and its Space rule is
  ESCSUITE-185's own.

**The shortcut sheet may list only keys something binds.** `BOUND_SINGLE_KEYS` (the hook) and
`TRANSPORT_KEYS` (`Preview/transportKeys.ts`) are the key tables; `KeyboardShortcuts.test.tsx` fails
if a single-key row outside the Keyframe Graph group is in neither, and the hook's test proves every
`BOUND_SINGLE_KEYS` entry is claimed. The sheet once listed J/K/L playback keys and a loop toggle that
never existed. The same rule covers chords (ESCSUITE-269): `BOUND_CHORDS` (the hook) lists every
Ctrl/Cmd chord the cascade binds, redo's Shift spelling as its own entry; the sheet test fails on a
`Ctrl` row outside it and `FileMenu.test.tsx` fails on a menu hint outside it, and the hook's test proves
each entry is claimed. The sheet and the menu once showed `Ctrl+N` for New Project, which nothing bound and
which Chromium/Edge keep for a new window (a page cannot claim it), so both lost it; the menu item keeps its
label and shows no hint. Add a chord to the table when you bind one, and never one the browser reserves.
