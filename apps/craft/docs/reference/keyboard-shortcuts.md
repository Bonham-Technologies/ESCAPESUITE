<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Keyboard Shortcuts

Bound by `src/hooks/useKeyboardShortcuts.ts` — the only window listener `App` itself binds; `VideoPlayer` binds its own while the playback dialog is open — and listed
for the user by `src/components/RecorderControls/RecorderControls.tsx`. None of them fire while
a dialog is open; see "Dialogs". While the "Float controls" window is open the same listener is
bound on that window too (see below).

Every one of them is gated on the state the app is in, so a key that has nothing to do is
inert rather than wrong — there is no "else" branch anywhere in the switch. Two gates are
worth naming: **R also checks `canRecord`**, the same `recordBlockedReason()` answer that
disables the Record button, so the keyboard can never start a take the button refuses; and
**Escape does nothing at all in `idle` or in `'saving'`** — in `idle` there is no take to cancel,
and in `'saving'` the take has already stopped with only the write to storage left, so there is
nothing a cancel could call off. Like every other gate in the switch it is written as an **allow-list**
(`'preparing' || 'recording' || 'paused'`) rather than an exclusion, so a state added later is inert
rather than cancellable by default. Escape there used to run `handleCancelRecording()` anyway
(ESCSUITE-174): the store went back to `'idle'`, the duration was reset, the streams were stopped
and the sidebar unlocked **mid-write** — the window `sidebarLocked` exists to keep (ESCSUITE-104) —
while the save, which deliberately does not read `cancelledRef`, carried on behind an idle-looking
app. Record was live again too, and that is how a finished save's own `setState('idle')` came to
land on the take started after it: see "The save's completion carries the same identity" under
"Recorder lifecycle" for the other half of that fix, which holds whatever cancels the first take.
Refusing to claim an action it cannot perform is the same posture the Record button takes in
`'preparing'`/`'saving'` (ESCSUITE-106). `'preparing'` stays cancellable: the capture request is
still outstanding there, and the attempt token is what makes the cancel stick (ESCSUITE-93/109).
The trade-off, named rather than hidden: `'saving'` has no user-reachable exit at all, so the save
promise settling is the only way out — which is why the one thing on that path that could never
settle, the thumbnail probe, now has a deadline of its own (`THUMBNAIL_TIMEOUT_MS`,
ESCSUITE-180). See the end of "The save's completion carries the same identity" under "Recorder
lifecycle".

| Key | Action | Fires in |
|-----|--------|----------|
| R | Start recording | `idle`, and only when `canRecord` |
| P | Pause / Resume | `recording` / `paused` |
| S | Stop recording | `recording`, `paused` |
| Esc | Cancel the countdown, else cancel the take | `countdown`; `preparing`, `recording`, `paused` — never `idle` or `saving` |

A keydown with Cmd, Ctrl or Alt held, or with `e.repeat` set, returns before the switch
(ESCSUITE-222): Cmd/Ctrl+S used to stop a live take, +P pause it and +R start one as the page
reloaded, and a held key repeated its action. Shift is left alone.

Typing is never interrupted either: a keydown whose target is an `<input>` or `<textarea>`
returns before the switch.

The record button agrees with this table, not just with R: during `countdown` the big button is
itself wired to cancel (see "The record button only offers what it can deliver" — ESCSUITE-106),
so a click there and an Esc press do the same thing, and S stays inert through the countdown as
this table already says.

## Float controls (ESCSUITE-400)

"Float controls", at the end of the shortcut legend, opens a Document Picture-in-Picture window
(`documentPictureInPicture.requestWindow({ width: 360, height: 160 })`) that stays on top of
whatever is being recorded. It holds the page's own `TransportBar` (timer, Pause/Resume, the
record/stop button, Cancel), wired to the same `useRecordingController` handlers, and the Mic /
System meters (`AudioLevelMeters`) while a take is live. `App` portals `FloatingControls` into the
window's document, so it is the same React tree and the same store; `useFloatingControlsWindow`
owns the window.

- **Only where it can work.** The button is drawn only when `window.documentPictureInPicture`
  exists and CRAFT is the top-level document (`canFloatControls()`; `requestWindow()` throws in
  an iframe, and CRAFT can be embedded). Chromium has it; Safari does not. It is a toggle:
  `aria-pressed` while the window is open, and a second press closes it.
- **The window's document** gets clones of every `<style>` and stylesheet `<link>` in the page,
  in order, the page's `lang`, the title "ESCAPECRAFT controls", and the page's `data-theme`,
  kept in step by a `MutationObserver` while the window is open. Nothing is fetched: the
  single-file build's styles are inline, which is why the offline file floats its controls from
  `file://` too. Its content is one `<main>` named by a visually hidden `<h1>`.
- **It speaks for itself (ESCSUITE-440).** The page is usually behind whatever is being
  recorded, so during the countdown the window's timer shows the 3-2-1 digit
  (`TransportBar`'s `showCountdown`, drawn by `CountdownReadout`); the window has its own
  visually hidden polite, atomic live region saying "Recording starts in N", "Recording",
  "Paused", "Saving..." and, once a save puts a new take at the top of the library, "Saved"; and
  a blocked Record button's reason is printed under the bar as its `aria-describedby` target,
  as on the page. It all still fits 360x160.
- **Keys.** R / P / S / Esc pressed in the window reach the same handler with the same gates
  (`useKeyboardShortcuts`' `floatingWindow`).
- **Closing it** (its own close button, the page's toggle) ends only the window: the take keeps
  recording, the page takes focus back (`window.focus()` on the window's `pagehide`) and its own
  controls already show the live state. The window also closes when `App` unmounts, and a window
  that finishes opening after that is closed on arrival. A refused request (no user activation)
  is a `console.warn` and nothing else.
- **Out of scope:** a webcam preview in the window.

Tests: `App.floatingControls.test.tsx` and `useFloatingControlsWindow.test.ts` (unit, through
`src/test/doubles/documentPictureInPicture.ts`), and `apps/e2e/tests/escapecraft/float-controls.spec.ts`
plus two cases in `tests/standalone/craft.spec.ts` (served and `file://`) in real Chromium; the
countdown, live region and blocked reason in `FloatingControls.test.tsx` and
`apps/e2e/tests/regressions/ESCSUITE-440.spec.ts`.
