<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# ClipEditor (`src/components/ClipEditor/`)
`ClipEditor.tsx` is wiring only — one call to `useClipEditorActions()`, the `!selectedClip`
early return, and the JSX that hands each section the handful of props it needs. It holds no
state, subscribes to nothing directly and computes nothing; every store read and every store
write in the panel lives in the hook, and every control lives in one of the section
components. The guards that show and hide the sections (`!isAudio`, `!isOverlay`,
`isTextOverlay && selectedClip.textData`, …) stay in `ClipEditor.tsx` at the positions they
have always had — see the note on `CollapsibleSection` below for why moving one is a
behaviour change rather than a tidy-up. Every module here has its own test file, and
`ClipEditor.tsx` itself is covered through `ClipEditor.test.tsx` and
`ClipEditor.overlay.test.tsx`, which drive the rendered panel.

| Module | Owns |
|--------|------|
| `ClipEditor.tsx` | The composition: the hook call, the empty-state early return, and the per-section guards in their fixed order. Owns `div.container` itself in both the empty and selected states, so that element's identity is stable across the empty↔selected transition |
| `useClipEditorActions.ts` | Every store read and write the panel makes — the selectors, the derived `sourceVideo`/`track`, the clip classification, and one handler per control. Adds no state and no subscription of its own; the hook calls are the ones that used to sit at the top of `ClipEditor.tsx`, in the same order and with the same dependency arrays (plus the stable `commit`, which changes no identity). **No `currentTime` selector** — see the note below |
| `useSliderGesture.ts` | Where one slider gesture starts and stops, and `commit`, which runs one write inside it with the `skipHistory` flag it is owed — a `useGestureHistory` and six listeners, no state. One instance serves the whole panel; see "One drag of a slider is one undo step" below |
| `useBurstGesture.ts` | The same for a typed or picked value (ESCSUITE-242): a burst opens on its first edit and closes on blur, after `BURST_PAUSE_MS` (600 ms) with no edit, or on unmount — a `useGestureHistory` and one timer ref, no state. One instance serves the whole panel; see "One typing burst or picker sweep is one undo step" below |
| `useCommittedNumberInput.ts` | A number field that commits on blur or Enter, not per keystroke (ESCSUITE-256): `useCommittedNumberInput({ value, min, max, integer?, onCommit })` returns `{ text, onChange, onBlur, onKeyDown }`. It holds the typed draft locally (no store subscription, so the rerender pin is untouched), parses with `Number` ("1e2" is 100), clamps to `[min, max]`, rounds when `integer`, calls `onCommit` only when the result differs from `value`, and reverts on empty / non-finite input or Escape. The font-size field is its only user: the old per-keystroke clamp turned typing "24" into 84 and let 5000 past `max`; the committed write still goes through the ESCSUITE-242 burst. `CropSection`'s percent fields write `Number(value)` unclamped per keystroke and were left as they were |
| `clipEditorModel.ts` | The panel's pure derivations: `describeClip` (which kind of clip, and the header's label), `relativeTimeInClip`, `overlayPositionValue`, `maxPresetDuration`, `fitToCanvasScale`, `keyframeCount`. No store, no React |
| `clipColorValues.ts` | The colour maths the text and shape controls share: the text background's fixed `cc` alpha, a fill's rgb-with-carried-alpha rewrite, the no-fill toggle, and the fill alpha as a 0–100 percentage |
| `clipEditorOptions.ts` | The **five** `{ value, label }` option lists the dropdowns render — transitions, blend modes, clip mask kinds, animation presets, easings (the last re-exported from `utils/easingOptions.ts`) — plus `CROP_ASPECT_PRESETS` (ESCSUITE-6), which is buttons rather than a dropdown because a preset is an action and not a stored value |
| `CollapsibleSection.tsx` | One titled, collapsible block: its own open/closed flag, seeded from `defaultOpen` at mount and never re-read |
| `ClipEditorEmptyState.tsx` | The panel's contents when nothing is selected: the prompt plus the five buttons that create an overlay from nothing. `ClipEditor.tsx` supplies the surrounding `div.container` |
| `ClipEditorHeader.tsx` | The title block — clip type, name, delete button, and the duration/position/track rows underneath |
| `TextContentSection.tsx` | "Text Content": the text, its font family and size, bold/italic/alignment, and the two colours. The textarea grows by writing `style.height` on the element, so no measured height lives in React state. The font size commits on blur or Enter (ESCSUITE-256). A "Background" checkbox beside the BG picker switches the background off by writing `#00000000` — the value `canvasRenderer` already draws nothing for — and on again by restoring the picker's colour at the fixed `cc` alpha; the picker is disabled while it is off |
| `ShapeSection.tsx` | "Shape": the shape type, then either the blur region's amount slider or the fill/stroke controls, plus size, rotation and blur. "No fill" is an alpha of `00` on the fill colour, not a separate flag. All seven sliders carry the undo gesture |
| `TransformSection.tsx` | "Transform": position, then — media clips only — scale with its aspect-ratio lock, Fit to Canvas and Reset, and opacity last. The scale sliders run over `log10(scale)` from -1 to 1 (0.1x to 10x, ESCSUITE-256), so Fit to Canvas's 6.0 for a small source is on the track; a stored scale outside the range is shown clamped on the slider and written only when the user moves it, and the label prints the real scale to two decimals (`6.00\u00d7`). Its two Resets read "Reset" and are named "Reset position, size and opacity" (the header) and "Reset transform including rotation" (beside Fit to Canvas); `CropSection`'s is "Reset crop" |
| `BlendModeSection.tsx` | "Blend Mode": one dropdown over `BLEND_MODES`, collapsed by default |
| `MaskSection.tsx` | "Mask & Stroke": the mask kind over `CLIP_MASK_KINDS`, a corner-radius slider shown for `rounded` only, and the stroke's width and colour — the width labelled in **pixels at the project's resolution**, because what is stored is a fraction of the frame width and a fraction is not a number anyone can act on. Collapsed by default. Media clips only, gated exactly as Blend Mode is. It normalises nothing: "`none` with a radius" and "a width of 0 with a colour" are things a user can express, and turning them into absent fields is `useClipEditorActions`' job |
| `CropSection.tsx` | "Crop" (ESCSUITE-6): which rectangle of its source frame the clip shows — four rows of slider plus number field, each inset a whole percentage capped at `MAX_CROP_INSET` (90%), five aspect-preset buttons over `CROP_ASPECT_PRESETS` (None, 1:1, 16:9, 9:16, 4:3) and a header with two buttons, "Crop on canvas" then Reset. Collapsed by default. Media clips only, gated exactly as Mask & Stroke is and placed **immediately after it**, before Effects — an overlay has no source frame for an inset to be a fraction of, and the condition is byte-identical to its neighbours' so no existing section's positional open/closed slot changes meaning. Like `MaskSection` it normalises nothing: 90% off two opposite edges is something a user can express, and the **one** new handler `handleCropChange` is what decides what gets stored — and, since ESCSUITE-171, where the picture then sits: every control in this section writes the same compensating centre the on-canvas handles write, so a slider pins the edge it is not cropping and Reset puts the picture back where it started. The **presets are computed here**, from `cropForAspect` — this is the only place holding both the source's shape and the clip's current crop — which is why they are not a second handler, and why "None" and the header Reset make literally the same write: four zeroes, which `normaliseCrop` turns into `crop: undefined`. The four sliders carry the undo gesture; the number fields and the preset buttons keep an entry each — a number field has no gesture listeners, so it reports on every keystroke and typing `45` into an empty one lands two undo entries, same as `TextContentSection`'s font-size field. "Crop on canvas" (ESCSUITE-157) opens or closes crop mode — `aria-pressed` on whether `useClipEditorActions`' `cropOnCanvas` is true, i.e. whether the store's `cropClipId` latch names this clip, with a matching accent fill from `.resetButton[aria-pressed='true']` so the state is visible and not screen-reader-only — and is deliberately **not** disabled by the track's lock: it is reading, not editing, so it stays live on a locked track where Reset does not, which is why it is also in `headerRight` and so outside the section's `<fieldset disabled>`. It **is** disabled, with a `title` giving the reason, when `sourceWidth` is 0 — the clip's source has left the media library, `cropTarget` would refuse it, and latching the mode would leave a pressed toggle over an empty canvas. That reason is specific to a missing source and deliberately does **not** extend to the other thing `cropTarget` refuses, a hidden track (ESCSUITE-171): hiding is reversible, so that case follows the scrub precedent instead — see the crop-mode paragraphs in the Preview section |
| `EffectsSection.tsx` | "Effects": one blur slider, collapsed by default |
| `AnimationSection.tsx` | "Animation": the Animate In and Animate Out groups (each hiding its duration and easing until a preset is chosen), the "Active" badge, and the button that opens the keyframe panel with its keyframe count |
| `TransitionSection.tsx` | "Transition Out": which transition ends the clip and, for anything but `none`, how long it takes. Collapsed by default |
| `ActionsSection.tsx` | "Actions": go to, duplicate, and — video and audio only — split. Takes the clip's position and duration rather than a `timeInClip`, and hands them to `SplitButton` |
| `SplitButton.tsx` | The Split button alone, and the only part of the panel that depends on the playhead. Subscribes to the derived *disabled boolean* itself, so a playback tick re-renders this one button only when the answer changes |

**The clip inspector must never subscribe to `currentTime`.** `useClipEditorActions` used to
hold a `useEditorStore((s) => s.currentTime)` selector feeding a `timeInClip` that only the
Split button's `disabled` attribute read, so the whole panel — a few hundred elements — re-rendered
five times a second while the project played; and because the hook runs *above*
`ClipEditor.tsx`'s `!selectedClip` early return, the empty panel paid exactly the same. The
post-round-1 CPU profile ranked `ClipEditor` #10 of the app-code frames a playback window
executes (23.1 ms, 4.4%). `Toolbar`'s `getState()` fix is wrong here because the disabled state
*is* rendered and a stale read would show the wrong one; the fix is `TimelinePlayhead`'s shape
instead — `SplitButton` subscribes for itself, and to the boolean rather than to the playhead,
so zustand's `Object.is` ends the tick and the button re-renders twice over a pass across a clip
instead of ten times. `handleSplitAtPlayhead` reads `useEditorStore.getState().currentTime`,
which is what a click needs and a render does not. Measured 2026-09-13 by
`ClipEditor.rerender.test.tsx`: ten playback ticks cost the panel 0 renders, selected or not,
against 10 before.

**Every control has a name** (ESCSUITE-89). The panel's rows are laid out as a `<label>` and a
sibling control, and for most of its life none of those labels was wired to anything: a screen
reader met the inspector as a couple of dozen unnamed sliders, dropdowns and swatches, and the
e2e label audit never saw it because that audit runs with nothing selected. Every section now
takes **one `useId()`**, gives each control an `id` built from it, and points that row's
`<label htmlFor>` at the id; where there was no visible label at all — Blend Mode's and Mask & Stroke's and
Shape's dropdowns, Text Content's text area, font family, font size and alignment — the control
carries an `aria-label` instead, and where the visible word was a `<span>` that is plainly a
label (the colour swatches' "Fill", "Stroke", "Stroke Color", "Text", "BG"; each animation
group's "Animate In" / "Animate Out") the span **became** a `<label>` with the same class, the
same text and the same position. Nothing else about the DOM moved, for the reason at the bottom
of this section: `CollapsibleSection` seeds a section's open/closed state positionally, so a
moved element is a behaviour change. `ClipEditor.module.css`'s `.colorInput span` rule followed
its five labels and is now `.colorInput label`, so those rows look exactly as they did. Sections added since follow the same rule: Crop's four sliders take the
visible edge word through `htmlFor`, and the number field beside each one — which has no
visible label of its own — carries `aria-label="<Edge> crop percent"`, so its eight value
controls have eight distinct names.

**Two controls may not share a name**, and three rows in the panel would have. Both animation
groups call theirs "Duration" and "Easing", so those four take `aria-labelledby` naming the
group heading *and* the row's own label — "Animate In Duration", "Animate Out Easing" — built
from the text on screen rather than from a string in the component that the visible label could
drift away from; Transition Out's plain "Duration" is then unambiguous. Shape's stroke *width*
slider and its stroke *swatch* both say "Stroke", so the two swatches take the fuller
`aria-label` ("Fill color", "Stroke color") and the sliders keep the words beside them. Three
buttons were named by something that is not a name: the delete button and the aspect-ratio
padlock by their `title` alone, and the no-fill toggle by the glyph "⊗". The delete button now
says what its title said. The padlock is **not** named after its title, which changes with the
state ("Unlock aspect ratio" while locked): it is `aria-label="Lock aspect ratio"` plus
`aria-pressed`, because a name that moves with the state announces "Unlock aspect ratio,
pressed" and contradicts itself — the name says what the control is, `aria-pressed` says what
state it is in, and the title goes on saying what a click will do. Bold and italic are still
"B" and "I" — that is what a sighted user calls them — and they gained `aria-pressed` too.
A name also has to *contain* the word on screen (WCAG 2.5.3), which is why the background
swatch is "BG color" and not "Background color".

**`ClipEditor.a11y.test.tsx` is the contract**: with every
section open it walks each input, select, textarea and button the panel renders for five clip
shapes and demands a non-empty name for each and distinct names for the value controls, so a
control added later is covered the day it lands. It computes the name itself, in about thirty
lines, rather than with `dom-accessibility-api`'s `computeAccessibleName`: that package is a
transitive dependency of @testing-library/dom and is **not resolvable from `apps/artist`**, so
using it would mean a new devDependency and a lockfile change for one assertion. The one thing
the hand-rolled version leaves out is the `placeholder` fallback that accname — and therefore
axe — accepts, which makes the sweep *stricter* than the e2e audit rather than looser: the text
area's "Enter text..." would have satisfied axe on its own, and the sweep made it earn
`aria-label="Text"`. The sibling suites were *not* rewritten to
`getByLabelText` — `test/domQueries`' `rowControl` / `rowSelect` / `rowColor` still walk from
the visible text to the control in the same row, which is what they have always done — and
`apps/e2e`'s `the clip inspector's controls have associated labels` runs `checkFormLabels` and
axe over the panel with a media clip, a text overlay and a shape overlay selected, which is the
first time that audit has seen these controls at all.

**One drag of a slider is one undo step** (ESCSUITE-75). A range input writes on every `input`
event — the blur slider steps in halves from 0 to 50, so a full drag is around a hundred writes
— and the store actions behind the inspector's sliders pushed an undo entry each time. One drag
therefore filled the whole 50-entry `MAX_HISTORY_SIZE` stack with its own intermediate values,
evicted everything the user had done before it, and paid a full-project `structuredClone` per
entry; Ctrl+Z then stepped back half a pixel at a time. The rule is ESCSUITE-52's, the one
`Preview/useTransformHandles.ts` already applies to a transform drag: **the gesture's first
write pushes history — so the entry snapshots the state as it was before the drag — and every
write after it passes `skipHistory`. Nothing extra happens on release**, so a drag abandoned
half way is already undoable to where it started.

`useSliderGesture` is that gesture and nothing else. A gesture opens on `pointerdown` or
`keydown` and closes on `pointerup`, `pointercancel`, `keyup` or `blur` — `pointercancel`
because a touch or pen gesture the browser takes away (a scroll takes over, the pen leaves
range) gets no `pointerup`, and a gesture left open with its entry already pushed would swallow
the *next* write's entry. A **held** arrow key is one gesture, not
one per repetition, because a `keydown` carrying `repeat: true` leaves an open gesture alone
(the rule the keyframe drags took in #373). Unlike `Preview/useTransformHandles.ts`, whose writes
are throttled to an animation frame and so must read the flag inside the updater the throttler
runs, a slider's writes are synchronous — the `input` event calls the handler, which writes — so
here "decide at the call" and "decide at the write" are the same moment.
`useClipEditorActions` calls it once and returns its
listeners as `sliderGesture`, which `ClipEditor` spreads onto **every slider on the panel** —
`TransformSection`, `ShapeSection`, `EffectsSection`, `MaskSection`, `CropSection`,
`AnimationSection` and `TransitionSection`; the handlers those sliders reach —
`handleTransformChange`, `handleBlurChange`, `handleMaskChange`, `handleStrokeChange`,
`handleCropChange` (ESCSUITE-6 — the one handler in this list that can **refuse**: a crop that
would leave less than one source pixel, or a clip with no source media at all, writes nothing;
and since ESCSUITE-171 the one that writes a `transform` beside its own property, through
`cropWriteFor`),
`handleAnimationInDurationChange`, `handleAnimationOutDurationChange`,
`handleTransitionDurationChange` and, for
an overlay's Pos X/Y, `handleTextDataChange` / `handleShapeDataChange` — run their write
through `commit` at the moment they write. The selects beside those sliders (preset,
easing, transition type) deliberately do not ask: a select is a single change and keeps its own
entry. One instance for the whole panel is
deliberate: a user drags one slider at a time, and a press on the next closes whatever the last
one left open. **A write that belongs to no gesture pushes its own entry**, exactly as before —
every other control on the panel, a section rendered on its own in a test, and a value set from
code. It holds refs and no state, so no slider adds a subscription and no render count moves:
`ClipEditor.rerender.test.tsx` is unchanged by this work, and the rule itself is held by
`ClipEditor.sliderHistory.test.tsx` (the real panel and the real store) and
`useSliderGesture.test.ts` (the contract, without a DOM).

**A slider's gesture belongs to the slider that opened it** (ESCSUITE-267). One instance for the
whole panel had a hole: pressing slider B while slider A still has focus delivers B's
`pointerdown` and *then* A's `blur`, and A's blur — the documented substitute for a `pointerup`
that may never come — ended the gesture B had just opened, so B's drag ran with no gesture and
pushed one entry per move (a 60-move drag filled the 50-entry stack). Now the element whose
`pointerdown` or `keydown` opened the gesture (its `currentTarget`) owns it, and `pointerup`,
`pointercancel`, `keyup` and `blur` end it only when they come from that element; from another
slider they are ignored. A press on a different slider while a gesture is open simply begins a
new one owned by it — `begin()` forgets the push, so the old slider's entry is already on the
stack and the new one pushes its own — and a key repeat continues an open gesture only on its
owner, a repeat on another slider being a press of its own. A's own blur still ends A's own drag
(ESCSUITE-169 is untouched), and `useGestureHistory` is unchanged (`commit` gained the dead-owner check of ESCSUITE-271, below). The fix keeps
the **one** instance rather than one per slider: per-slider instances would add hooks and
change `ClipEditor.rerender.test.tsx`, while the owner is one ref write per gesture start, so
no render, subscription or per-move allocation moves. `SliderGestureHandlers`' event shapes
widened by the one property they now read, `currentTarget: EventTarget | null`, which React's
event types still satisfy.

**An owner that leaves the document mid-gesture closes it at the next write** (ESCSUITE-271). An
`<input type="range">` unmounted mid-drag (its section re-rendered away, the selected clip changed
under the drag) never delivers its `pointerup` / `keyup` / `blur`, so the gesture stayed open with
the detached node as its owner until the next slider press. `commit` now checks the owner first: if
it is a `Node` with `isConnected === false` it ends the gesture and clears the owner, and the write
proceeds as a write belonging to no gesture, pushing its own entry. One property read per write, no
listener, and the pointer-drag flag is reset with it so later keyboard nudges are not mistaken for a pointer drag; an owner without `isConnected` (a plain `EventTarget`) counts as connected.

The flag reaches the store through the trailing optional `skipHistory` parameter on
`updateClipTransform`, `updateClip`, `updateClipEffects`, `updateTextOverlayData`,
`updateShapeOverlayData`, `updateClipAnimation`, `updateClipTransition`,
`shiftClipsAfter`, `setClipTimelinePosition` and — since ESCSUITE-242, for the track header's
volume slider — `updateTrack` — the first, fourth
and fifth already had it; ESCSUITE-75 added it to
`updateClip` and `updateClipEffects`, ESCSUITE-77 the next three and ESCSUITE-79
`setClipTimelinePosition`, all six in the same shape
(`history: skipHistory ? state.history :
pushToHistory(state)`). It is optional and last, so every existing caller is one undo step
exactly as before. `trimClip` (ESCSUITE-110 review round 1) takes it the same way, having taken
over the timeline trim's own write from `updateClip` — which still carries the flag today, now
purely for the mask/stroke sliders in `useClipEditorActions.ts`.

**One typing burst or picker sweep is one undo step** (ESCSUITE-242). Three more inputs wrote
on every event and pushed an entry each, so one gesture evicted the user's whole history: the
**track header's volume slider** (a 60-move drag took the stack from 2 entries to 50), the
**caption textarea** (one entry per keystroke) and the **colour pickers** (an
`<input type="color">` reports continuously while it is swept). The volume slider is a slider,
so it takes `useSliderGesture` unchanged — one instance per `TrackHeader`, refs only, so the
header's `React.memo` and `timelineGestures.perf.test.ts` hold exactly as before — and
`updateTrack` grew the trailing `skipHistory` flag and the ESCSUITE-87 boolean to carry it (an
id naming no track is refused in front of the `set`, as ESCSUITE-172 refuses an unknown clip).
Like every inspector slider, its `blur` ends the gesture (the substitute for a `pointerup` that
never comes) while a Shift released mid-drag does not (ESCSUITE-169). The mute, visibility and
lock buttons and the rename keep one entry per call.

The typed and picked values are not bounded by a pointer or a key, so they get
`ClipEditor/useBurstGesture.ts` instead: a **burst** opens on the first edit and closes on
`blur`, after **`BURST_PAUSE_MS` = 600 ms** with no edit, or on unmount (timer cleared and scope
ended — ESCSUITE-120's lesson). Same `useGestureHistory` rule underneath: the burst's first
write pushes, the rest skip; the store is still written on every event. It covers the caption
textarea, the font-size field and all **five** colour pickers on the panel — text and
background (`TextContentSection`), fill and stroke (`ShapeSection`), and the mask stroke colour
(`MaskSection`). Each control calls `onEdit` from inside its own `onChange`, right before the
write, rather than spreading an `onInput` listener, so the burst is open at the write however
the edit arrived; and it does not close on a picker's own closing `change`, because React's
value tracker drops that event (it repeats the last `input`'s value) before any handler sees
it — the pause and the blur end a sweep, which also coalesces a browser that reports each
picker step as a `change`. The burst keeps a history of its own rather than sharing the
slider's, because a press fires its `pointerdown` *before* the blur of whatever had focus (focus
moves on `mousedown`): sharing one history, the textarea's blur when the user presses a slider
would end the drag that press had just begun. The inspector's sliders already have exactly that
bug among themselves — pressing slider B while slider A still has focus ends B's scope at its
start, so B's drag pushes one entry per move — because they share one history; it predates this
ticket and is filed as **ESCSUITE-267**, and a separate burst history is how this ticket avoids
adding a second instance of it (`TextContentSection.test.tsx` pins the caption's blur
mid-drag leaving the slider's one entry intact). One merge case remains, and loses nothing: a
press on the preview canvas that grabs a clip or a handle does not move focus
(`Preview/useTransformHandles.ts` calls `preventDefault()` on that `mousedown`), so a burst stays
open through it, and typing straight
after a canvas drag — within the 600 ms — can fold two edits into one undo step.
`useClipEditorActions`' `commitEdit` nests the two `commit`s and skips history when
either gesture says to, and is what `handleTextDataChange`, `handleShapeDataChange` and
`handleStrokeChange` write through — outside both gestures it hands the write `false`, so the
bold/italic toggles, the selects and the no-fill toggle keep one entry each. Three scopes, then:
**a slider gesture** (pointer or key), **a typing burst** and **a picker sweep** (both the 600 ms
burst). Held by `useBurstGesture.test.ts` (the contract), `store/trackSlice.test.ts`, and the
real-store cases in `TrackHeader.test.tsx`, `TextContentSection.test.tsx`,
`ShapeSection.test.tsx` and `MaskSection.test.tsx`; no rerender or perf pin moved.

**Every slider in the inspector and the trim drag on the timeline now follow the one-entry-per-gesture
rule** (ESCSUITE-77 finished what ESCSUITE-75 started). `Timeline/useTrimDrag.ts` is the one that
is not a slider: it writes the store on every mousemove, so it carries
`useTransformHandles`' shape instead of the hook's — a per-gesture `useGestureHistory` begun on
mousedown, the first write unskipped and the rest passing `true`. It throttles nothing, but the
write is still `commit`ted *inside* the `if (update)` rather than at the move, because
`computeTrimUpdate` refuses a move that would leave the clip too short and such a move writes
nothing at all: a gesture whose opening move was rejected must still push on the write that does
land. The one thing a trim does on release — the ripple tool's `shiftClipsAfter`, which closes
the gap the trim left — takes the flag too, and `shiftClipsAfter` grew it for that:
the shift belongs to the trim that produced it, and pushing an entry of its own made
one ripple trim two undo steps, the first Ctrl+Z sliding the downstream clips back and
leaving the clip trimmed.
`useTrimDrag.test.ts` holds it (one entry for five moves, two for two trims, one for a
whole ripple trim with both halves coming back together, the undo
landing on the pre-trim in and out points, and the refused opening move). The same ticket made the
Transform section header's Reset one entry rather than two on an overlay clip: its second write,
the overlay's own coordinates, passes `skipHistory: true` as a **literal** — that is a button, not
a gesture, so there is nothing to ask.

**Dragging a clip to another track is one undo step too** (ESCSUITE-79 — the last gesture that
was not). `Timeline/useClipDrag.ts` writes nothing while the drag runs, so both of its writes
happen in the one `handleMouseUp`: a drop that changed the clip's row *and* its time called
`moveClipToTrack` and then `setClipTimelinePosition`, and each pushed an entry. The first Ctrl+Z
then put the time back and left the clip on its **new** row — a half-state the drag had never
produced — and a second was needed to get home. `moveClipToTrack` now pushes the gesture's entry,
which therefore snapshots the clip on the track and at the position the gesture found it, and
`setClipTimelinePosition` takes the same trailing `skipHistory` the others do and passes `true`
whenever the row changed. There is no `useGestureHistory` here, unlike `useTrimDrag`: with both
writes in one handler, "has the entry been pushed?" *is* "did the row change, and did that write
land?" — which the commit already computes, the second half of it since ESCSUITE-87 below. A drop that only moved the clip in time, and one that only changed its row, are
each a single write and a single entry exactly as before. The bulk move a multi-selection drag
commits was never affected — `selectionSlice.moveSelectedClips` moves every selected clip inside
one `set` with one `pushToHistory`, so a five-clip drag was always one entry —
and `useClipDrag.test.ts` now holds all four shapes (one entry each, the cross-track drop's undo
landing on both the original row and the original position, and the flag `false` on the first
write and `true` on the second).

**A multi-selection drags in rows as well as in time, all of it or none of it** (ESCSUITE-80).
The bulk branch of that same commit in `Timeline/useClipDrag.ts` was gated on `deltaTime !== 0`
and passed a hard-coded row delta of `0`, so it got both cross-track cases wrong. A group
dropped on another row at the *same time* did not match the gate at all and fell through to the
single-clip commit below it, which fired `moveClipToTrack` for the clip the pointer was holding
and nothing else — the selection split, silently. A **diagonal** drag did take the bulk path,
and moved every clip in time and none of them in row. The commit is now gated on either delta
and carries the real one: `trackIndexDelta` reads the drop's row change in
`selectionSlice.moveSelectedClips`' own index space (tracks sorted by ascending `index`, which
is bottom-to-top on screen), and `moveSelectedClips(deltaTime, deltaTrack)` moves every selected
clip inside one `set` with one `pushToHistory`, so the whole group is still **one undo entry** —
which is why the row half is not a second write here the way it is for a single clip.

**The group's veto is all-or-nothing**, and `canMoveSelectedClips` is what answers it, before
anything is written. Three ways a member refuses (four since ESCSUITE-82, below): its current row is not on the timeline, the
row it would land on is off the top or the bottom of the stack, or its landing spot is taken by
a clip that is not moving with it. Any one of them and the drop commits nothing — the
alternative is a group arriving with some of its clips piled against the edge of the stack,
which is what the store's own per-clip clamp (`Math.max(0, Math.min(len - 1, idx + delta))`,
left as it is: it is that action's contract and its tests pin it) would otherwise produce. A
member's **old** placement is never in the way, since the group vacates it in the same write, so
a selection sliding along its own run does not veto itself. The positions checked are the ones
that would be written, `Math.max(0, …)` clamp included, which is also what catches a group
dragged back past the start of the timeline: the clamp would stack its members, and that reads
as the overlap it is. A refused drop is **silent** — the clips spring back and no notice is
raised — which is parity with the single-clip veto one branch down, the only other drop that
can be refused; neither has ever notified, and making one of them talk is a product decision
about both. There is no audio-versus-video row check in any of this, and that is not an
omission: ARTIST's `Track` has no kind. A clip is audio because its *source* media is
(`TimelineTrack` reads `sourceMedia?.mediaType`), and any clip may sit on any track, which is
exactly what a single-clip drop allows. `useClipDrag.test.ts` holds the drag half (a same-time
group drop moving every clip, a diagonal one moving rows and times together, one Ctrl+Z
restoring all of it, and the refusals — four then, six with ESCSUITE-82's) and `store/timelineSnapping.test.ts` the arithmetic.

**A locked row takes no drop** (ESCSUITE-82). The mousedown has always refused to *start* a
drag on a locked row, but neither commit path asked about the row the clip was **dropped** on:
a clip could be dragged onto a locked track, and a selection holding a clip on a locked row
(ctrl+click adds one; the mousedown guard only sees the row of the clip the pointer holds)
could be dragged off it by a free member. `trackRefusesDrop(tracks, trackId)` in
`store/timelineSnapping.ts` — true for a locked row and for one that is not on the timeline —
is the rule the single-clip commit now asks of the row under the pointer, beside the overlap
check it already made; `canMoveSelectedClips` applies the same locked rule inline, over a Set of
the locked rows, to every member's origin row and landing row (it already refused a row that is
not on the timeline by index), so the group's veto has a fourth way to refuse. Silent, like the
other three. A rule added to `trackRefusesDrop` has to be added to that loop too. The ticket also named the ripple trim, and that half was wrong: `shiftClipsAfter`
is asked for the trimmed clip's *own* row (so is `rippleDeleteClip`'s shift), and a trim cannot
start on a locked one, so a ripple never reaches a locked row's clips — `useTrimDrag.test.ts`
pins it beside the new refusals in `useClipDrag.test.ts` and `timelineSnapping.test.ts`.

**One row never holds two overlapping clips, and four writers keep it that way**
(ESCSUITE-161, ESCSUITE-162). The invariant is what `store/clipQueries.ts`'s `getClipsAtTime`
is written against: it returns **every** clip at an instant, so a row holding two means the
preview, both exporters and `core/audioMixer.ts` draw and mix two clips from one track,
`core/exportTypes.ts`'s `getActiveTransition` (which looks for an incoming clip at
`timelinePosition >= clipEnd - 0.01`) misreads the pair, and the clip drag then refuses to move
*either* of them, because each now overlaps the other. Two writers had always enforced it and
two had not:

1. **The drop** — `useClipDrag`'s single-clip commit vetoes with `wouldOverlap`, and
   `canMoveSelectedClips` is the group's all-or-nothing version of the same question
   (ESCSUITE-80, above). Silent: the clips spring back.
2. **`duplicateClip`** — walks its row from the original's end and relocates past any
   collision, which is the precedent the paste now follows.
3. **The edge trim** (ESCSUITE-161) — `useTrimDrag.handleMouseMove` now puts the pointer time
   through `clampTrimToNeighbours` before `computeTrimUpdate` sees it, so an end trim stops at
   the next clip's start and a start trim at the previous clip's end. The clamp lives in the
   **hook and not in `trimClip`**, for three reasons: the **ripple** tool's *end* trim is
   excepted (it lengthens the clip over its neighbours during the drag and shifts them out of
   the way on release, so the overlap is real and transient) and which tool is out is something
   only the gesture knows; the store is already not where a trim's geometry is enforced, since
   the source's length and `MIN_CLIP_DURATION` are `computeTrimUpdate`'s rules too and
   `trimClip` enforces only what it owns (the locked row, ESCSUITE-84); and `trimClip` has
   exactly one caller, this hook, so a second copy of the rule there would buy no defence and
   would cost the ripple tool a flag to switch it off again. The exception is the **end edge's
   alone**: `handleMouseUp` measures the ripple shift from the clip's *end*
   (`currentEnd - originalEnd`), and a start trim never moves the end — so a ripple start trim
   shifts nothing, and leaving it unclamped left the overlap on the row for good rather than
   transiently. The clamp is applied to the **pointer time**
   rather than to the computed update, which is what keeps ESCSUITE-110's idempotence — a trim
   that wanders out past the neighbour and back comes home exactly instead of accumulating the
   clamped frames in between. Once the pointer is out past the neighbour every move computes
   the same update, so the hook's `changesClip` refuses a write of values the clip already
   holds (ESCSUITE-101's "a no-op edit refuses", applied to the one gesture that writes per
   frame) rather than rebuilding the clips array and re-rendering the timeline for no change.
4. **Paste** (ESCSUITE-162) — `pasteClips` checked that the clone's track exists (ESCSUITE-100)
   and is unlocked (ESCSUITE-84) and nothing else, so copy a clip, move the playhead into it,
   Ctrl+V and the clone landed on top of the original: the commonest keyboard path there is. It
   now lands at the playhead **or at the first spot after it where the group fits**, via
   `firstFreeGroupStart`. It **relocates rather than refusing** — `duplicateClip`'s rule, and a
   Ctrl+V that silently did nothing is the surprising answer; the two refusals beside it are
   for a paste with nowhere legal to go at all, not for one that just needs moving along the
   row. The whole group shifts together, so its members keep their offsets from each other, and
   past the last occupant every row is free, so there is always an answer (a playhead inside a
   solid run pastes at the end of that run). The ESCSUITE-100 pin that a playhead at 0 means 0
   is unchanged; its fixture clip is two seconds long now so the clone's own span is clear of
   the original's and the relocation never comes into what that test is about.

**One nanosecond of slack in `wouldOverlap`.** The two writers above aim a clip at a
neighbour's exact edge and cannot land on it in binary floating point: a clamped end trim's
end is `p + ((s + (L - p)) - s)`, which overshoots `L` in 8.0% of cases (worst observed
3.55e-15 s over 2e6 random triples), and a relocated clone's start is
`offset + (occupantEnd - offset)`, which undershoots in 3.2%. `getClipsAtTime` is half-open
and sampled, so a 1e-15 window can never be drawn; `getActiveTransition` has a 0.01 s
tolerance. But `wouldOverlap` is strict and **state-based**, so `canMoveSelectedClips` read
the miss as a collision and a group holding both butted clips refused every drag — the
ESCSUITE-161 symptom, reintroduced at epsilon scale by the fix for it, and now the *normal*
outcome of butting two clips up rather than a matter of luck. `OVERLAP_EPSILON = 1e-9` in
`store/timelineSnapping.ts` is the answer, in the shared predicate rather than as a tolerance
in each writer: a nanosecond is far below a frame and below `MIN_CLIP_DURATION` and
`MIN_SPLIT_DISTANCE`, so every overlap a user can make still reads as one, and every reader of
the invariant answers the same question.

What this does **not** do is repair a project that already holds an overlap — a hand-edited or
host-supplied `LOAD_PROJECT` timeline is taken as given, the way `parseProject` (ESCSUITE-102)
checks shape and not geometry. The four writers above are the only ways the app itself can make
one — bar one importer that places clips at times it did not choose: `addCaptionCues`
(ESCSUITE-293) keeps a caption file's cues in file order on the one Captions track, so two cues
that overlap in the file overlap on the row, by design.

**An overlap a gesture found is not one it made** (ESCSUITE-308). Such a pair broke both
gestures, because both assumed the invariant: `clampTrimToNeighbours` took the nearest clip
start past the trimmed clip's start as an end trim's limit, so the first move of a 1–10 s cue's
end handle, with a 2–3 s cue inside it, clamped the end to 2 s and a 9 s caption became 1 s
(its start handle clamped to 3 s the same way); and `wouldOverlap` read the pair as already
colliding, so `useClipDrag`'s single-clip veto and `canMoveSelectedClips`' group veto refused
every drag of either cue. The rule now: **a gesture may keep, or change, an overlap it found;
it may not make one with a clip it did not overlap.** It lives in `store/timelineSnapping.ts`
as one comparison and one set — `overlapsSpan(clip, start, end)`, the comparison `wouldOverlap`
itself now makes, and `preexistingOverlaps(clip, clips)`, the clips on the same row reaching
into `clip` by more than `OVERLAP_EPSILON` — read by all three callers. The trim clamp leaves
out any clip that reached into the trim's **origin** span (`trim.origin`, the mousedown's
snapshot; two numbers, so the per-move clamp still allocates nothing, and the other clips do
not move while a trim runs); the single-clip drag takes `preexistingOverlaps` **once, on
mousedown**, beside its snap points, and leaves those clips out of `wouldOverlap`'s candidates
at release; `canMoveSelectedClips` takes the same set **per member** from the clips it is
handed (which a drag has not yet changed) and leaves each member's out of its own candidates,
so two overlapping cues selected together move as a group and one may slide across the other.
A clip that did not overlap at the gesture's start still clamps a trim and still vetoes a drop.
**The tie falls on the touching side**, the side `wouldOverlap` puts it: a pair meeting within
`OVERLAP_EPSILON` is butted, not overlapping, and has to be — a clamped end trim lands up to
3.55e-15 s past its neighbour's start, and reading that miss as an overlap *found* would exempt
the neighbour from the clip's next trim and let it run straight over it. `wouldOverlap` itself,
the placement predicate, is unchanged. **Paste (`pasteClips`, `firstFreeGroupStart`) and
`duplicateClip` keep the strict rule**: they make clips, and a clip made now has no overlap to
have found, so each still lands in a free span. Pinned by `store/timelineSnapping.overlap.test.ts`
and, through the real hooks and store, `components/Timeline/useTrimDrag.overlap.test.ts` and
`useClipDrag.overlap.test.ts`; `timelineGestures.perf.test.ts` is byte-identical.

**A locked track is locked for every component** (ESCSUITE-84). ESCSUITE-82 closed the pointer
gestures; Delete, paste, split, duplicate, the inspector, the keyframe panel and a new clip
landing on an empty locked track did not know the row was locked. The fix is one enforcement
point: `store/trackLock.ts`'s five pure questions (`lockedTrackIds`, `isTrackLocked`,
`clipOnLockedTrack`, `anyClipOnLockedTrack`, `lockedSourceVideoIds` — no store, no React) are asked as the first statement
of a mutating action's `set` updater, and a refused action `return`s the unchanged state: no
`modified` write, no history entry. Every clip- and keyframe-slice action over a clip already on
the timeline refuses when its track is locked (`moveClipToTrack` checks both origin and target);
`addTextOverlayClip`/`addShapeOverlayClip` refuse an explicit locked `trackId` by returning
**`null`** instead of a clip, hence `Clip | null` though neither UI caller passes a `trackId`
today. `findEmptyTrack` (`projectFactory.ts`) never picks a locked track for a placement naming
none, so the media library, the overlay buttons and the ESCAPECRAFT handoff skip locked rows
without knowing "locked" exists. Selection-slice group actions are **all-or-nothing**:
`anyClipOnLockedTrack` vetoes `deleteSelectedClips`, `pasteClips` (asked about the clones' own
`trackId`, since they haven't landed — ESCSUITE-100 added a second, identically-shaped
all-or-nothing check right beside it, for a clone whose `trackId` names no track at all) and
`moveSelectedClips` as one yes/no over the whole set.
`muteSelectedClips`/`unmuteSelectedClips`, `updateTrack` and `reorderTracks` stay untouched —
track properties, not clip contents — and `removeTrack` refuses, since deleting a locked track
deletes its clips. Removing a source video used to refuse the same way, in the project slice's
own `removeSourceVideo`; since ESCSUITE-154 deleted that action (its only caller, the media
library's per-item Remove, moved to the non-undoable `removeSourceVideosPermanently`, which
trusts its caller rather than checking locks itself), the refusal lives only in
`VideoUploader.tsx` now — `lockedSourceVideoIds` is still the question, just asked by the
component instead of the store. `shiftClipsAfter` is the one guard
that is *not* the all-or-nothing question, deliberately: the shift below it only moves clips
whose `trackId` matches, so an undefined `trackId` moves nothing and the guard asks
`isTrackLocked` about the one row.

**A refused write says so** (ESCSUITE-87). ESCSUITE-84's guards were invisible to the caller:
an action that refused and an action that wrote were both `void`, and three gestures were
already threading a `skipHistory` flag through a *second* store write on the strength of the
first having pushed the undo entry. A refused first write pushes nothing, so those gestures
would hand `skipHistory` to the write that did land and leave the whole gesture off the undo
stack — one Ctrl+Z after it would then eat the edit *before* it instead. The twelve actions that
take a trailing `skipHistory` (`shiftClipsAfter`, `updateClip`, `trimClip`,
`setClipTimelinePosition`, `updateClipTransform`, `updateClipEffects`, `updateClipTransition`,
`updateClipAnimation`, `setClipKeyframe`, `moveClipKeyframe`, `updateTextOverlayData`,
`updateShapeOverlayData`) plus `moveClipToTrack` — which takes no flag but is the *first* write of
the clip drag's two-write commit — therefore return `boolean`: `true` when they wrote, `false`
when the lock guard refused (or, `shiftClipsAfter` alone, when the delta was zero and nothing
moved). ESCSUITE-88 added a
thirteenth, for the same reason at one remove: `removeClipKeyframe` threads no flag either, but
the keyframe graph's `Delete` *announces* the removal, so it has to be able to tell a refusal
from a write. Their guard moves out of the `set` updater and in front of it, reading through
`get()` the way `addTrack` already does, so the action can answer without writing; every updater
body is otherwise unchanged, and the other locked-track guards — the ones nothing threads a flag
through — stay inside their updaters as `return state`. The shared doc comment on `EditorState`
in `store/types.ts` is the contract: **`false` means no state changed and no undo entry was
pushed, and a caller passing `skipHistory` to a later write must look at it.**

A third reason a write answers `false` joined the lock with ESCSUITE-101: **nothing to do**.
`pasteClips` started this (below) refusing when a clone's track is no longer on the timeline;
`deleteSelectedClips` refuses when its selection names no clip on the timeline, or when any one
that does exist sits on a locked track; `muteSelectedClips`/`unmuteSelectedClips` refuse when
every relevant track already has the mute state being asked for; and `removeClipKeyframe` —
already on the list above for the lock — also refuses for three reasons that have nothing to do
with it: an unknown clip, a property the clip has no keyframes on, or no keyframe within
`KEYFRAME_TIME_EPSILON` of the given time. `moveClipKeyframe` got the identical three-way guard in
ESCSUITE-163 / m2 — it used to bail inside its own `set` updater for exactly those cases while
still bumping `modified`, pushing an undo entry, and returning `true`, the same "reported a write
it never made" shape `removeClipKeyframe` had before ESCSUITE-101; the check moved in front of the
`set`, mirroring `removeClipKeyframe` exactly down to reusing `KEYFRAME_TIME_EPSILON` in place of
its own hand-written `0.001`. All of them still mean exactly what `false` means
above. ESCSUITE-115 gave `removeClipFromTimeline` the same treatment: it used to filter the
clips, bump `modified` and push an undo entry for an id naming no clip, unable to say so because
it returned `void`; it now reads through `get()` the same as the guards above, refuses (`false`,
nothing written) for an unknown id — the "nothing to do" `rippleDeleteClip` already recognised
(`if (!clipToDelete) return state`) without a way to report it — and only then runs its `set`.
`useAppKeyboardShortcuts`'s Delete key follows the return the same way it already follows
`deleteSelectedClips`'s: a refusal toasts nothing, because there is nothing to announce.

ESCSUITE-172 found the same "nothing to do" gap in twelve of the thirteen actions above:
`updateClip`, `trimClip`, `moveClipToTrack`, `setClipTimelinePosition`, `updateClipTransform`,
`updateClipEffects`, `updateClipTransition`, `updateClipAnimation`, `setClipKeyframe`,
`moveClipKeyframe`, `updateTextOverlayData` and `updateShapeOverlayData` all guarded the lock but
not the id — an id naming no clip matched nothing in the `map` body, yet the `set` still ran,
stamping `modified` and pushing an undo entry for an edit that touched nothing. Each carries
`if (!clips.some((c) => c.id === clipId)) return false;` beside its lock guard, the same shape
`removeClipFromTimeline` already used — except the two overlay actions, whose guard matches their
own `map`'s bypass (id **and** `overlayType`) rather than id alone, since a real clip of the
*wrong* overlay type — a shape clip's id handed to `updateTextOverlayData`, say — is just as much
a no-op as an unknown id:
`if (!clips.some((c) => c.id === clipId && c.overlayType === 'text')) return false;` (and
`'shape'` for its sibling). `removeClipKeyframe` needed nothing — ESCSUITE-101's `hasMatch` check
already answers `false` for a clip the `find` doesn't locate.

ESCSUITE-250 added the "nothing to do" arm to `updateTextOverlayData`: when every field in the
patch already equals the clip's `textData` value it answers `false` with no history entry, so
finishing an inline edit without changing the text, or a burst whose only edit is a no-op,
pushes nothing.

A review round found the same defect in two more places, neither one of "the thirteen actions
above" because both used to return `void`: `updateClipBlendMode`, whose one caller
(`useClipEditorActions.ts`'s `handleBlendModeChange`) is a plain callback rather than a gesture and
needed no change when its return type gained the ESCSUITE-87 boolean alongside the same guard; and
`clearClipKeyframes`, which — unlike every sibling above, `splitClip`/`duplicateClip` included —
carried no existence guard of *any* kind. It now refuses for the same two reasons
`removeClipKeyframe` does: an unknown clip, or a clip that exists but carries no animation at all.
`clearClipKeyframes` has no production caller today, so this closes a latent gap rather than a live
bug.

The real caller that reaches the live bug: `Preview/useCropHandleGesture.ts`'s unmount-mid-drag
teardown flushes a pending crop write after its clip has left the timeline some other way, with the
handles still mounted; `updateClip`'s refusal is what keeps that flush from spending an undo entry
on nothing, and `CropHandles.test.tsx` pins it directly rather than relying on the store test alone.

`hooks/useGestureHistory.ts` is the one mechanism that does. `createGestureHistory()` (and the
`useGestureHistory()` that holds one per component) is `begin` / `resume` / `end` / `commit`,
two booleans in a closure and no state or subscription of any kind: `commit(write)` runs one
store write, hands it the flag the gesture owes it, and — if the write reports it did not land —
takes the "already pushed" mark back, so the gesture's entry follows the first write that **does**
land. All three gestures that used to keep that bit themselves now share it:
`ClipEditor/useSliderGesture.ts` exposes `commit` in place of its old flag getter and keeps only
the six DOM listeners (a key `repeat` maps to `resume`, which continues a gesture without
forgetting that it pushed), `Preview/useTransformHandles.ts` commits inside the throttled
updaters exactly where it read the flag before, and `Timeline/useTrimDrag.ts` inside its
`if (update)`. The contract is `hooks/useGestureHistory.test.ts`; each hook's own suite adds the
end-to-end case of a row locked under an open gesture and unlocked mid-way, and the entry riding
the write that landed.

A fourth joined it later than the others, and later than it should have: **the keyframe graph's
own diamond drag** (`KeyframePanel/KeyframeGraph.tsx`'s `handleMouseUp`, ESCSUITE-163 / M1). A
diagonal drag that changes a keyframe's time *and* its value used to call `onKeyframeMoved`
synchronously and `onKeyframeValueChanged` inside an uncancelled `setTimeout(…, 0)` — two writes,
neither `skipHistory`'d, so two undo entries. One Ctrl+Z put the value back and left the keyframe
at its **new time**, the exact ESCSUITE-79 shape the clip drag was fixed for, and the deferral
itself was dead weight: both writes are synchronous zustand `set`s, so there was never anything
to wait for — only a race the fix removes outright. `handleMouseUp` now opens a `useGestureHistory`
gesture, `commit`s the move first and reads whether it landed, and `commit`s the value — at the
keyframe's **new** time if the move landed, or its original time if there was no move at all —
only when it did; a move the store refuses (a locked track) leaves the value untouched rather than
writing it at the time the drag never actually reached. Covered end to end by
`KeyframePanel.test.tsx`'s "moves a keyframe in time and value together as a single undo entry"
(one push, one undo restoring both halves) and at the component level by
`KeyframeGraph.test.tsx`'s "dragging keyframes" suite.

The keyframe graph's keyboard is the other caller that had to read the answer.
`KeyframePanel/hooks/useKeyframeGraphKeyboard.ts`'s two nudges called the host and then
unconditionally announced the new value into the live region and moved the active option and the
selection to the new time. On a locked track the store refused and the announcement was a lie —
"Opacity 49% at 1.00 seconds" for an edit that never happened — while the selection walked off
to a time no keyframe occupied, leaving the next key acting on nothing. `onKeyframeMoved` and
`onKeyframeValueChanged` are therefore `=> boolean` all the way up through `KeyframeGraph`'s
props to `KeyframePanel`'s two handlers, which hand back what `moveClipKeyframe` /
`setClipKeyframe` answered (and `false` when there is no selected clip to write to), and each
nudge returns early on a refusal. Silent, like every other refusal the lock produces, and the
key stays swallowed because the graph still owns it.

The clip drag is the exception that proves it, because its two writes are not a `commit` loop
but one `if`/`else`: `if (movedTrack && !moveClipToTrack(...)) { }` — the row refused, so
`Timeline/useClipDrag.ts` commits **nothing**. Moving the clip in time on its *old* row would be
a half-drop nobody aimed at, and one carrying `skipHistory` for an entry that was never pushed.
The clip springs back, silently, like every other refused drop.

Refusal is **silent** in the store, like every pointer veto. Five components read the lock to
say something anyway.

The **inspector** disables each section's *contents*, never the panel. `useClipEditorActions`
exposes `trackLocked: boolean` on demand (a plain `track?.locked` read, no new subscription) and
`ClipEditor.tsx` hands it to every section; `CollapsibleSection` takes `disabled` and wraps that
section's children in one `<fieldset className={styles.sectionBody} disabled>`, with its header
toggle and its `footer` slot outside. One fieldset around the whole panel was the first shape
and was wrong three ways: `.container` is the flex column that supplies the gap between the
sections, so a single fieldset child collapsed that gap on **every** clip's inspector, locked or
not; the section headers are `<button>`s, so on a locked clip the four sections that default
closed could not be opened and read at all; and it killed the two controls that are reading
rather than editing. Those two stay live — Actions' "Go to" moves the playhead (that section
therefore puts the flag on its own Duplicate and Split buttons and hands `CollapsibleSection`
nothing) and Animation's "Open Keyframe Editor" opens a panel (it renders through `footer`).
Transform's header "Reset" writes the transform and sits outside the fieldset in `headerRight`,
so it carries the flag itself, as does `ClipEditorHeader`'s delete button; the header also
renders a plain `<p>` — not a second status region — "Track locked — unlock it in the timeline
to edit this clip".

The **media library** (`VideoUploader.tsx`) asks `lockedSourceVideoIds` and disables the
per-item Remove button (`title="Used by a clip on a locked track"`), ahead of ever calling
`deleteVideo` — the one place left that checks this question at all, since ESCSUITE-154 deleted
the store's own `removeSourceVideo`, which used to refuse the same thing a second time.
Per-item Remove, Clear Unused and Clear All are now all the same shape: `deleteVideo` first, a
non-undoable `removeSourceVideosPermanently` write after, never the other order. Clear All
(ESCSUITE-142) is the bulk form of Clear Unused — per id, `deleteVideo` over the editor's own
`sourceVideos`, skipping a source a locked track's clip still uses the same way Clear Unused
already skips it by never counting an in-use source "unused" — and neither button, nor the
per-item Remove, makes an undoable write: a storage clear deletes bytes from IndexedDB itself,
so it is not an edit, and undoing it must not be able to hand a source back whose bytes are
already gone (ESCSUITE-149, extended to the per-item button by ESCSUITE-154). All three collect
the ids whose `deleteVideo` actually succeeded and hand them to `removeSourceVideosPermanently`
once — a batch of one for Remove — rather than removing a source from the store before its
delete is confirmed; a rejected `deleteVideo` leaves the tile in place for all three, instead of
the per-item button's old behaviour of dropping it from the store regardless. The Clear All
button itself disables when there is nothing it could touch — an empty library ("Nothing to
clear") or every source locked-in-use ("Every file is on a locked track") — rather than a
live-looking control that does nothing when clicked (ESCSUITE-142 review, MAJOR 1); when it is
enabled, its loop re-derives the locked set fresh from the store before each id's own delete, not
the render-time snapshot the click closed over, so a track locked while an earlier id's delete is
still in flight cannot cost a later id its bytes (MINOR 3). A per-id failure does not stop the
ids after it, and is reported once, by count, through the notice channel rather than the console
alone, with the storage meter refreshed in `finally` alongside the permanent-removal write, so a
partial failure still leaves it current (MINOR 2) — Clear Unused's own `finally` was aligned to
the same order a review round later (ESCSUITE-149 review, NIT 2): it used to refresh only on the
loop's clean-success path, so a mid-loop failure left the meter stale even though the ids before
the failure were still permanently removed. Clear All and the per-item Remove can both take
clips with it — every clip that referenced a cleared source — so each one's confirm copy says
so: Clear All's stays the fixed "including any clip that still uses it", but Remove's names the
actual count (ESCSUITE-154) — `Remove this video?` alone when nothing on the timeline uses it,
and otherwise `Remove this video? This will also remove N clip(s) that use(s) it.` with the
singular/plural chosen correctly at N=1. Both confirms end with ESCSUITE-268's cross-tab sentence
too (ESCSUITE-330) — Clear All's "Another open editor tab could still be using them." before
"This cannot be undone.", Remove's "...could still be using it." — because the bytes are shared
by every editor tab: a second tab holding the same take kept its clip, and its next WebM export
drew nothing for it and reported "Export complete!" (ESCSUITE-311 O-U2). That export now refuses
by name (`SOURCE_MISSING`, see `elementFrames.ts` above); the sentence is the warning before the
bytes go. Any of the three that leaves the project holding no
source and no clip (`holdsNoWork`, `store/projectFactory.ts` — the same predicate as the
autosave's `isEmptySession`) also empties this tab's saved session slot through the autosave's
`clearSession`, a required prop `App` hands `VideoUploader` and `VideoLibrary` through
`MediaLibrarySidebar` (ESCSUITE-307): the autosave never writes an empty project over the slot, so
without it a reload offered back the snapshot naming the sources the clear had just deleted. A
clear that leaves anything — a source on a locked track, a text clip, a source still in use — leaves
the slot alone.

**An import is not an undo step either** (ESCSUITE-244) — the same fact as the clears, in reverse.
`addSourceVideo` is called after the bytes are already in the shared `videos` store
(`processMediaFile`, the `?loadVideo=` and `LOAD_VIDEO` paths, the session restore, a project
file's sources), and undo cannot un-write them. While the add was undoable, Ctrl+Z took the source
out of the library, the next edit pruned the redo branch, and the row stayed in IndexedDB with
nothing able to list or free it: Clear All and Clear Unused iterate the project's library only
(ESCSUITE-142, on purpose, because the database is shared with ESCAPECRAFT), ESCAPECRAFT lists only
recordings, and the only remaining way to free the space was clearing site data, which also deletes
every ESCAPECRAFT recording. So `addSourceVideo` pushes no history entry — but that alone is not
enough, because **every snapshot in `history.past` / `history.future` holds its own copy of
`sourceVideos` and undo/redo replace the live library with it wholesale**: a snapshot taken before
the import would, on the next undo or redo that lands on it (an unrelated older edit, say), drop
the source and strand its bytes just the same. So the add reaches backwards, the exact inverse of
`scrubRemovedSources`: `graftAddedSource(history, video)` (`storeHistory.ts`) makes the source
present in **every** past and future snapshot (a snapshot that already holds the id has it
replaced in place; one that does not gets it appended; a stack with nothing to change comes back
as the identical object). What it guarantees is narrower than "every snapshot holds every live source": an add leaves
no snapshot — past or future — without the added source, and says nothing about a source that
entered the live library another way (undoing a `resetProject` can leave a future snapshot
without a live source, and redo then drops it again). Two properties follow on purpose: undoing an edit made *before* an import keeps the import in
the library, and an import made while a redo branch exists neither clears that branch (an import
is not an edit, so it must not discard the user's redo) nor is dropped when the branch is redone.
The ESCSUITE-113 rule runs first in the replace arm (the revoked handle is scrubbed out of the
stack), then the graft puts the live entry in. The way to take an import out is the library's
Remove, which deletes the bytes and scrubs the stack. Imports therefore join per-item Remove,
Clear Unused / Clear All, `setSourceThumbnail`, the project load's `clearHistory()` (ESCSUITE-164)
and the session restore's as writes that never sit on the undo stack. **Nothing deletes bytes on
undo or redo**: the redo branch can hold a source another snapshot still references, and a stored
row may belong to a project open in another tab. Storage orphans from before ESCSUITE-244 are not
swept on load; the media library offers them on a click instead (ESCSUITE-268, next paragraph).

**Files from earlier sessions** (ESCSUITE-268). Rows ESCSUITE-244 came too late for — an import
undone and then edited past, in any session before it — are still in the shared `videos` store,
listed by neither app. `VideoUploader.tsx` shows them beside Clear Unused / Clear All as one line,
"N files from earlier sessions (X MB)", with a Remove button, only when N > 0. The set is
`core/orphanedImports.ts`'s `orphanedImports(rows, projectIds)`: every `getAllVideoMetadata()` row,
minus every id the editor can still reach (`editorSourceIds` — the live library **and** every
undo/redo snapshot, because New Project is undoable and the project it replaced still owns its
bytes while that entry is on the stack), minus every source **any saved session slot** names
(`listSessionStates()` — each tab's own slot since ESCSUITE-274, plus the legacy shared row if one
is left: the app keeps a slot on purpose while the live project does not hold its sources — under
`?suppressRestore=1`, after a restore that failed, or for a tab that crashed — and its next restore needs
the bytes; review M1), minus every `source === 'recording'` row whatever its age,
minus every row whose `takeId` is a recording's id or a recording's `takeId` (a take's companions,
even one whose primary has gone). X is `totalBytes`, the rows' stored `size` — the byte length of
the blob each ARTIST writer stored beside it, the figure Clear Unused and the tiles already show.
The list is read when the panel mounts and again after Clear Unused, Clear All and this Remove —
never on render (the uploader suite pins one `getAllVideoMetadata` call across re-renders) and
never as a sweep. A row the project claims after the read (a session restore landing after the
panel mounted) is dropped from the list during render and stays off it until the next read, so a
per-item Remove of that source later — which deletes the bytes first — cannot put a dead row back
on the line. The confirm is `Remove N files imported in earlier sessions (X MB)? Another open
editor tab could still be using them.`, because "not referenced by this editor" is not
"unreferenced": another tab's project, or a `.veditor` that embeds the bytes, may still want them.
Deleting is Clear All's shape — per id `deleteVideo` (bytes and thumbnail), a failure caught per id
and reported once by count (`Could not remove N file(s) from storage`), the meter refreshed — with
each id re-checked against the live store **and every saved session slot** just before its delete, so a
project load or an autosave landing mid-loop keeps what it claimed (a re-check that cannot read the
session counts as a failed delete, never as a pass). One removal runs at a time: a click while one
is still awaiting does nothing (a ref guard). The button's accessible name says what it removes —
`Remove N file(s) from earlier sessions` — rather than a bare "Remove". These rows are not in the project, so nothing writes the store or
the undo history.

`removeSourceVideo` — the per-id, undoable removal `removeSourceVideosPermanently` was modelled
on — is gone (ESCSUITE-154): the per-item Remove button was its only caller anywhere in the app,
and moving that button to the non-undoable action (so undo could no longer hand back a tile with
no bytes behind it — the same defect ESCSUITE-149 had already fixed for the two Clear buttons)
left it with none. `removeSourceVideosPermanently` does not reproduce its locked-track refusal —
it was never all-or-nothing on a lock the way `removeSourceVideo` was, trusting every caller to
filter locked ids out of its own loop first, which the media library (the only caller) already
does.

**The media library's motion and type scale** (ESCSUITE-4). The upload progress bar's
`.progressFill` pulses opacity 1 → 0.5 → 1 forever while a file is `'processing'` — a real
progress bar it is not, since the fill is already full width — and an unconditional
`animation: pulse 1.5s ease-in-out infinite` ran for a viewer who had asked the OS for reduced
motion (`grep -rn "prefers-reduced-motion" apps/ packages/` found nothing anywhere else in the
repo either). `VideoUploader.module.css` now adds `@media (prefers-reduced-motion: reduce) {
.progressFill { animation: none } }` *beside* the unconditional declaration, rather than only
scoping the `@keyframes pulse` rule itself under `(prefers-reduced-motion: no-preference)` —
an unscoped, merely-unreferenced `@keyframes` would still leave the computed `animation-name`
reading `pulse`, and it is the explicit `animation: none` override that makes it read `none`.
A finished upload's row used to pop out of the list outright, 2 s after `'complete'`, with no
transition; `.uploadItem` now transitions `opacity` (`var(--transition-normal)`), the row is
given `removing: true` (`.uploadItemRemoving { opacity: 0 }`) for one more
`UPLOAD_ROW_FADE_MS` (200ms) before `VideoUploader.tsx`'s removal timer actually drops it from
`uploads`, and `.uploadStatus` — the "Processing...", "Complete" and error text, which had no
accessible announcement of any kind — now carries `role="status"` (an implicit
`aria-live="polite"`, so no separate `aria-live` attribute is needed beside it). Separately,
the library's six ad-hoc font sizes between 8px and 13px — `.mediaTypeBadge` at 8px,
`.storageInfo` and `.storageClearButton` at 10px (plus the unused, `display: none`
`.dropZoneHint`, also 10px), `.videoMeta` at 11px and `.videoName` at 13px — are now a small
scale: badge and per-file metadata at 11px, the storage row at 11px, small buttons/controls at
12px, and the filename stays the scale's largest size at 13px. `.mediaTypeBadge`'s padding is
trimmed from `1px 4px` to `1px 3px` alongside the font bump (review round 1, QUALITY-2): it is
`position: absolute` with only `bottom`/`right` set inside the 64x36px thumbnail, which has its
own `overflow: hidden`, so nothing but the badge's own box size keeps it off the thumbnail's
left and top edges — an `overflow: hidden` ancestor hides a box that spills past it rather than
stopping it from spilling. Nothing else in the sidebar (`ResolutionPicker.module.css`,
`App.module.css`) was already below 11px, so the floor holds across the whole panel. Pinned by
`VideoUploader.test.tsx` (`role="status"`, and the fade's `removing` class surviving the first
2000ms of the removal timer before the row actually leaves) and, end to end, by two
`apps/e2e/tests/accessibility/core.spec.ts` cases: "the upload progress animation turns off
under reduced motion and stays on without it" reads the compiled `.progressFill` class name
straight out of the loaded stylesheet and asserts a probe element wearing it computes
`animation-name: none` under `reducedMotion: 'reduce'` and `pulse` under `'no-preference'` in a
second browser context — deliberately not timing-dependent on catching a real upload's brief
`'processing'` window, which review round 1 found a first version of this test could miss
entirely and silently pass without checking anything (QUALITY-1); and "no library text is
smaller than 11px, and the media-type badge stays inside its thumbnail" uploads an inline 1x1
PNG (the cheapest media kind that renders a `.mediaTypeBadge` at all — a plain video gets none)
and asserts every leaf text node in the sidebar is at or above 11px and the badge's bounding box
lies entirely within its thumbnail's.

The **keyframe panel** (ESCSUITE-88, see "Keyframe Panel" above): `KeyframePanel` derives
`trackLocked` from the whole-store read it already does and threads `locked` down to
`KeyframeTrack`, `KeyframeGraph` and `useKeyframeGraphKeyboard`. A plain `<p>` under the title
bar — "Track locked — unlock it in the timeline to edit keyframes" — every pointer edit refused
at mousedown rather than snapped back on release, the easing `<select>` disabled, and an edit key
announcing "Track is locked" while every reading key still works.

The **preview**: `useTransformHandles`' `handleDoubleClick` asks `clipOnLockedTrack` before
opening the inline text editor — it already subscribes to both `clips` and `tracks`, so the
question costs nothing — because the editor would otherwise open and then lose every keystroke
to `updateTextOverlayData`'s refusal, silently. Since ESCSUITE-88 `handleMouseDown` asks the same
question: a press on a locked clip **selects** it (so the inspector can show it and say why it is
read-only) and returns there — no `gestureHistory.begin()`, no drag state, nothing bound to the
window — and `getCursor` reads `not-allowed` over it, in the hover branch and in the `dragState`
branch, the latter for a row locked *mid-gesture*. Marquee selection on empty canvas is
untouched.

**A clip on a hidden track takes no chrome, no hit and no cursor either** (ESCSUITE-178) — a
different rule from a locked track's, not the same one: a locked clip is still drawn and still
picked, just inert, where a hidden clip is not in the picture at all. See "And they come and go
with the picture, not just with the playhead", earlier in this section (crop mode's own
`cropTarget`), for the one rule it shares with `selectionOverlay.ts`, `hitTest.ts` and
`dragGeometry.ts`'s marquee.

The **track header** (`TrackHeader.tsx`): the delete button is `disabled`,
`title="Unlock the track to delete it"`. `useAppKeyboardShortcuts.ts` does the same on-demand
read before its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace
on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — and toasts "Track is locked" instead of calling
the action and letting the store swallow it silently. ESCSUITE-88 closed the limit this ticket
stated: the keyframe panel and the preview's transform handles, which used to let the user try
and show nothing, now both refuse at the gesture's start and say so (the two paragraphs above).
The toolbar's Delete button was the last of them, and ESCSUITE-91 closed it: one **boolean** selector
(`anyClipOnLockedTrack(clips, tracks, selectedClipIds)`, so the toolbar re-renders only when the answer
flips and `Toolbar.rerender.test.tsx`'s pin holds) disables the button and titles it `Track is locked`
while the selection touches a locked track; Mute and Unmute stay live, since a track property is not what
the lock freezes. Every surface that can edit a clip now shows the lock before the store has to refuse.

The one documented exception is the colour swatches
in `MaskSection` and `ShapeSection`: an OS picker reports continuously too, but it opens on the
press and reports after the release, so a pointer gesture does not bound that interaction and
these listeners would not help it.

Two things in here will surprise the next reader, and both are preserved on purpose.
**`CollapsibleSection` owns nothing but its own open/closed flag, which it seeds from
`defaultOpen` at mount and never re-reads** — so whether a section is open survives a
re-render, and which section a given `{condition && <CollapsibleSection/>}` slot maps to is
decided positionally by React. That is why the conditions that show and hide these sections
stay where they are in `ClipEditor`, in the order they are in: moving one would hand its
open/closed state to a different section. **And Transform has two Reset buttons that mean
different things.** The one in the section header resets position, scale and opacity *and* an
overlay's own coordinates, but leaves rotation alone (`handleResetTransform`); the one beside
Fit to Canvas spreads `DEFAULT_TRANSFORM` wholesale — rotation and `scaleLocked` included —
and only exists when the clip has a source video (`handleResetToDefaults`). The only thing
that tells them apart in the DOM is that the second carries a `title`, which is how
`ClipEditor.test.tsx` distinguishes them.

**A paste can refuse for a second reason now, and the playhead default was wrong (ESCSUITE-100).**
`pasteClips` placed its earliest clone at `state.currentTime || minPosition + 0.5` — `currentTime`
is never undefined, so that `||` only ever fired for a playhead sitting at exactly 0, and treated
it as "no playhead": Home, then Ctrl+V, pasted a clip copied from 3s at 3.5s rather than 0. Paste
now always lands at the playhead, 0 included, with every other clone keeping its offset from the
first. Its clones also keep the clipboard's `trackId`, and that track can be gone without the lock
ever being involved — deleted by `removeTrack`, or swapped out from under an existing clipboard by
a project load — so `pasteClips` reads the current tracks through `get()` and refuses whole,
writing nothing, when any clone's `trackId` names none of them; the same all-or-nothing shape as
the lock check beside it. That guard is meant to be a rare belt-and-braces check rather than the
normal path: `removeTrack` and the project slice's `removeSourceVideosPermanently` now prune the
clipboard themselves — an entry naming the track (or the source) they just removed is filtered out in the
same `set`, before `pasteClips` is ever asked, the way the source removal already dropped every
clip that used it. `pasteClips` moved out of its `set` updater and into the `get()`-then-`set()`
shape `moveClipToTrack` uses, so it can answer `false` without writing at all — ESCSUITE-87's
boolean contract, one more action added to the list — and `useAppKeyboardShortcuts`'s Ctrl+V
branch toasts "Nothing to paste here" on that `false`; its own pre-check still catches a *locked*
target and toasts "Track is locked" before the call, so this is what catches the case the
pre-check can't see, a target that isn't on the timeline at all.

**A clip that leaves the timeline leaves the selection too, and a no-op write says so
(ESCSUITE-101).** `store/selectionPrune.ts`'s one pure question, `pruneSelection(clips,
selectedClipId, selectedClipIds)`, is asked wherever a clip can leave the timeline some way
other than the id a caller happened to pass it: `removeClipFromTimeline` and `rippleDeleteClip`
generalise their old `selectedClipId === clipId ? null : …` ternary to the whole selection —
dropping `clipId` from `selectedClipIds` too, which neither used to do; `splitClip` prunes the
original (now-retired) id from `selectedClipIds` while still explicitly selecting the first half,
its existing contract; `removeTrack` and the project slice's `removeSourceVideosPermanently`
prune the selection beside the clipboard pruning ESCSUITE-100 already added, same shape, same `set`;
`undo`/`redo` prune against the clips *being landed on* (`previous`/`next`, not the state being
left), because an undo or a redo can restore a clip list that no longer holds an id the selection
names; and `setProject` (ESCSUITE-115) prunes against the *incoming* project's clips — it replaces
the whole project, a different clip list wholesale, and project load, `LOAD_PROJECT` from a host
and session restore all go through it, so a selection from the project being replaced used to
outlive it as a ghost. `pruneSelection` returns the SAME `selectedClipIds` Set (and the same
`selectedClipId`
value) when nothing needed dropping, so a caller spreading its result into a `set()` update
triggers no re-render over an unchanged selection — the property `trackLock.ts`'s five questions
have and this one needed too, since every one of these actions already writes on every call.

The bug this closes: paste selects the clip it just placed; Ctrl+Z removes it from the timeline
but used to leave the selection alone; Delete then found a selection naming a clip that was
already gone, deleted nothing, and — because `deleteSelectedClips` and the others in this
paragraph never asked whether there was anything to delete — pushed an undo entry anyway. That
entry cleared the redo stack the Ctrl+Z had just built and left `history.past` one entry longer
for an edit that never happened, so the next Ctrl+Z appeared to do nothing. Three actions close
the other half of ESCSUITE-87's contract for the same reason: `deleteSelectedClips` now answers
`false` and writes nothing when the ids it finds among `selectedClipIds` all name no clip on the
timeline (belt-and-braces, the same shape as `pasteClips`'s "track no longer on the timeline"
check — pruning running everywhere else means a ghost should rarely reach here at all) or when
any one of the ids that DO still exist sits on a locked track (`anyClipOnLockedTrack`,
all-or-nothing, ESCSUITE-84, unchanged); `removeClipKeyframe`
answers `false` for an unknown clip id, a property the clip has no keyframes on, or a time with
no keyframe within `KEYFRAME_TIME_EPSILON` (exported from `utils/animation.ts` for exactly this
question) — the three ways it used to push an undo entry that removed nothing; and
`muteSelectedClips`/`unmuteSelectedClips` answer `false` and write nothing when every track a
selected clip sits on already has the mute state being asked for (Mute on an already-muted
track was an entry that undid nothing), writing only the tracks that actually change — and
leaving the rest as the same object, not a same-value copy — when some but not all of them do.
`useAppKeyboardShortcuts`'s Delete branch reads `deleteSelectedClips`'s answer and only toasts
"N clip(s) deleted" on `true`: a selection of ghosts refuses silently, like every other refusal
the lock produces, rather than announcing a deletion that did not happen.
