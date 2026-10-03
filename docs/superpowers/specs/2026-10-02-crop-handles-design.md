# ESCSUITE-157 — Crop v2: on-canvas crop handles — design

**Status:** drafted 2026-10-02, awaiting the operator. Jira: ESCSUITE-157. Follows ESCSUITE-6
(crop v1, inspector-only), which filed this as its v2 ticket.
**Scope:** ESCAPEARTIST (`apps/artist`) only. No new stored shape: `ClipCrop` is exactly what
v1 defined.

## Goal

A **crop mode** on the selected media clip in the preview. The full source is drawn dimmed, the
kept region bright, and eight handles on the kept region's edges and corners drag it — writing
`clip.crop` through the same decision v1's `handleCropChange` makes, so `normaliseCrop`'s clamps
and floors, the locked-track refusal and the one-undo-entry-per-gesture rule hold unchanged.

## Non-goals

- Animating the crop. `crop` stays static: not an `AnimatableProperty`, never through
  `getAnimatedValues`.
- Non-rectangular crops. That is `mask` (ESCSUITE-65).
- Changing the stored shape of `crop`, or `MAX_CROP_INSET`, or any of v1's four pure functions'
  behaviour.
- Cropping overlays, or cropping the timeline thumbnail (still v1's documented limit).
- Rule-of-thirds guides, a crop toolbar, a numeric readout over the canvas. The inspector's four
  percent rows already say the numbers.

## The decisions

### 1. Entering and leaving crop mode

**Decision.** A **toggle button in the inspector's Crop section header**, beside its Reset —
"Crop on canvas", with `aria-pressed`. Crop mode is left by: pressing it again, pressing
**Escape** (the global cascade's first branch after the shortcuts sheet, and the focused handle's
own key), or **changing the selection**.

**Reason.** Double-click on a media clip does nothing today, so making it the only way in would
be an invisible affordance; the inspector's Crop section is where a user who wants to crop is
already looking, and a pressed toggle is the one shape that says "this mode is on" without a
second chrome element. Double-click is *not* taken as a second way in: on a text clip it already
opens the inline editor, and one gesture meaning two things depending on the clip kind is how
that editor's bugs started.

**How "the selection changes" leaves it, without a synchronisation.** The flag is a single
latch in `uiSlice` — `cropClipId: string | null` — and **every reader requires
`cropClipId === selectedClipId`**. So selecting another clip, deselecting, deleting the clip,
loading another project or undoing the clip away all leave crop mode by construction: nothing
clears the latch, and a latch that no longer names the selected clip is inert. No effect, no
cross-slice write in `setSelectedClipId`, nothing to keep in step. It is view state: not in the
project, not in the undo history, and `resetStoreForTest` resets it so no test leaks it.

### 2. How the dimmed full source is drawn

**Decision.** Two layers, neither of them the frame renderer:

- **The canvas chrome path** draws the dim: `components/Preview/cropOverlay.ts`'s
  `drawCropOverlay` runs where `drawSelectionHandles` runs — after the frame, on a pointer move
  or a store change, and never during playback. It clips to *the full source's box with the kept
  rectangle punched out* (`ctx.rect(full); ctx.rect(kept); ctx.clip('evenodd')`) and draws the
  clip's own media element once at 45% alpha over that ring, then strokes the kept rectangle's
  edge. **One extra `drawImage` per chrome paint, zero per frame.**
- **A DOM layer over the canvas** draws the eight handles: `Preview/CropHandles.tsx`, a sibling
  of `MarqueeSelection` and `InlineTextEditorAnchor` inside `.videoWrapper`, positioned through
  `contentBox` exactly as the inline text editor is.

**Reason for the dim.** A flat grey rectangle outside the kept region hides the thing the user
is deciding about — which part of the picture to throw away — so the handles would be dragged
blind. Drawing the source again costs one `drawImage` on a path that does not run per frame, and
the evenodd clip means the kept region is left exactly as the frame drew it (no double-dimming,
no second draw of the part that is staying). When the media element is not available — a video
mid-load, an image that has not decoded — the same ring is filled with a translucent veil
instead, so the kept region still reads as the kept region.

**Reason the handles are DOM rather than canvas chrome with a hit test** (ruled by the operator,
2026-10-02). What the ticket asks for is handles that behave in *screen* pixels the way
ESCSUITE-90 made the selection chrome behave — and a DOM button **is** screen pixels by
construction: a 12px handle is 12px under the pointer whatever the project's resolution, with no
`screenScale` multiplication to get wrong, and no second copy of the hit-zone arithmetic to drift
from the drawing. The same move buys the accessibility requirements outright — eight focusable
controls with real names, real focus and a real `disabled` — where canvas chrome would have
needed a parallel invisible DOM layer for exactly that. And it keeps
`useTransformHandles.ts`'s 718-line pointer state machine and `hitTest.ts` **untouched**: in crop
mode the canvas' own mouse handlers are unbound, the same way they already are while the inline
text editor is open (`onMouseDown={editingTextClipId ? undefined : handleMouseDown}` becomes
`editingTextClipId || cropActive`), so a crop drag cannot be mistaken for a move, a resize or a
marquee. The rotation that would be the hard part of positioning eight handles is one CSS
`rotate()` on their container.

**One consequence, intended:** the buttons sit *above* the canvas in the same positioned wrapper,
so a pointer over a handle is the button's event and the canvas never sees it — there is no
canvas hit test to lose a race with, because in crop mode the canvas is not listening at all.
Everywhere else on the canvas the pointer does nothing until crop mode is left.

### 3. What a pointer move writes

**Decision** (accepted by the operator, 2026-10-02). Per move, **one** store write:
`updateClip(clipId, { crop, transform })` — the crop and, beside it, the compensating centre that
keeps the edges the drag is not touching still on screen (see §5, including the one clip that gets
the crop alone: a keyframed placement). One write, so one undo entry
per gesture through `useGestureHistory`, one locked-track check and one re-render per move. It is
the shape the **resize** handles already use: `useTransformHandles.ts`'s west and north drags
write `x`/`y` next to the scale for the same reason, so this is an existing rule applied to a new
gesture rather than a new one.

The crop is computed in source pixels and normalised:

1. The pointer's displacement since the press, in client pixels, divided by the content box'
   `scaleX` → **project** pixels.
2. Rotated backwards by the clip's rotation and divided by `scaleX`/`scaleY` → **source**
   pixels in the clip's own unrotated frame (`cropDrag.ts`'s `sourceDelta`, the same `R(-θ)`
   `previewGeometry.ts`'s `toLocalPoint` uses).
3. Added to the inset(s) the handle owns, as a fraction of the source: `w` → `left`, `e` →
   `right` (negated — moving right *reduces* the right inset), `n` → `top`, `s` → `bottom`, a
   corner → one of each. **The opposite inset is never touched, so the opposite edge is pinned.**
4. Floored at 0 per edge and at "the two opposite insets leave one source pixel" per axis — the
   moved inset is the one clamped, so the pinned edge stays pinned.
5. `cropUpdateFor(crop, source)` — v1's `normaliseCrop` wrapped — decides what is stored:
   the clamp to `MAX_CROP_INSET` (90%), `undefined` for an all-zero crop, and a **refusal**
   (write nothing) for anything leaving less than a source pixel.
6. `cropWriteFor(start, crop, source, project, compensate)` assembles the update: the crop, plus
   the compensating `transform` when the clip's placement is not keyframed (§5).

**Shift keeps the aspect** of the kept region **as it was when the gesture began**. There is no
"active preset" to read: `CROP_ASPECT_PRESETS` writes insets and remembers nothing, by v1's
design. So the aspect is derived — `region.sw / region.sh` at the press — which is the preset's
own ratio whenever a preset was the last thing applied, and the ratio the user can see in every
other case. The dependent inset follows the one the pointer set: a corner or a left/right handle
sets the width and the height follows (absorbed by the edge the handle owns for a corner, split
about the region's own centre for a side handle); a top/bottom handle sets the height and the
width follows, split about the region's centre.

### 4. Rotation

**Decision.** The handles live in the clip's rotated frame, and the maths is the resize
gesture's. Positions come from `getOverlayBounds` — centre, size **and rotation** — and the DOM
container carries `transform: translate(-50%, -50%) rotate(θdeg)`, so the eight handles sit on
the rotated rectangle's own corners and edges. A drag's displacement is un-rotated by the same
`R(-θ)` the canvas hit test uses before it becomes insets, so dragging "outward" on a clip
rotated 90° grows the edge the handle is on and not the one that looks like it on screen.
Cursors come from the existing `getCursorForMode` table through a `CropHandle → DragMode` map,
and so inherit its one known limitation: a cursor keyword does not rotate with the clip, exactly
as the selection chrome's does not.

### 5. Scale 1 is native pixels of the *cropped* region — so the kept region stays under the cursor

**Decision.** The write carries a **compensating centre**: `transform.x` / `transform.y` shifted
so the kept region's un-dragged edges do not move on screen. `cropCentreFor` computes it as the
displacement of the kept region's centre *within the source* (in source pixels), scaled by the
clip's scale, rotated by the clip's rotation, divided by the project's dimensions, added to the
centre the gesture started from.

**Reason.** v1's rule is that the drawn size is the cropped region times the scale, anchored on
the clip's normalised centre — cropping shrinks the picture **in place**. Left alone, dragging
the left handle 100px right would move the left edge only 50px (the box shrinks about its
centre) and would move the **right** edge 50px left as well: the handle would lag the pointer by
half and the pinned edge would not be pinned. One worked case, 400px source at scale 1 in a
1920px project, clip centred: no crop → the picture spans 760…1160. Crop 25% off the left → the
kept region is 300px wide and its centre within the source moved +50px, so `x` moves
+50/1920 → the picture spans 860…1160. The right edge held and the left edge moved exactly the
100 source pixels the pointer did.

This is not new behaviour invented for crop: `useTransformHandles.ts`'s west and north resize
handles already write `x`/`y` beside the scale for the same reason (`newX = startOverlayX +
deltaX / 2`). It is one `updateClip` write rather than two actions, so it is one history push,
one locked-track check and one re-render per move; `updateClip` merges a `Partial<Clip>`, and
`transform` is passed whole (`{ ...startTransform, x, y }`) from the transform the gesture
started with, which is what the resize drag does with its own start measurements.

**The one exception: a clip whose placement is keyframed gets no compensation** (ruled by the
operator, 2026-10-02). If the clip carries custom keyframes on `x`, `y`, `scaleX` or `scaleY`, the
write is the **crop alone** — writing a static centre onto a clip whose centre is animated would
fight its keyframes, and the keyframes would win at playback anyway. `cropDrag.ts`'s
`cropCompensatesCentre(animation)` is that question and `cropWriteFor(..., compensate)` is what
acts on it, so the decision is one branch in one pure function with a case on each side. On such a
clip the picture therefore shrinks about its centre as it is cropped — both edges of the axis
move, half as far as the pointer — while the handles keep following `getOverlayBounds`' animated
box; that inexactness is accepted and documented rather than papered over.

### 6. The minimum kept size

**Decision.** Two floors, and the stricter wins. `cropForHandleMove` clamps the moved inset so
the axis keeps **one source pixel** (`left + right ≤ 1 - 1/sourceWidth`), which is
`croppedSourceRect`'s own floor expressed as an inset — so a handle dragged past the far edge
stops there instead of producing a crop the store would refuse. `normaliseCrop` then clamps
every inset to `MAX_CROP_INSET` (90%), which is what actually stops the drag on any source wider
than ten pixels, and refuses outright anything that still leaves less than a pixel (reachable
only through an aspect-locked drag, where the dependent axis is derived rather than clamped). A
refusal writes nothing: the handle stops moving and the picture is unchanged, the same answer
the inspector's sliders give.

### 7. Undo granularity

**Decision.** One entry per drag, one per arrow nudge, one per **held** arrow key — through
`hooks/useGestureHistory.ts`, unchanged. `begin()` on pointerdown, `commit(...)` around the one
write (inside the rAF-throttled updater, so "first write" means the first that reaches the
store), `end()` on pointerup. A keydown that is not a repeat calls `begin()`, a repeat calls
`resume()`, keyup calls `end()` — `useSliderGesture`'s rule verbatim. `commit` is also what
makes a locked row's refusal cost nothing: the entry stays owed.

### 8. Accessibility

**Decision.**

- Eight `<button>`s, one per handle, with distinct accessible names: "Crop top left", "Crop
  top", "Crop top right", "Crop left", "Crop right", "Crop bottom left", "Crop bottom", "Crop
  bottom right". They sit in a `role="group"` named "Crop handles". No duplicate names, which
  `ClipEditor.a11y.test.tsx`'s rule asks of every control and a test of this layer asserts
  directly.
- **Arrow keys nudge the focused handle by one source pixel; Shift+arrow by ten** — through the
  same `cropForHandleMove` a drag uses, but with the delta handed over directly in source pixels,
  in the clip's own LOCAL (unrotated) frame, rather than a pointer displacement converted through
  `sourceDelta`'s `R(-θ)` first. Each handle owns fixed insets in that frame, so on an unrotated
  clip the handle moves the way the arrow points; on a rotated one the arrow follows the clip's
  own axes rather than the screen's (ArrowRight on a clip rotated 90° moves the handle down the
  screen, not right) — the same asymmetry a drag's `sourceDelta` step exists to remove, which the
  nudge does not apply (ESCSUITE-173 correction: an earlier version of this line claimed the
  nudge moves "the way the arrow points" unconditionally). A focused handle claims
  all four arrows (preventDefault + stopPropagation), the rule
  `useKeyframeGraphKeyboard.ts` states for a focused listbox: an arrow the handle does not own —
  ArrowUp on the `w` handle — is swallowed and does nothing, rather than stepping the playhead
  from under the user.
- Every nudge that lands is **announced** in a `role="status" aria-live="polite" aria-atomic`
  region owned by the crop layer, in the keyframe graph's shape and with its zero-width-space
  alternation (an atomic region whose text does not change is not re-read, and repeating one
  nudge is exactly the case a keyboard user is in). The message names the handle and the insets
  it owns, **in source pixels** — `Crop left: left 1 px`, `Crop top left: left 12 px, top 4 px`
  — because the nudge's step *is* one source pixel and a percentage would round a one-pixel
  nudge on a 1920-wide source to "0%". A nudge that changes nothing — an arrow the handle does
  not own, a handle already clamped at an edge, a write the store refused — announces nothing.
  A pointer drag announces nothing either: it is visible.
- Escape on a focused handle leaves crop mode. Focus is **not** moved back to the inspector's
  toggle: the opener lives in another component tree, and reaching across to focus it would mean
  a ref handed from the inspector to the preview through the store. The handles unmount and focus
  falls to the document, as it does when any other transient control in the editor goes away.
  Recorded as the known wart it is rather than faked.

### 9. A locked track

**Decision.** Crop mode can be **entered** on a locked track — reading is not editing, and the
dimmed source is worth seeing — and the eight handles render `disabled`. No drag starts, no
nudge writes, and the explanation is the one the panel already gives: `ClipEditorHeader`'s
"Track locked — unlock it in the timeline to edit this clip". `disabled` is the **only**
mechanism: React delivers no mouse event to a disabled control and a disabled button takes no
focus, so the gesture carries no `locked` branch of its own and there is no second wording to
maintain. The store's refusal is the backstop for the two things `disabled` does not cover — a
row locked *mid*-gesture, whose open document listeners keep running, and a keydown dispatched
straight at the element — and neither announces anything, because nothing was written.

### 10. Mask, stroke, transitions, the opacity gate, keyframes

- **Mask and stroke** need nothing: both are computed from the drawn box, which is the cropped
  region, so a circle-masked clip's circle already fits the kept region (ESCSUITE-6 + ESCSUITE-65).
  In crop mode the chrome is drawn from the same box, so the mask's circle and the crop
  rectangle agree.
- **Transitions:** the crop chrome reads `getOverlayBounds`, the one function every other piece
  of chrome reads, so it inherits ESCSUITE-147's documented gap — bounds cannot be told which
  preset side an active transition has suppressed — rather than introducing a second geometry
  that would disagree with the selection box as well as with the frame. Named, not fixed, here.
- **The opacity gate** (ESCSUITE-155) is a hit-test rule for picking a clip through the
  *canvas*; crop mode's handles are reached from the inspector, on a clip that is already
  selected, so a clip animated to `opacity: 0` still shows its crop handles. That is deliberate:
  the user chose this clip, and refusing to show the handles of an invisible clip would be a
  mode that silently does nothing.
- **A keyframed clip** can be cropped, and on one whose **position or scale** is keyframed the
  crop is written without the compensating centre (§5's exception): the handles follow
  `getOverlayBounds`' animated box, the picture shrinks about its centre rather than holding its
  un-dragged edges, and nothing static is written over an animated placement. A clip keyframed on
  rotation, opacity or blur alone still compensates, using its static rotation — the same family
  of inexactness, one step smaller. Refusing crop mode on keyframed clips was the alternative and
  is worse: it hides a static property behind an unrelated animation.

### 11. What the perf files pin

- **`drawFrame.perf.test.ts` is byte-identical.** Nothing is added to `drawPreviewFrame`: crop
  mode draws on the chrome path, which is a different function, called after the frame and
  returning early during playback. The same is true of `exportMP4.perf.test.ts` /
  `exportWebM.perf.test.ts` and of every rerender pin.
- **No new `*.perf.test.ts` file.** A per-frame ceiling would be measuring something that does
  not run per frame. Instead `cropOverlay.test.ts` asserts the conservation laws of one chrome
  paint exactly: **zero** context calls when crop mode is off, when the latch names a clip that
  is not selected, during playback, or when the clip is off screen at this time; and when it is
  on, **one** `drawImage`, **one** `clip`, one `translate`, one `rotate` and `save` balanced with
  `restore`.
- The DOM layer renders nothing when crop mode is off — `PreviewPlayer` does not mount it — so
  it costs no element, no listener and no store subscription in the ordinary case.

## Tests (red first)

- `core/cropDrag.test.ts` — `sourceDelta` unrotated, rotated 90° and scaled; `cropForHandleMove`
  for all eight handles, both directions, the 0 floor, the one-pixel floor with the opposite edge
  pinned, and the Shift arms (corner, side-x, side-y); `cropRegionAspect`; `cropCentreFor`
  unrotated, rotated and scaled; `cropCompensatesCentre` for a clip with no animation, with an
  animation but no keyframes, keyframed on position, keyframed on scale and keyframed on rotation
  alone; `cropWriteFor` with the compensation and without it.
- `core/clipCrop.test.ts` — `cropUpdateFor`'s five answers (no source + zero, no source +
  non-zero, zeroes, a valid crop, a refused crop).
- `components/Preview/cropOverlay.test.ts` — `fullSourceBox` and `cropFrameBox` arithmetic; the
  five early returns; the drawn ring and the stroke; the conservation laws above; the veil
  fallback with no element.
- `components/Preview/CropHandles.test.tsx` — eight buttons, eight distinct names, positions
  derived from `croppedSourceRect` × the clip's transform in a letterboxed box and in a rotated
  clip; a drag writes the crop and the compensating centre; a drag on a clip keyframed on
  position writes the crop and **leaves the centre alone**; **one** undo entry per drag; a
  locked row's handles are disabled and write nothing; arrow and Shift+arrow nudges; the
  announcement; Escape leaves crop mode.
- `components/Preview/PreviewPlayer.crop.test.tsx` — the chrome branch replaces the selection
  chrome in crop mode; the canvas' pointer handlers are unbound; nothing is drawn or mounted
  when the latch does not name the selected clip; nothing during playback.
- `components/ClipEditor/CropSection.test.tsx` + `useClipEditorActions.test.ts` — the toggle, its
  `aria-pressed`, that it is live on a locked track, and that it sets and clears the latch.
- `app/useAppKeyboardShortcuts.test.ts` — Escape leaves crop mode before it touches the in/out
  points, and after it closes the shortcuts sheet.
- `store/projectStore.test.ts` — the latch's default, its setter, that selection does not clear
  it and that undo does not restore it.

## Docs and release

- `apps/artist/CLAUDE.md`: a "Crop mode" paragraph in the preview-chrome section, replacing the
  v1 "no on-canvas crop handles" limit; the thumbnail limit stays.
- Root `CLAUDE.md`: one clause in the ESCAPEARTIST bullet list.
- Changeset: `@escapesuite/artist` **minor** — "Crop a clip on the canvas: a crop mode with eight
  draggable handles over the kept region, the rest of the source dimmed."
