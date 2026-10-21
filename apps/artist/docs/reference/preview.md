<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Preview (`src/components/Preview/`)
`PreviewPlayer.tsx` is wiring only — store subscriptions, the `<canvas>`, and a thin
`drawFrame` that sizes the raster and delegates. Everything it used to do
inline lives in one module each, all of them pure or hook-shaped; the pure modules, the hooks and `PlaybackControls.tsx` have their own test files, while `drawFrame.ts` and `cursor.ts` are covered through the component tests:

| Module | Owns |
|--------|------|
| `drawFrame.ts` | Compositing one frame: track order, transitions, overlay clips and the blur scratch canvas. It knows nothing about the legacy overlay arrays — they are overlay clips by the time any project reaches the preview |
| `previewGeometry.ts` | Where a clip is on the canvas (`getOverlayBounds`), which clips can be manipulated, the one object-fit: contain mapping between the canvas' pixels and its element's (`contentBox`, `getCanvasPosition`), and the inverse rotation every box test shares (`toLocalPoint`) |
| `hitTest.ts` | What is under the pointer: which clip, which handle, which drag it would start. One cascade (`hitHandlesOnClip`) serves both passes — keyframe mode asks it for the selected clip alone, body included; outside it the same cascade runs handles-only before the z-order body pass |
| `selectionOverlay.ts` | Drawing the selection chrome — bounding box, the eight resize handles, the rotation handle, multi-select boxes |
| `dragGeometry.ts` | The maths of a drag in progress: start measurements, resize/rotate deltas, marquee intersection, text hit for the double-click |
| `transitions.ts` | Which transition, if any, is active at a given time |
| `cursor.ts` | The CSS cursor a drag mode advertises |
| `types.ts` | The shapes the above share (`DragMode`, `OverlayBounds`, `HandleHit`, `PreviewSceneContext`). **Types only** — it is excluded from coverage, so a single runtime value in it would go unmeasured |
| `InlineTextEditorAnchor.tsx` | Positioning `InlineTextEditor` over the text it edits, through the canvas' object-fit mapping |
| `CropHandles.tsx` | The eight on-canvas crop handles (ESCSUITE-157), mounted over the canvas only while crop mode is open, **the playhead is on the clip** and **the clip's track is visible** (ESCSUITE-171) — the one `visibleCropTarget` answer the chrome gates on, so handles and dim come and go together, and with the picture; the mouse drag and the arrow-key nudges both land through `useCropHandleGesture.ts`. Positioned off the same `getOverlayBounds` every other reader of a clip's box uses, under the same ESCSUITE-147 transition suppression (its optional `transition` prop). The gesture and the keyboard nudges are documented beside `CropSection.tsx`, further down |
| `PlaybackControls.tsx` | The transport buttons and their keyboard shortcuts (Space, the arrows, Home, End — bound on `window` here, not in the App cascade); no canvas at all. Takes `modalOpen`, the same gate the App cascade carries, so Space cannot start playback from behind a dialog |
| `PreviewTimecode.tsx` | The playhead readout `<span>` — the only thing that re-renders on a playback tick (see below) |

Hooks:

| Hook | Owns |
|------|------|
| `usePreviewMedia.ts` | One object URL and one `<video>`/`<img>`/`<audio>` per source, reconciled as the timeline changes and released on unmount |
| `usePreviewRenderLoop.ts` | When the canvas repaints: the rAF playback loop, seek-driven redraws, the debounced redraw after a media change, the one paint when a paused frame's video decodes its first frame (ESCSUITE-264); also the display-time publish/subscribe pair the timecode reads (below) |
| `useTransformHandles.ts` | The pointer state machine — drag/resize/rotate, marquee, double-click into the text editor — and the cursor it reports. A press on a clip whose track is locked **selects it and starts nothing** (no `gestureHistory.begin()`, no drag state, no window listeners), and the cursor over it is `not-allowed` — ESCSUITE-88, see "A locked track is locked for every component" below |

**The canvas backing store follows the size it is displayed at, not the project's.**
`previewGeometry.previewRaster(project, box, devicePixelRatio)` computes it: the *contained*
box (the letterboxed rectangle `object-fit: contain` would draw into, so the raster keeps the
project's aspect ratio and never needs its own letterbox maths) times `devicePixelRatio`,
capped so it never exceeds the project's own resolution (a small project in a large box is
never rasterised sharper — or slower — than the project itself), falling back to the project
size before the first `ResizeObserver` callback fires. `PreviewPlayer` tracks the box in a
ref (not state — resizing it is imperative, and re-rendering the subtree on a window drag
would cost real work for nothing) and only ever assigns `canvas.width`/`.height` when the
computed size actually changes, because assigning either clears the canvas and resets all
context state. Everything in this directory still computes in **project pixels** — nothing
in `previewGeometry`, `hitTest`, `selectionOverlay`, `dragGeometry` or `drawFrame`'s draw
calls changed coordinate systems. The one thing that carries project space onto the raster is
`drawPreviewFrame` opening every frame with `openOutputFrame(ctx, projectSize, canvas)` —
**`core/outputTransform.ts`, shared with both exporters since ESCSUITE-94** (see the Export
section) — which sets `ctx.setTransform(k, 0, 0, k, 0, 0)` and clears the raster in one step.
`k` is read back off the canvas' actual backing store (so it can never disagree with a resize
that hasn't been redrawn yet).

`ctx.filter` is the one thing the transform does not reach: a CSS filter's length (a blur
radius) is in output-bitmap pixels, unaffected by the CTM. Left alone, every blur in the
preview would render `k`× too wide at any raster smaller than the project. `MediaDrawOptions.filterScale`
(default `1`) converts a project-space blur radius into device pixels at every `ctx.filter` site on the preview's draw
call sites. **Since ESCSUITE-94 an export passes it too** — it was written for the preview, on the
belief that an export's canvas is always its own project, which the resolution presets disproved —
so it is `1` only when the output raster *is* the project, and a 4px blur of a 720p project comes
out `blur(6px)` in a 1080p export.
`devicePixelRatio` is read at draw time, not subscribed to, so moving the window
to a different-DPI display re-rasterises only on the next resize or edit, not immediately.

**The selection chrome is a constant size on screen** (ESCSUITE-90). `HANDLE_SIZE` (8) and
`ROTATION_HANDLE_OFFSET` (25) are screen pixels, not project pixels, so
`drawSelectionHandles` / `drawMultiSelectHandles` and `hitTestHandles` / `hitHandlesOnClip`
all take a final **`screenScale`** — project pixels per CSS pixel — and multiply by it every
constant that is a screen size: the handle squares and the 80% side handles, the rotation grip
and its offset above the box, `lineWidth`, and the dash arrays. Positions (corners, edges,
centre) are the clip's own geometry and never scale, and the body hit test is untouched. A 4K
project in a 700px preview drew ~1.5px handles before this; it now draws 44-project-pixel ones,
which are the same 8px under the pointer as a 720p project's.

**Crop mode draws its own chrome instead** (ESCSUITE-157), and its handles are
DOM buttons rather than canvas squares — so they are sized in CSS pixels
directly and take no `screenScale` at all. The one thing that chrome scales is
the pen: `drawCropOverlay` takes the same `screenScale` and multiplies its
`lineWidth` by it. See the crop-mode paragraphs further down in this Preview
section (`cropOverlay.ts`, `CropHandles.tsx`).

`screenScale` defaults to **1** — the right answer for a canvas that *is* its own screen (both
exporters, the headless bundle, the unit tests that build one) and for the preview before its
first `ResizeObserver` callback — so every caller that passes nothing behaves exactly as it did.
The preview's two callers get the real number, each from a measurement it already had and
**neither by reading layout again**: the draw callbacks from `1 / contentBox(canvas,
displayBoxRef.current, canvasDimensions).scaleX` (`contentBox` is pure arithmetic over the rect
it is handed, and the box is the one the observer above already reports, so no frame forces a
reflow), and the pointer path from `getCanvasPosition`, which carries the content box' `scaleX`
out on its result — the hit test wants `1 / scale`, and asking for it separately would mean a
second `getBoundingClientRect` per pointer move for a number that call had already computed.
It is derived at draw time and held in no state.

**A text overlay's canvas font names a generic fallback family** (ESCSUITE-253).
`core/fontStacks.ts` is the single source of the inspector's family list (`FONT_OPTIONS`, whose
`value` is what `textData.fontFamily` stores, so saved projects are unchanged) and of the
`FONT_STACKS` table mapping each to a CSS list (`Georgia, 'Times New Roman', serif`, `Impact,
'Arial Black', sans-serif`, ...). `textFontString(textData)` builds the canvas `font` string for
`canvasRenderer.ts` (the preview and both exporters), `previewGeometry.ts` and `dragGeometry.ts`
(the measurements), and `InlineTextEditor` takes `fontStackFor(family)` for CSS, so all readers agree
and a machine without the font lands on the nearest generic. An unknown family (a hand-edited
project) becomes `<family>, sans-serif`, quoted when it has a space. The kit image installs
metric-compatible fonts for the same reason; see its README.

**A left/right-aligned text overlay's box is rotated about the text's anchor, not its own
centre** (ESCSUITE-128). `core/canvasRenderer.ts` draws a text overlay by translating to its
anchor — `textData.x`/`.y`, the point `fillText` is issued at — rotating, then translating
back, so the glyphs pivot around that anchor regardless of alignment. Left/right alignment
means the anchor sits at the run's edge rather than its centre, so `getOverlayBounds` shifts
the reported box by `±textWidth / 2` — but that offset has to be rotated along with the box
(`anchor + R(rotation)·(offset, 0)`) rather than added before rotating, or the box drawn by
`selectionOverlay.ts` and read by `hitTest.ts` and `dragGeometry.ts` (all three take their
`centerX`/`centerY`/`rotation` from this one function) drifts away from the drawn text as
rotation grows — a full half-width off at 90°. Centre-aligned text is unaffected: its anchor
and centre already coincide, so the offset is zero either way.

**A keyframed clip is opaque to the pointer, not invisible to it** (ESCSUITE-3). Outside
keyframe mode a clip carrying custom keyframes has no live handles in the one handle pass that
runs there — RESTRICTION 2 in `hitTestHandles` passes `skipKeyframed: true` to `hitHandlesOnClip`
for the selected clip's own handle pass (`hitTest.ts:179`), since it is only movable from the
keyframe panel; the keyframe-mode pass passes `false` there on purpose (`hitTest.ts:147`), which
is how a keyframed clip's handles stay live once its own panel is open — but `hitTestHandles`'
second pass (the z-order body test over every clip, outside keyframe mode) no longer `continue`s
past it the way it used to. It reports the same `{ clipId, clipType, mode: 'move' }` any other
clip's body would, at the clip's **animated** position for the current time (`getOverlayBounds`
already evaluates `getAnimatedValues` for this, with no `suppressPreset`). A bare `continue`
there used to let the click fall through to whatever clip was on the track below, or, with
nothing behind it, start a marquee whose release deselected everything. `useTransformHandles.ts`'s
`handleMouseDown` and `getCursor` are what turn that body hit into a refusal, reusing
ESCSUITE-88's shape verbatim: `geometry.hasCustomKeyframes(clip) && !isKeyframeMode` selects the
clip and starts nothing — no `gestureHistory.begin()`, no drag state, no window listeners — and
the cursor reads `not-allowed`, exactly as a clip on a locked track does. `isKeyframeMode`
(`keyframePanelOpen && clip.id === selectedClipId`) is the exemption: inside keyframe mode, for
the clip the panel has open, a drag is how a keyframe gets set, so it is not refused there.
`getCursor` runs on every pointer move, so it finds the hit's clip once and hands it to both
checks — `isTrackLocked(tracks, clip.trackId)` and `hasCustomKeyframes(clip)` — rather than
having each repeat the lookup `hitTestHandles` already did to produce the hit (ESCSUITE-3 review
round 1, NIT-4; `handleMouseDown` already had the clip in hand and needed no change).

A keyframe-mode drag can only **start** while the playhead sits inside the clip —
`hitHandlesOnClip`'s own `currentTime < clip.timelinePosition || currentTime >= clipEnd` check
gates the handle that begins it — but nothing stops the playhead moving outside the clip
*mid*-gesture, since `currentTime` is read from the store fresh on every move rather than frozen
at mousedown: pressing Space mid-drag walks it off either end, since only `handleMouseDown`
guards on `isPlaying`, not `handleMouseMove`. `handleMouseMove`'s `applyChange` refuses the write
outright once `currentTime - clip.timelinePosition` falls outside `[0, clip.duration]` — both
ends, past the clip's start and past its end alike, each with its own test — rather than writing
a keyframe at a time nothing on the clip's own timeline can be scrubbed back to (ESCSUITE-168).
This is the one keyframe-time computation in the app that refuses rather than clamps — every
other add path clamps to the clip's edge instead (`useKeyframeGraphKeyboard.ts`'s
`addAtPlayhead`, `useKeyframeDrag.ts`'s `pixelsToTime`) — because those paths derive their time
from the keyframe panel's own geometry (the playhead relative to the clip, a pixel inside the
graph), which has nowhere further out to go; a drag's `currentTime` can leave the clip by any
amount, and clamping it to the nearest edge would write a keyframe at a time the user's pointer
was never near. The refusal is silent on purpose, not an oversight: the chrome the drag is
moving is gated on the same bounds (`selectionOverlay.ts` draws no box or handles, and the clip
itself is not drawn, at a time it does not span), so by the time a write is refused there is
nothing left on screen for a notice to explain, and nothing freezes.

No `suppressPreset` outside a transition is not the same as "a hit test is never inside one" —
the preview does draw transitions, and the pointer works during them. The renderer suppresses
one preset side per side of an active transition (`core/canvasRenderer.ts`), and at the time of
this ticket `getOverlayBounds` had no way to be told, so inside a transition the hit box, the
selection chrome, the marquee and the drag seed could all disagree with the drawn frame. That
was ESCSUITE-147's gap; it applied to every clip carrying a preset before this ticket and to
keyframed ones too. ESCSUITE-147 has since closed it: the readers take the active transition as a
trailing option and evaluate under the same suppression the renderer uses (see "The chrome and
the picture agree through a transition" below).

**A fully transparent clip does not catch the click, and a keyframed clip's selection chrome
matches its picture** (ESCSUITE-155, closing two gaps the ESCSUITE-3 review left open). The body
test used to be geometry only — `getOverlayBounds` never reads opacity — so a clip animated to
`opacity: 0` was still picked rather than clicked through, the same way a clip with a static
`transform.opacity: 0` always was, hiding whatever was drawn underneath from the pointer entirely.
`hitTestHandles`' z-order loop now calls `previewGeometry.ts`'s `getClipOpacity(clip, currentTime)`
and `continue`s past a clip whose evaluated opacity is exactly `0` before it ever reaches
`getOverlayBounds` — `0.01` is still clickable, so this is "invisible", not "faint". A clip with
no `animation` reads its static `transform.opacity`; one with an `animation` reads
`getAnimatedValues`' interpolated value at the clip-relative time, falling back to the static value
outside the clip's duration — the same condition `getOverlayBounds` already branches on for
position, so the two cannot disagree about what is actually on screen. Opacity lives on
`ClipTransform` for every clip kind — a text or shape overlay's own `textData.opacity` /
`shapeData.opacity` fields are never read for drawing — so `getClipOpacity` needs none of
`getOverlayBounds`' per-kind base-transform substitution.

And `selectionOverlay.ts`'s `drawSelectionHandles` no longer declines to draw anything at all for a
keyframed clip outside keyframe mode. The `hasCustomKeyframes(selectedClip) && !keyframePanelOpen`
early return the ESCSUITE-3 review's MINOR-4 flagged is gone: a keyframed clip selected by its body
hit now shows the same full box and handles any other selected clip does, at its **animated**
position — the same `getOverlayBounds` call the hit test uses, so the chrome and the hit box agree
too — simply inert, the way a locked track's chrome already was (that function has no `tracks` in
its context and so never could distinguish a locked clip's chrome from an unlocked one). The
asymmetry the review named — a keyframed selection showing in the inspector and on the timeline row
but nowhere on the canvas — is closed.

At the time of this ticket a hit test inside a transition could still disagree with the drawn
frame (ESCSUITE-147's gap): `getOverlayBounds` had no way to be told which preset side an active
transition had suppressed, and `getClipOpacity` read the full, un-suppressed opacity for a clip
mid-transition. ESCSUITE-147 has since closed both — `getClipOpacity` takes the same trailing
`{ transition }` and evaluates under `presetSuppressionFor`, so a clip a transition is fading in
reads as opaque and stays clickable.

**The playhead position does not re-render the preview, the timeline body, or `App`.**
`usePreviewRenderLoop` used to hold it as `displayTime` state and call `setDisplayTime` every
animation frame — a React render (and a forced layout) fifty times a second so a timecode
readout could change three digits. It is now a ref plus a tiny publish/subscribe pair:
`publishDisplayTime(time, immediate?)` writes the ref and notifies listeners, throttled to
≤10 Hz except at a scrub, a loop-back, or the end of the timeline, where `immediate` publishes
without waiting so the readout never lags the value it is meant to show.
`PreviewTimecode.tsx` is the only subscriber — one `<span>` using
`useSyncExternalStore(subscribe, getTime, getTime)` — so a playback tick now re-renders one
`<span>` at most ten times a second instead of the whole preview subtree at fifty.

The timeline's own playhead follows the same shape, one level up, because `Timeline.tsx`
was not the only thing re-rendering on the store's throttled 200 ms `currentTime` write —
`App.tsx` subscribed to it too and re-rendered `<Timeline/>` regardless of what `Timeline`
itself did. Both were fixed: `Timeline.tsx` no longer reads `currentTime` at all — the
playhead position lives in `TimelinePlayhead.tsx` and the "0:00 / 1:30" readout in
`TimelineTimeReadout.tsx`, each `React.memo`'d and each subscribing to the store itself, so a
playback tick re-renders only those two small components. `App.tsx` no longer holds a
`currentTime` selector either; its four handlers that used the live render value (razor split
at the playhead, add marker, set in/out point) read `useEditorStore.getState().currentTime`
on demand inside the handler instead, and the debounced session-autosave effect (which
depends on `currentTime` to know when to re-arm its debounce, deliberately not on every
render) now does that via a `useEditorStore.subscribe` listener added inside the effect
rather than through a render-triggering dependency.

**Two more subscriptions were found in round 2, and both are gone the same two ways.**
`Toolbar.tsx` held a `currentTime` selector that no rendered element read — only three
handlers (add marker, set in point, set out point) — which is `App.tsx`'s case exactly, so
those three now read `useEditorStore.getState().currentTime` inside themselves and the
component subscribes to nothing per tick. `useClipEditorActions` held one whose value *was*
rendered, so it took the leaf shape instead; see the ClipEditor section. Measured on the
`preview-playback` benchmark by paired alternation, three rounds per arm, the toolbar fix
alone is **−9.1% of the renderer's task duration** (1037.55 → 942.62 ms, ranges disjoint)
with the rendered fps pinned at the 60 fps vsync ceiling in both arms — after round 1 this
scene has no frame-rate headroom left to show a win in, so anything further shows up as work
not done, never as frames. `Toolbar.rerender.test.tsx` pins the contract at ≤1 render over ten
ticks (it measures 0), with one `act()` per tick: batch the ten writes into one `act()` and a
re-introduced selector costs one render and slips under the ceiling. Round 2's write-up is
[docs/performance/2026-09-13-timeline-profile.md](../../docs/performance/2026-09-13-timeline-profile.md).

A scrub's seek check in `usePreviewRenderLoop.ts` works **per `<video>` element, and a
source has one element per live clip** (ESCSUITE-313). `usePreviewMedia` keeps each source's
own element in `videoElementsRef` and, slot 1 onwards, `extraVideoElementsRef`: the k-th
clip of a source live at the playhead (track order, then a transition's incoming side —
`core/elementSlots.ts`; kept per clip while it stays live, below) uses that source's k-th
element, made by `previewVideoForSlot` over the same URL the first time a scrub or playback
needs it, kept while the source is used and emptied with it. Before, two live clips off one
source — a picture-in-picture arrangement, the same clip duplicated on two tracks, a split
clip crossfading into itself — shared one element and both drew whichever seek won; earlier
still, a per-clip seek loop also painted twice for one move. The desired time is collected
into a `Map` keyed by element, then each element is compared and seeked at most once; the
ESCSUITE-264 readiness listener and the ESCSUITE-275 `seeked` counter iterate the same
elements. During playback both elements play — and both sound, as the export's mix has them —
and a transition's incoming side, which has not started, is held paused on its first frame on
its own element, positioned once when the transition begins (`holdIncoming`); a timeline with
no transition on it skips that lookup on every frame, decided once per playback run. The crop
chrome's dim pass (`PreviewPlayer`'s `cropElementFor`) reads the cropped clip's slot from the
same assignment, so the second of two live clips of one source dims over its own moment.

**In the preview a live clip keeps its element for as long as it stays live** (ESCSUITE-323).
The exporters' rule (`assignElementSlots`) is stateless — slot k is the k-th live clip of the
source in track order, worked out afresh every frame — and that is right for them: they seek
every element every frame, so a slot that moves when a clip starts costs at most one extra seek
on a path that seeks anyway. A preview element is a *playing* playhead, though, and two cases
moved a clip that had not changed onto another element, which then had to seek — a visible
stall: a picture-in-picture of one recording whose lower clip starts after the upper one (the
lower clip is first in track order, took slot 0, the upper clip's playing element, and pushed
the upper clip onto a second one), and a split clip crossfading into itself (at the cut the
incoming side, held paused on its first frame on slot 1 by `holdIncoming`, became live, took
slot 0 — the outgoing side's element — and seeked, so the hold was wasted). The preview
therefore asks `createStickySlotAssigner()` (`core/elementSlots.ts`): a clip keeps the slot it
was given for as long as each assignment names it — live at the playhead, or a side of the
running transition, so the outgoing side keeps its element until the transition ends and a held
incoming side keeps the one it was held on — and a newcomer takes the lowest slot of its source
no remembered clip holds, so a first assignment agrees with the stateless rule exactly. Its
state is a `Map` of clip id to source and slot, allocated only when a clip appears; `assign`
otherwise clears and refills the caller's map. The render loop owns the one assigner and writes
one shared map, `elementSlotsRef` (created by `PreviewPlayer` and passed to both): the paused
scrub and readiness effects, the playback loop (when the set of live clips changes, and when
`holdIncoming` first holds an incoming side — each naming the running transition) all assign
into it, and the frame's draw (`PreviewFrameMedia.slots`) and the crop chrome read it, so all
of them agree on which element a clip is. `drawPreviewFrame` holds no state: it draws by the
`slots` it is handed, which are required. The assigner is reset only when the project
(`project.id`) changes, before the effects assign again. It is deliberately **not** reset when
the element set (`videoUrlsKey`) changes, nor when playback stops: a slot names an element by
index — the source's own, or its k-th further one, made lazily by `previewVideoForSlot` —
resolved afresh on every lookup, so a remembered slot can never bind an element that is gone (one
that does not exist yet is skipped for that frame, as before); and every assignment forgets each
clip it does not name, so a clip that left takes its slot with it. Re-packing on either would
move a picture-in-picture's two clips onto each other's elements: paused, both would seek; playing,
nothing re-seeks the live clips until the live set changes, so the next assignment — the
crossfade hold, say — would swap the two clips in the map and the draw would show each from the
other's playing element for the rest of the fade (the review round's finding, pinned). Pinned by
`elementSlots.test.ts` (the frame sequence U → L,U → L → L,N gives U 0, L 1, L 1, N 0, and the
transition's two sides), by `usePreviewRenderLoop.test.ts` ("keeps the upper clip on its playing
element when a clip of its source starts below it", "keeps a split clip's crossfade incoming side
on the element it was held on, past the cut", "seeks neither element of a paused
picture-in-picture when the element set changes", "keeps a playing picture-in-picture's slots
across an element-set change into a crossfade" and the project-change reset), and by
`PreviewPlayer.slots.test.tsx` (the mounted preview draws, and the crop chrome dims, each clip
from the element the loop's slots name).

The lifetimes differ: the preview's further elements are kept for as long as the source
is on the timeline, an export's until the export ends — neither frees one when its clips stop overlapping.

**A paused frame repaints once when its video decodes its first frame** (ESCSUITE-264).
`isDrawableVideo` (in `drawFrame.ts`) accepts a `<video>` at `readyState >= 1` — metadata, not
yet a frame — so a paint that lands before a freshly created element (a clip just added, its
source just loaded) has decoded anything draws nothing over the black fill. Playing, the next
animation frame repaints; paused, nothing did, and the canvas stayed black until the playhead
moved. In `apps/e2e/tests/escapeartist/preview-first-paint.spec.ts` (Chromium) the first paint
stayed black in 2 of 20 headless runs and 1 of 20 headed before the fix (plus 2 headed step runs
that failed at their frame-0 check, also a first paint); 0 of 90 runs after, headless and headed.
`usePreviewRenderLoop.ts` now has a readiness effect: while paused, every element the frame
draws — the clips at the playhead **and the transition's incoming clip**, which has not started
yet and so is not among them — that is below `HAVE_CURRENT_DATA` gets one `{ once: true }`
`loadeddata` listener that paints the frame once, and its cleanup takes every listener still waiting off when the clips, the playhead,
the elements (`videoUrlsKey`) or playback change — so a clip that left before its video was
ready is never painted for, and an element already ready gets no listener at all.
`loadeddata` rather than `requestVideoFrameCallback`: `loadeddata` is tied to the readiness
state itself — the first time the element reaches the `HAVE_CURRENT_DATA` the paint lacked, once
per load, in every engine — where rVFC is tied to presentation to the compositor, which an
engine may throttle or skip for these elements, never inserted in the document. It adds no
paint per frame — `drawFrame.perf.test.ts` and `preview-playback`'s rAF count are untouched.
**A step or scrub ends on a paint after the last `seeked`** (ESCSUITE-264, ESCSUITE-275): the
scrub effect paints once at once (over whatever frame the elements show) and again, through one
`requestAnimationFrame`, when the **last** element it is waiting for reports `seeked`, with the
300 ms fallback painting once if any of them has not by then; a `seeked` after the fallback, or
after a newer cycle replaced this one, paints nothing, and the cleanup cancels a final paint
already asked for. It waits per *element*, with a counter rather than a list: every element it
seeked this run, plus any still `seeking` from a run the new one replaced (that run's listener went
with its cleanup, and the element already reads the target, so the paint after its seek would
otherwise be lost). Before ESCSUITE-275 "the first `seeked`" was literal — with two elements
seeking at once (picture-in-picture, a transition's two sides, the incoming one of which was not
listened to at all) the one that finished second kept its pre-step frame while paused. The
"every run after a frame step" in the ESCSUITE-264 report was the transport's one-second step on a
one-second fixture: from 0 s it lands on 1.0 s, the clip's own end, where no clip is active and
black is the correct frame; the probe steps a two-second source for that reason.

**An element created while paused is seeked to the playhead** (ESCSUITE-275). The scrub effect
also runs when the element set changes (`videoUrlsKey`), so a `<video>` created while the
playhead's source time is not 0 — a source restored by undo mid-clip, a project or session
opened with the playhead off 0, a frame step pressed before the element existed — is seeked
like a playhead move, instead of showing its source's first frame until the playhead moved (and
ESCSUITE-264's readiness paint reliably painting that wrong frame). An element already within
0.05 s of its target is left alone, so an unchanged element costs one comparison and no seek. On
such a run the immediate paint is the media-change effect's, 50 ms after any change of the set,
so an arrival paints once as before, plus once after its seek if it needed one — and a run where
the playhead moved in the same render as the set changed gets its first paint 50 ms late, the
trade for that. An element both unready and off the playhead gets the readiness paint and the
seek paint, both at the same playhead time and the seek asked for before either event fires: if
its `seeked` lands within the 300 ms fallback, whichever of `loadeddata` and `seeked` comes last
paints the frame at the target (`usePreviewRenderLoop.test.ts` pins both orders); past the
fallback the late `seeked` paints nothing, and the `loadeddata` paint is the backstop. That a
browser applies a seek made at `HAVE_NOTHING` as the default playback start position — after
metadata, before the first frame's data — is the spec's order, not measured in a real browser.

**Loop-back seeks nothing itself** (ESCSUITE-129). `loopStart` is a timeline time; a media
element's own position is `clip.startTime + (loopStart - clip.timelinePosition)`, which is
only equal to `loopStart` by coincidence, for a clip that starts untrimmed at timeline 0. The
loop-back branch in `usePreviewRenderLoop.ts`'s `animate()` used to assign `loopStart` straight
to every `<video>`/`<audio>` element's `currentTime` — wrong for a trimmed clip or one that
doesn't start at 0, and clamped to the last frame for a source shorter than `loopStart`. It now
only pauses each element and clears `lastActiveClipIds`, which was already happening right
after — that forces the very next frame's `clipsChanged` branch, which already computes
`clip.startTime + clipTime` per clip, to do the seeking, so a loop never touches the wrong
position even for one frame.

**A loop region shorter than one frame does not loop** (ESCSUITE-246). With loop playback on and
the in and out points on the same time (the I and O keys pressed at one playhead position, the
commonest way to get one), every animation frame was already past the out point, so `animate()`
jumped back to the in point and wrote `setCurrentTime(loopStart)` once a frame — about sixty
store writes a second, every subscriber re-running — while the preview stayed "playing" and
nothing moved. The loop-back arm now runs only when `loopEnd - loopStart >= MIN_LOOP_LENGTH_S`
(`1 / 60`, one frame at the fastest rate the preview targets, a module constant in
`usePreviewRenderLoop.ts`); a shorter region falls through to the end-of-timeline arm, which
pauses the elements, calls `setIsPlaying(false)` and writes the region's out point once
(`loopEnd`, which is the timeline's end when the loop is off, so that arm is unchanged for it).
No notice: the play control is left to the user. The comparison sits inside the
`newTimelineTime >= loopEnd` branch, so it costs nothing on an ordinary frame. An inverted pair
(`outPoint < inPoint`) would stop the same way, but the store cannot hold one —
`setInPoint`/`setOutPoint` swap on a cross and every writer goes through them — so there is no
arm for it. The same comparison also covers a loop with no in/out points over a timeline shorter
than a frame.

**Playback started in a gap plays on from the next clip** (ESCSUITE-280). With the playhead
between clips, the playback effect in `usePreviewRenderLoop.ts` used to write the next clip's
start to the store and return without starting the animation loop; `currentTime` is not one of
that effect's dependencies, so nothing started it later, and the transport showed Pause with
`isPlaying` true and the playhead frozen on the next clip's start. Space, the Play button and a
playhead drag released in a gap during playback (ESCSUITE-246) all reached it. The effect now
sets the loop's start timeline time to that clip's start and falls through into the loop in the
same run, on the loop's own clock — the jump is not a store write that re-runs the effect. The
store still gets the jumped-to time once, so the timeline playhead moves; nothing is active at
the start yet, so the loop's first frame starts the clip's media through its `clipsChanged`
branch, which seeks each element to its source time. With no clip after the gap, playback stops
at the end of the timeline as before.

**A pause lands on the frame the preview was showing** (ESCSUITE-281). The loop writes the
store's `currentTime` only every 200 ms of playback, and the playback effect's pause branch
writes no position, so Space, the Pause button and a grab of the playhead (ESCSUITE-246) used to
resume from up to 200 ms plus a frame behind the readout. The loop now keeps the time of the last
frame it drew in a local (one number assignment a frame, no allocation) and publishes it to the
store once, in the playback effect's cleanup — the one path every pauser goes through. Not from
the pause branch: a pause that comes with a seek (a ruler click, Home, a step, a marker) writes
`setIsPlaying(false)` and its target in one batch, and drawing or writing the playback position
there raced it. The cleanup writes only when the store says playback has stopped (so an edit
that restarts the effect mid-playback, or an unmount, writes nothing) **and** no seek has
happened since the loop's own last write — a seek keeps its target. A loop-back counts as the
loop's write, and a pause between it and the next frame lands on the in point the readout shows.
The end of the timeline is unaffected: that arm wrote the end itself, which is not the loop's
last throttled write, so the cleanup leaves it.

**A seek is told from a plain pause by a count, not by the value** (ESCSUITE-287). The store has
two writers of `currentTime`: `setCurrentTime` is the render loop's own (its 200 ms writes, the
loop-back, the gap jump, the end of the timeline, the pause write above) and counts nothing;
`seekTo(time)` (`store/playbackSlice.ts`) is everyone else's — the ruler and track clicks and a
marker flag (`useTimelineSeek`), a playhead scrub (`usePlayheadDrag`, whose dependency is named
`seekTo` and which `Timeline` fills with the store's), the transport's Home/End/←/→ and their buttons (`PlaybackControls`),
the clip preview's scrub (`KeyframePanel`), "Go to clip" (`useClipEditorActions`) and a session
restore — and adds one to `seekSequence`. It writes the time as given (every caller already
clamps to its own bounds) and pushes no undo entry. The two marker jumps (Shift+M, Ctrl+M) and
`resetProject` write the playhead inside their own `set`, and add one too. The loop reads the
count when it starts and again at each of its own writes, and the pause write needs it unmoved:
re-reading at each write, rather than only at the start, is what lets a seek made mid-play
without a pause (a marker jump) — which the loop's next 200 ms write overwrites — leave a later
plain pause landing on the frame shown. The value check (the store still holds the loop's last
write) stays beside the count, and must: the loop's own stop arms — the end of the timeline, and a
loop region shorter than one frame — call `setIsPlaying(false)` and `setCurrentTime(loopEnd)`
without counting a seek, and only the value check keeps the cleanup from overwriting `loopEnd`
with the earlier frame time (`usePreviewRenderLoop.test.ts`'s "stops at the end of the timeline
when loop playback is off" pins it). It also catches any other write that bypasses `seekTo`.
Before this, a seek to the value
the store already held — Home or ← within the first 200 ms of playing from 0, a marker on the in
point clicked within 200 ms of a loop-back, a marker on the jumped-to clip's start within 200 ms
of a gap jump, New Project in the first 200 ms — looked like a plain pause and landed on the
frame time instead. Cost: one `getState()` per 200 ms write, nothing per frame. Because the cleanup runs before the scrub effect in the same commit, the scrub
effect's run for that render would seek every video back to the stale throttled position and
paint it before the write's own re-render corrected it; it now returns when the store's
`currentTime` no longer matches its render's, leaving the paint to the run that follows. The
pause transition costs one store write (`drawFrame.perf.test.ts`'s 480 ms window, which ends in
a pause, counts it), and nothing per frame beyond the assignment.

**The preview draws through `core/canvasRenderer.ts`**, the same renderer an export
uses, with `PREVIEW_DRAW_OPTIONS` (in `drawFrame.ts`) for the difference that is the
preview's alone: `quiet` (not-yet-decoded media is ordinary mid-scrub, and this frame
redraws sixty times a second, so the exporter's one warning per frame would be a console
flood), plus `filterScale` when the frame is rasterised at other than 1:1. Never fork a
drawing function for the preview — if the two need to differ, that is another draw option.
`MediaDrawOptions` once carried `uncachedAnimation`, which skipped the export's animation
memo cache; that cache is gone (see the keyframe section above) and so is the option. It
also once carried `resetFilter`, which made a clip with no blur of
its own assign `filter = 'none'`. That cancelled the blur a dissolve had just set on the
context, so the preview's dissolve never blurred while an export's did. The preview stopped
passing it, and the option is gone: a clip with no blur now leaves the context's filter
alone in both pipelines.

Interactive overlay manipulation in the preview canvas:
- **Drag**: Move overlay position (updates `x`, `y`)
- **Resize handles**: 8 handles (corners + sides) for scaling (`scaleX`, `scaleY`)
- **Rotation handle**: Circular handle above overlay for rotation
- **Keyframe mode**: When keyframe panel is open, transforms create keyframes at current playhead time
- Selection handles follow animated values during playback

**One undo entry per gesture, captured before the first write.** A drag makes many store
writes — one per animation frame through the throttled updaters, or two to four per mousemove
when the keyframe panel is open — and all of them belong to one edit. `useTransformHandles`
gives the gesture a single history entry by passing the store actions' `skipHistory` flag
(`updateClipTransform`, `updateTextOverlayData`, `updateShapeOverlayData`, `setClipKeyframe`)
on every write **except the first**: every write runs through `commit` from the shared
`hooks/useGestureHistory.ts` (ESCSUITE-87, below), which hands out `false` once per gesture and
`true` thereafter, and it is called inside the updater the throttler runs — not at the
mousemove that scheduled one — because a frame's moves coalesce into a single write and
"first" has to mean the first write that actually reaches the store. Since ESCSUITE-87 it means
the first write that **landed**: a write the store refuses hands the push back. `handleMouseUp` only
flushes the pending update and clears the drag state; it must not write anything of its own.
It used to, un-flagged, as the gesture's one push — but `pushToHistory` snapshots the state it
is *handed*, so a push at release recorded the already-moved clip and undo after a drag landed
back on the position the drag had just produced. A press released without a move writes
nothing and so pushes nothing.
