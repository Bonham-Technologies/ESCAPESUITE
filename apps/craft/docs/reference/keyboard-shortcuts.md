<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Keyboard Shortcuts

Bound by `src/hooks/useKeyboardShortcuts.ts` — the only window listener `App` itself binds; `VideoPlayer` binds its own while the playback dialog is open — and listed
for the user by `src/components/RecorderControls/RecorderControls.tsx`. None of them fire while
a dialog is open; see "Dialogs".

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
