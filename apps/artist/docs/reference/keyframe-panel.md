<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Keyframe Panel (`src/components/KeyframePanel/`)
- **KeyframePanel.tsx**: Main editor with property list, graph view, and keyframe timeline
- **ClipPreview.tsx**: Playback scrubber controls (uses main PreviewPlayer for rendering)
- **KeyframeGraph.tsx**: Visual keyframe editor with Bezier curve display
- **Per-keyframe easing**: select a keyframe in the graph and its easing `<select>` appears below it
  (`EASING_TYPES` from `src/utils/easingOptions.ts`, shared with the animate-in/out presets); new
  keyframes default to `ease-in-out` and a value drag preserves the stored easing; an add aimed at
  a time that already holds a keyframe selects that one and leaves its easing alone (ESCSUITE-248,
  below)
- When keyframe panel is open, manipulating overlays in the main preview creates keyframes instead of direct updates
- **The panel works from the keyboard (ESCSUITE-243).** Each property row (`KeyframeTrack.tsx`) was a
  `<div onClick>`, so the graph's own keyboard model was reachable only by a mouse. The row stays a
  container `<div>` — one `onClick` serves a click anywhere in it — and only its **label cell** is a
  real `<button type="button">` (visible text is the name, no `aria-label`) carrying `aria-pressed`
  for the open row, the roving `tabIndex` and `data-property`. Never put the diamond track inside the
  button: a button admits no interactive content, every diamond click and double-click would also
  activate it, and assistive technology would lose the diamonds and the value readout. `aria-pressed`,
  not `aria-expanded`, because the graph is a block above all the rows, not the row's own region.
  Enter and Space are the native button's; no key handler of ours, and one activation calls
  `onSelect` once. The rows sit in one `role="group"` named "Animated properties" (the audio header and
  the Volume row included) with a **roving tab stop derived from the open row** — 0 on it, or on the
  first row when no graph is open, -1 elsewhere — so there is no state and no extra render. (A stored
  selection naming a property the clip has no row for draws no graph at all since ESCSUITE-248, so
  it cannot hold the stop either.) ArrowUp/ArrowDown wrap, Home/End jump, through `app/menuNavigation.ts`'s
  `nextMenuIndex`; a ⌘/Ctrl/Alt chord is left to the browser. **Keyboard** activation of a row opens
  its graph and focuses it (`onSelect(event.detail === 0)`, `focusGraphOnOpenRef`, consumed once by an
  effect on `selectedProperty` after the graph has mounted); a mouse click opens it and leaves focus
  alone, because a focused graph owns ArrowLeft/Right/Home/End and Enter and would take them from the
  playhead, and a graph open at mount or opened through the store does not take focus either. Escape
  inside the graph region hands focus back to the rows' tab stop (the open row); the graph claims and
  stops the Escape that clears its active keyframe, so with one active the first Escape spends itself
  there and the second returns focus, and the region stops the key so the editor's deselect-the-clip
  Escape never sees it. The panel's close button is "Close keyframe panel", the graph header's is
  "Close keyframe graph", and `ClipPreview`'s play button is "Play clip preview" / "Pause clip preview".
  Pinned in a browser by the axe case in `apps/e2e/tests/accessibility/keyboard-navigation.spec.ts`.
- **The diamond row drag cannot be dragged into an occupied neighbour's window at all, and does
  not even aim for one (ESCSUITE-167 / M6, reworked by ESCSUITE-183)**. `KeyframeTrack.tsx`'s
  diamonds are dragged through `hooks/useKeyframeDrag.ts`, which used to `findSnapTime` onto the
  playhead **and onto every other keyframe's time**, regardless of whether one was already there —
  and `moveClipKeyframe` deletes whatever already sits within `KEYFRAME_TIME_EPSILON` of the
  target, so a drag that snapped onto a neighbour, or onto the playhead where one sat, silently
  destroyed it. The exact case `useKeyframeGraphKeyboard.ts`'s `nudgeTime` already refused on
  purpose for the keyboard. Other keyframes' times are no longer snap candidates at all, and the
  playhead stays one only when it is a legal time itself — asked of the same windows the clamp
  uses, so the snap cannot undo the clamp that just ran. `handleMouseMove` clamps `currentTime`
  away from every neighbour's forbidden window on every move, before that snap check runs, rather
  than letting the diamond follow the pointer into the zone and refusing the drop on release:
  ESCSUITE-88 ruled against exactly that shape for a locked track's own drag, and this is the
  identical "follows the pointer, then snaps back" bug for a different reason.

  **The landing is always legal, or the move is ignored** — there is no release-time backstop any
  more. The arithmetic lives in `utils/keyframeClamp.ts`, called by this drag and by the graph's
  own point drag, so the decision cannot be right in one and wrong in the other (it was
  duplicated byte-for-byte in both and had to be fixed twice; review of ESCSUITE-183, finding 3).
  `occupiedWindows` brackets each occupied time with `± (KEYFRAME_TIME_EPSILON + CLAMP_MARGIN)`
  and `clampToLegalTime` answers where one pointer position lands. Three things that decides are
  worth naming:
  - **The side is the side the pointer came from**, not which side of the neighbour the raw time
    fell on: a drag from the left that lands bit-exactly on its neighbour stops **short** of it
    rather than being thrown past it and swapping the two keyframes' order. The gesture's previous
    position is what says which way it is travelling. A pointer that jumps clean **over** a
    neighbour in one move is not clamped at all — crossing one is a legitimate reorder, and only
    the window itself is forbidden.
  - **At the clip's own bounds the other edge wins.** A neighbour at `clipDuration` — which every
    clip with Animate Out = fade has, `generateOutPresetKeyframes` putting an opacity handle at
    exactly `clipDuration` — pushes the point **left**, just inside the clip, rather than past the
    end. (Choosing the side first and clamping to the bounds afterwards put it straight back onto
    the neighbour, which is how the first version of this fix reopened the whole bug in its
    commonest configuration.)
  - **Two keyframes closer than twice the epsilon are one window**, because nothing can legally
    land between them, and a pointer aimed into the gap comes back out the side it went in by.
    When such a merged window covers the whole clip there is **no legal time at all**, and the
    move is ignored outright: the diamond stays where it is, nothing is written, nothing is said.
    In the graph this applies to a value-axis (Shift) drag too — the clamp runs before the value
    write — so on such a clip the value cannot be dragged either. A clip under about two
    milliseconds with a clustered neighbour is the only way to reach it, and it fails closed;
    accepted limit (re-review of ESCSUITE-183).
  - **The occupied list is the gesture's own snapshot**, taken on `startDrag`. A keyframe added or
    removed by some other path mid-gesture — an undo from the keyboard, a preset toggled — is not
    seen until the next gesture. Accepted limit (review of ESCSUITE-183, finding 6): it is what
    makes every reader of the list provably agree, and nothing but another input device can change
    the keyframes while a drag is live.

  A small margin (`CLAMP_MARGIN`, `1e-9`, private to `utils/keyframeClamp.ts`) sits on top of the
  epsilon in the window's own edges: `occupiedTime ± KEYFRAME_TIME_EPSILON` lands exactly on the
  edge in exact arithmetic, but floating point does not always agree (e.g.
  `Math.abs(3 - (3 + 0.001))` comes back `0.0009999999999998899`, which IS less than `0.001`), so
  without it a landing the clamp meant to allow can still read as occupied to anything asking the
  strict `< KEYFRAME_TIME_EPSILON` question — `moveClipKeyframe` itself among them. The windows
  are built once, on `startDrag`, rather than recomputed (and reallocated) on every pointer move
  (review round 1, MINOR 2), and the listener pair is likewise bound once per gesture rather than
  rebuilt per move — the same fix the five timeline gesture hooks already had — all pinned exactly
  by `KeyframePanel/keyframeGestures.perf.test.ts` (2 listener adds / 2 removes, one `.filter()`
  per gesture, and since ESCSUITE-183 one `occupiedWindows` build per gesture for the graph's drag
  as well; `clampToLegalTime` itself allocates nothing per move).

  The hook has no live region of its own, and since ESCSUITE-183 nothing to put in one: it reports
  `''` to its `onAnnounce` callback once a drop lands, and that is all it can ever say, because a
  mouse drag has no illegal landing left to refuse. `KeyframePanel` still owns the one
  `role="status"` every property row shares — only one diamond on one row can ever be dragging at
  a time, so eight per-row regions would carry a message only one of them could ever produce
  (review round 1, MINOR 6) — and the setter now goes straight to the row, the alternating
  zero-width mark having nothing left to help a screen reader re-read. The occupied-time refusal
  itself survives where it is still reachable: `nudgeTime`, for a keyboard that has no pointer
  position to clamp, through the graph's own region and `announceWithMark` (which lives beside the
  `nudgeTime` that raises it, and is exported again since ESCSUITE-248 for the panel's
  "Keyframe at 1.20 s selected", which a user can repeat word for word).

  The graph's own point drag makes the identical clamp, through the identical helper — see "The
  graph's own point drag cannot be dragged into an occupied neighbour's window either"
  (ESCSUITE-179 / 183) below.
- **A track's double-click adds at the curve's value, not the clip's static default
  (ESCSUITE-167 / m3)**. `KeyframeTrack.tsx`'s double-click used to call `onAddKeyframe` with no
  value, which fell back to `clip.transform[property]` (or `effects.blur` / `1` for volume) —
  jumping the shape visibly if a keyframe already held a different value at that time. It now
  passes `interpolateKeyframes(keyframes, time, defaultValue)`, the same value it already computes
  for its own readout, matching `KeyframeGraph.tsx`'s two add paths
  (`handleDoubleClick`'s clicked Y, `useKeyframeGraphKeyboard.ts`'s `addAtPlayhead`), which have
  always passed a value. `KeyframePanel.handleAddKeyframe`'s `value` parameter is required now:
  nothing calls it without one, so the clip-default fallback was deleted rather than kept
  unreachable.
- **Adding where a keyframe already is selects it (ESCSUITE-248 / M-15)**. All three add paths —
  the graph's Enter ("Add Keyframe at Playhead", `addAtPlayhead`), the graph's double-click and a
  row's double-click — land in `KeyframePanel.handleAddKeyframe`, which wrote
  `easing: 'ease-in-out'` unconditionally: aimed at a time that already held a keyframe,
  `setClipKeyframe` replaced it, so the add silently reset that keyframe's easing and spent an undo
  step on what was otherwise no change, while the graph announced "Opacity 50% at 1.00 seconds" as
  if a keyframe had been added. Now a time within `KEYFRAME_TIME_EPSILON` of one of the property's
  **stored** keyframes (`animation.keyframes[property]`, the ones `setClipKeyframe` would replace, at
  the tolerance it replaces at) is not written: the panel asks the graph to select that keyframe,
  announces "Keyframe at 1.20 s selected" (the keyframe's own time, two decimals) through its one
  live region with `announceWithMark` — so Enter twice on one keyframe is heard twice — and
  answers `false`. No store write, no history entry. The selection is the graph's own state, so the
  panel **asks** rather than sets it: `KeyframeGraph`'s `selectRequest` prop, a new `{ time }` object
  per request, applied once by an effect (the same two writes a click on the keyframe makes) and
  handed back through `onSelectRequestHandled` so a later remount of the graph does not apply it
  again. From a row whose graph is not the one showing, the panel opens that row's graph first, in
  the same update, so the request lands on the graph that mounts. `onAddKeyframe` is typed
  `=> boolean | void` on the graph and the keyboard hook: `false` means "nothing was written", and
  `addAtPlayhead` then neither moves the active option to the playhead nor announces an add in the
  graph's own region; any other answer (a host that returns nothing included) is an add, as before.
  A **preset** handle's time (Animate In/Out, never stored as a keyframe) is not "held" in this
  sense — there is nothing stored to select — and is refused instead (ESCSUITE-282, next).
- **An add at an Animate In/Out handle's time is refused (ESCSUITE-282)**. ESCSUITE-248's
  "occupied" counted stored keyframes only, and a preset handle is generated, so an add there
  wrote a custom `ease-in-out` keyframe that won `getAnimatedValues`' merge over the handle: the
  preset's easing changed, and because the custom keyframe is not generated it survived
  `PRESET_SUPPRESSION` during a transition — an incoming clip with a fade-in rendered invisible at
  its start again, the bug ESCSUITE-139 fixed, back through one Enter. `handleAddKeyframe` — which
  all three add paths reach, the graph's Enter (`addAtPlayhead`) and both double-clicks — now
  checks, after the stored-keyframe check above (so a keyframe stored at a handle's time still
  selects), whether `time` is within `KEYFRAME_TIME_EPSILON` of any of the property's preset
  handles, asked of `utils/animation.ts`'s `presetHandleTimes(property, clipDuration, animation,
  transform, effects)`. That helper runs the same generators the merge does
  (`presetKeyframesForProperty`, which `getAllKeyframesForProperty` now shares), so the panel reads
  the handle times from the same generators the merge does, a `pop` preset's middle handle included
  (`getAnimatedValues` still carries its own inline copy of that merge, so the two agree by
  construction of the generators, not by sharing one merge).
  A refused add writes nothing, pushes no history entry, selects and opens nothing, answers
  `false` (so `addAtPlayhead` neither moves the active option nor announces an add), and the
  panel's one live region says "That time belongs to the Animate In/Out preset" through
  `announceWithMark`, so a second Enter is re-read. A time just outside the epsilon adds as before.
  To key a value at a handle's time, change the preset instead (or set it to None and keyframe by
  hand). `setClipKeyframe`'s first-write seed (ESCSUITE-166) obeys the same rule (ESCSUITE-286): when
  `presetHandleTimes` for the property holds a time within `KEYFRAME_TIME_EPSILON` of 0 — an
  Animate In fade's opacity 0, say — no time-0 seed is stored, so the first custom keyframe added
  at 2 s no longer erases the fade-in; a clip with no preset, an Animate Out only, or an in-preset
  on a different property still seeds as before.
- **An audio-only clip is offered Volume alone (ESCSUITE-248 / M-19)**. The property list rendered
  Position, Scale, Rotation, Opacity and Blur for every clip, so a voice-over could be keyframed to
  move or fade, to no visible effect (the inspector already hides Transform for audio). The panel
  derives the clip's `sourceMedia` once; `clipHasAudio` gates the audio section as before
  (`mediaType === 'audio' || hasAudio`), and its mirror `clipHasPicture` (`mediaType !== 'audio'`;
  a clip with no source media is an overlay and keeps the picture rows) gates the picture rows. The
  rows a clip is offered (`rowProperties`) are the union, never empty. The stored
  `keyframePanelState.selectedProperty` is the panel's, not the clip's, so it survives a change of
  selection; a property the newly selected clip has **no row for** draws no graph (`openProperty`
  is `null`) — a picture graph left open when the selection moves to an audio-only clip, and,
  by the same derivation, a Volume graph left open on a clip with no sound, which ESCSUITE-243 used
  to keep drawing. Nothing is written: selecting a clip that has the row shows the graph again.
- **The playhead follows the timeline, not a local scrub state (ESCSUITE-126)**. `KeyframePanel.tsx`
  used to keep a `previewTime` local override, set only by `handlePreviewTimeChange` (the callback
  `ClipPreview`'s scrubber and Play button both call) and never reset back to `null` by anything —
  so one scrub or Play press latched the panel's playhead at that offset for good: `playheadTime`
  kept returning the stale `previewTime` instead of tracking `currentTime`, the graph's playhead
  line and the scrubber both froze, and `Enter` (`useKeyframeGraphKeyboard.ts`'s `addAtPlayhead`)
  added a keyframe at the stale offset instead of where the timeline actually was. The override was
  also never scoped to a clip, so it survived a clip switch too. There was nothing for an override
  to add: `handlePreviewTimeChange` already calls `seekTo` (`setCurrentTime` before ESCSUITE-287) synchronously, so the store's
  `currentTime` *is* the preview the instant a scrub happens — `playheadTime` is now derived from it
  alone, the same way `clipRelativeTime` beside it already was (reporting 0 rather than clamping to
  an edge when the playhead sits outside the clip, the one difference between the two derivations).
- **KeyframeGraph.tsx keyboard map** — the `<svg>` is one focusable
  `role="listbox"` (`tabIndex={0}`, `aria-activedescendant`) rather than one `tabIndex` per
  keyframe: a single tab stop matches the APG listbox pattern, and `tabindex` on SVG *child*
  elements has a shakier cross-browser/AT story (Safari especially) than a focusable root with
  `aria-activedescendant`. Every keyframe — presets included — is a `role="option"` `<circle>`
  so the whole curve is walkable and perceivable by a screen-reader user; a preset is visitable
  but never selectable or editable, and is announced with a trailing "preset, not editable". The
  grid, curve `<path>`, playhead line and help `<text>` are all `aria-hidden="true"` so axe's
  `aria-required-children` rule accepts the listbox's non-option children. The hook implementing
  all of this, `useKeyframeGraphKeyboard` (`hooks/useKeyframeGraphKeyboard.ts`), lives beside the
  panel rather than inside the component so the graph's own render stays about drawing.

  | Keys | Action | Step / unit |
  |---|---|---|
  | `Tab` | into the graph, then on to the easing select when one is shown | — |
  | `ArrowLeft` / `ArrowRight` | previous / next keyframe in time; selection follows the active option; clamps at the ends (no wrap) | — |
  | `Home` / `End` | first / last keyframe | — |
  | `ArrowUp` / `ArrowDown` | nudge the selected keyframe's **value** | fine step (table below) |
  | `Shift+ArrowUp` / `Shift+ArrowDown` | nudge value, coarse | coarse step |
  | `Alt+ArrowLeft` / `Alt+ArrowRight` | nudge the selected keyframe's **time** | ∓ 0.01 s |
  | `Alt+Shift+ArrowLeft` / `Alt+Shift+ArrowRight` | nudge time, coarse | ∓ 0.1 s |
  | `Enter` | add a keyframe at the playhead, clamped to the clip, at the curve's value *there* | — |
  | `Delete` / `Backspace` | delete the selected keyframe (custom only) | — |
  | `Escape` | clear the active keyframe and the selection; passes through when nothing is active | — |

  `NUDGE_STEPS` (`useKeyframeGraphKeyboard.ts`), each property's own unit:

  | Property | fine | coarse | unit |
  |---|---|---|---|
  | `x`, `y` | 0.01 | 0.1 | fraction of canvas (1% / 10%) |
  | `scaleX`, `scaleY` | 0.01 | 0.1 | scale factor |
  | `rotation` | 1 | 15 | degrees |
  | `opacity` | 0.01 | 0.1 | 0–1 (1% / 10%) |
  | `blur` | 1 | 5 | px |
  | `volume` | 0.01 | 0.1 | 0–1 (1% / 10%) |

  `TIME_NUDGE` is `{ fine: 0.01, coarse: 0.1 }` seconds for every property: 0.01 s is ten times
  the graph's own 0.001 s "same keyframe" tolerance, so a fine nudge can never silently land on a
  neighbour, and 0.1 s is a tenth of the graph's one-second gridlines. A nudge that *would* land
  within 0.001 s of another keyframe (presets included) is refused rather than merging the two —
  nothing moves, and the live region announces why. A nudge the clamp puts back on the value or
  the time the keyframe already holds writes nothing either — no store call, so no undo entry
  that undoes nothing, and no announcement, since nothing changed — though the key is still
  swallowed. A **held** arrow key is one undo step, not one per key-repeat: the hook passes each
  keydown's own `repeat` flag to the panel, which passes it to `setClipKeyframe` /
  `moveClipKeyframe` as their trailing `skipHistory` — so the first press pushes the snapshot
  taken before the run, every auto-repeat edits in place, and releasing and pressing again starts
  a new step. It is the same `skipHistory` mechanism `updateClipTransform` uses to keep a preview
  drag to one entry. Separate presses are still separate steps, which matches the inspector's
  numeric controls.

  **Propagation contract**: while the graph has focus it owns `ArrowLeft`/`Right`/`Up`/`Down`,
  `Home`, `End` and `Enter` unconditionally, and claims `Delete`/`Backspace`/`Escape` only when a
  keyframe is *active* (custom or preset) — swallowing them even for a preset so an active-but-
  uneditable selection can't fall through and delete the whole clip. With nothing active, Delete
  is not claimed and reaches the editor's global shortcuts as before. Everything else (`Tab`,
  `Space`, `?`, letters) falls through untouched. The shield is React's synthetic
  `stopPropagation()` on the root-container listener, which runs before the two `window`-level
  cascades (`useAppKeyboardShortcuts` and `Preview/PlaybackControls.tsx`) ever see the native
  event. Fixes a bug (ESCSUITE-49) where Delete with a keyframe selected deleted both the
  keyframe *and* the selected clip, because the graph's old listener was itself on `window`
  alongside the editor's.

  **The graph is not covered by the editor's modal gate** (see "Dialogs" below) and does not
  need to be — but it took *two* fixes to earn that, not one, and only the second closed it.
  Those two `window` cascades stop while a dialog is up; this element-level handler does not. The
  focus trap every modal now has closes the **Tab** route in. It cannot close the **pointer**
  route, because that is a question of stacking, not focus: the keyframe panel is a
  `createPortal` sibling of `#root` (which creates no stacking context), and it carried a bare
  `z-index: 1000` against every modal's `--z-modal` (200) — so it painted *over* the dialog's
  backdrop, `elementFromPoint` at the graph returned the listbox, and a click there focused the
  graph and let Enter add a keyframe from behind an `aria-modal` dialog. `KeyframePanel.module.css`
  now uses **`--z-panel` (150)**, below the modals and above the timeline and dropdowns. Both
  routes are closed, and still no gate here.

  **What counts as active**: every key that acts on "the active keyframe" — `Delete`,
  `Backspace`, `Escape` — is gated on the *rendered* active option (`activeIndex !== -1`), not on
  the remembered active time, so the keyboard can never disagree with what the graph draws; an
  edit from outside the graph (an undo, a right-click delete) can leave that time pointing at a
  keyframe that is gone, and a stale active time is treated as nothing active, falling the key
  through to the editor's cascade — including to its "delete the selected clip" shortcut, and
  leaving the stale time in state until the next click or arrow key replaces it. The selection is
  the other half of the same rule: it follows the active option and never rests on a preset, in
  `activateIndex` and in the pointer's `handleKeyframeClick` alike, so clicking a preset after a
  custom keyframe clears the selection rather than leaving `Delete` and the value nudges pointed
  at a keyframe that is not the active option. `KeyframePanel` also gives `<KeyframeGraph>` a
  ``key={`${selectedClip.id}:${selectedProperty}`}``, so choosing another property — or another
  clip — mounts a fresh graph and the active option and selection cannot bleed across two
  properties, or two clips, that happen to hold a keyframe at the same time.

  **Re-announcing an identical edit**: the graph's live region is `aria-atomic`, and an atomic
  region whose text does not change is not re-read — two identical edits in a row (the same nudge
  repeated, the same add) would be announced once. Every announcement therefore goes through the
  hook's `announce()`, which appends a zero-width space (`ANNOUNCE_MARK`, `\u200B`) to alternate
  announcements — the previous message's own last character decides — so consecutive identical
  messages differ as strings while reading out the same and looking the same. The suffix is
  applied in `announce` rather than on the way out because the graph re-renders every animation
  frame while the clip preview plays. Tests that compare the live region's text exactly strip
  `\u200B` first.

  **Known limitation**: `useDialogBehaviour` listens on `document` in the capture phase, which
  runs *before* the graph's handler and so can't be shielded by its `stopPropagation()`. This is
  moot in practice — the graph can neither be Tabbed to (the trap) nor clicked (`--z-panel` sits
  under `--z-modal`) while any of the five modals that use the hook is open. See "Dialogs" below.

  **A locked track in the keyframe panel** (ESCSUITE-88). The store has refused every keyframe
  edit to a clip on a locked row since ESCSUITE-84; the panel used to let the user try and say
  nothing. `KeyframePanel` derives `trackLocked` with `store/trackLock.ts`'s `clipOnLockedTrack`
  beside `selectedClip` — from the **whole-store read it already does**, so this adds no
  subscription and deliberately uses no selector — and threads one `locked: boolean` down to
  `KeyframeTrack`, `KeyframeGraph` and `useKeyframeGraphKeyboard`. The rule is **refuse at the
  gesture's start, keep every read**: a plain `<p>` under the title bar (not a status region — it
  is a standing fact about the selected clip, the same shape as `ClipEditorHeader`'s) reading
  "Track locked — unlock it in the timeline to edit keyframes"; a diamond and a graph point refuse
  at *mousedown*, because a drag that started would follow the pointer and snap back, which reads
  as a bug; the double-click add on a track row and on the graph, and the right-click delete,
  return early (the right-click still `preventDefault`s, so no browser menu appears over a
  keyframe either way); the easing `<select>` is `disabled`. Clicking a row to open its graph,
  clicking a point to select it, hovering, scrubbing the clip preview and reading the easing value
  all still work. The keyboard keeps the whole propagation contract above — **which** keys are
  claimed does not change, only what the claimed ones do: walking (the bare arrows, `Home`,
  `End`), the selection that follows the active option, and `Escape` behave exactly as always,
  while the five editing keys (`ArrowUp`/`ArrowDown`, `Alt+ArrowLeft`/`Alt+ArrowRight`, `Enter`,
  `Delete`/`Backspace`) are still swallowed but call nothing and announce **"Track is locked"** —
  the same words `useAppKeyboardShortcuts` toasts, so the lock sounds the same wherever the user
  meets it. `Delete` also closed a gap ESCSUITE-87 left: `removeClipKeyframe` joined that ticket's
  `=> boolean` contract, `KeyframePanel`'s `handleDeleteKeyframe` hands its answer back through
  `onDeleteKeyframe`, and the hook only announces "deleted" and clears the active option and the
  selection when the store actually removed the keyframe — the shape `nudgeValue` and `nudgeTime`
  already had.

  **The graph's own point drag cannot be dragged into an occupied neighbour's window either**
  (ESCSUITE-179, reworked by ESCSUITE-183). `moveClipKeyframe` deletes whatever already sits
  within `KEYFRAME_TIME_EPSILON` of the time it is told to move a keyframe to. The mouse drag on a
  point in the graph (not the diamond on a `KeyframeTrack` row) used to let the point follow the
  pointer there and refuse the drop on release — the exact "follows the pointer, then snaps back"
  shape ESCSUITE-88 ruled against for the lock, and unlike a trim, which (since ESCSUITE-161) stops
  dead at its neighbour rather than overshooting and bouncing back, this drag could not know it was
  heading for an occupied time until the drop. It can now: the effect's own `handleMouseMove` runs
  the pointer's time through **the same `utils/keyframeClamp.ts` the diamond row drag calls**
  (`occupiedWindows` once in `handleKeyframeMouseDown`, `clampToLegalTime` per move), so the two
  drags cannot disagree about where a point may land — the rules, the bounds behaviour, the
  exact-tie behaviour, the merged cluster and the snapshot limit are all the diamond paragraph's
  above, and are documented there rather than twice. `keyframes` here is every handle the graph
  draws, presets included, so the clamp treats a preset's handle as off limits too — for a
  different reason: the store deletes nothing there (a preset is regenerated from
  `animation.in` / `out`, never stored as a keyframe), but `getAllKeyframesForProperty` merges two
  handles within the same epsilon and the custom one wins, so the preset's handle would simply
  vanish behind it.

  `handleMouseUp` no longer checks the landed time at all. With the clamp running on every move the
  release-time refusal (ESCSUITE-179's own) had no reachable caller left, and it read the **live**
  `keyframes` memo where the clamp read the gesture's snapshot, so the two could disagree about a
  keyframe that arrived mid-gesture; it was deleted rather than kept and tested through a path
  nothing can take (review of ESCSUITE-183, findings 4 and 6), and `keyframes` and `announce` left
  the drag effect's dependency list with it. The graph's live region stays, for the keyboard:
  `nudgeTime` is the one entry point with no pointer position to clamp, and it still refuses an
  occupied time and still says so through `nudgeMessage`. What a mouse drag writes is a legal
  landing, or — when the clip offers none — nothing at all.
