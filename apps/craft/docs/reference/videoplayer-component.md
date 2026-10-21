<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# VideoPlayer Component (`src/components/VideoPlayer/`)
Reusable video player with full playback controls:
- **Play/Pause**: the transport button, Space or K, or a click on the video itself
- **Seeking**: click or drag the progress bar; Left/Right skip ±5s; 0 or Home jumps to the
  start and End to the end. There is no Shift modifier
- **Volume**: a slider with a mute toggle (M); Up/Down move it in 0.1 steps. The slider carries
  `aria-label="Volume"` and stays mounted always — only its visibility (hover or
  `:focus-within` on `.volumeContainer`, in `VideoPlayer.module.css`) is conditional
  (ESCSUITE-176). Before this it mounted only on `onMouseEnter`, so it had no accessible name
  axe could ever see and a keyboard user tabbing through the controls could never reach it —
  opacity + `pointer-events`, not `display`/`visibility`, keep it in the accessibility tree and
  the tab order while invisible
- **Restart**: its own transport button — seek to 0 and play
- **At the end of the video** it resets to the beginning and stops. It does not loop
- **Duration**: `video.duration` is used when it is finite and above 0, and `knownDuration`
  is the fallback for when it is not — a MediaRecorder WebM often reports `Infinity` or 0.
  The playback dialog passes the saved recording's duration as that fallback
- **Audio-only takes (ESCSUITE-233)**: `VideoPlayer` takes an optional `mediaType`. For
  `'audio'` the one `<video>` element stays the playback engine (so the controls, the
  keyboard model and the Space/chord handling remain one implementation) but is visually
  hidden by `.videoAudio` (1px, transparent, no pointer events) and an `aria-hidden` speaker
  glyph is drawn over the same dark surface; a click on the wrapper still toggles playback.
  The glyph is the only one (ESCSUITE-319): the same 72px centred slot shows the play triangle
  while paused (`data-glyph="play"`) and the speaker while playing (`"speaker"`), and the
  separate `.playOverlay` is rendered for a video take only, so the two never stack. It stays
  `aria-hidden`; the controls' play/pause button carries the state for assistive tech
  `useRecordingLibrary` carries the row's `mediaType` as `playbackMediaType` (`'audio'` only
  for a row marked so; unmarked rows are video) through `App` to `PlaybackDialog`. The error
  overlay says "This recording could not be played." / "It may be corrupted or in an
  unsupported format." for both types, and `.controlsRow` has a `gap` so the time readout and
  the name no longer run together (CSS; jsdom cannot lay it out, so the test pins only that
  they are separate non-empty elements). The stored blob's `video/webm` MIME on an audio take
  is left alone — nothing misbehaves on it
- **Keyboard**: Space/K, Left/Right, Up/Down, M, 0/Home, End, Escape. It binds these on
  `window`; the shared `useDialogBehaviour` binds Escape and Tab on `document` in the capture
  phase, so while the playback dialog is open the dialog's Escape runs first and the player's
  does not
- **Browser chords pass through** (ESCSUITE-223): a keydown with Cmd, Ctrl or Alt held returns
  before the switch, so Cmd/Ctrl+0 (reset zoom) and Cmd/Alt+Left (history back) are no longer
  swallowed. Shift is left alone.
- **Space belongs to the focused control, not the player** (ESCSUITE-185). Space is how the
  platform presses whatever has focus, and the listener used to `preventDefault()` it for
  everything that was not an `<input>` or a `<textarea>` — so Space on the playback dialog's
  close button, which is *where focus starts* (`useDialogBehaviour`), toggled playback instead of
  closing the dialog. `preventDefault()` is the mechanism: it is what suppresses the click the
  browser synthesises on keyup. So a Space keydown is left alone when its target is something
  Space operates — `button`, `[role="button"]`, `a[href]`, `select`, or anything
  `isContentEditable` (one selector string plus the editable check, so it carries one branch
  rather than five) — and stays the player's own play/pause everywhere else: the dialog body, the
  video, the progress bar, and a keydown whose target is not an element at all. `input` and
  `textarea` are not in the selector: the older typing guard in front of it already returns for
  those on *every* key, so they can never reach this check. **Only Space is gated this way**: K,
  the arrows and M have no competing meaning on a button, so they stay the player's wherever
  focus sits
- **The progress-bar drag's two `document` listeners are removed on unmount, not only on their
  own mouseup** (ESCSUITE-176): a parent-driven close, a `?loadVideo` navigation or HMR can all
  skip the mouseup that used to be the only thing that removed them, leaving both listeners live
  for the rest of the tab — calling `seekTo` against a detached `<video>` and setting state on an
  unmounted component. `handleProgressMouseDown` now also stashes its own removal in a ref an
  unmount effect calls
