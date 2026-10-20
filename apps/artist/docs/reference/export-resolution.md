<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Export Resolution (`src/core/outputTransform.ts`, `src/core/exportTypes.ts`)

**The exporters draw in project pixels and one transform per frame puts them on the output
raster** (ESCSUITE-94). `core/canvasRenderer` sizes a media clip as its native source pixels
times its scale and positions it as a fraction of the frame, and the two exporters' overlay
loops place text and shapes the same way — so the numbers those calls take are **project**
pixels, not the canvas'. The canvas is whatever size the chosen resolution asked for. Nothing
joined the two spaces until this ticket, so Export → Advanced → Resolution was wrong at every
setting but its default: a 1080p export of a 1280x720 project drew the clip at `0, 0, 1280,
720` in a 1920x1080 frame (pillar/letterboxed in black) and a 480p one drew it at `-213, -120,
1280, 720` in an 854x480 frame (cropped). "Project" was right, which is why it survived.

`openOutputFrame(ctx, project, output)` is the whole mechanism, and the preview calls it too —
it was the preview's inline `setTransform`, lifted rather than copied, because a drawing
behaviour one pipeline has to remember to reproduce is a behaviour that drifts. It delegates the
matrix to `setOutputTransform` — `ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY)` —
then clears the raster to black and returns the scale, which is also the
frame's `filterScale`. `projectToOutputScale` is `Math.min` of the two ratios, so **a frame is
never stretched**: what a rounding disagreement can leave is a sub-pixel bar, never a crop. A
degenerate project (a zero resolution, which the store never writes but a hand-built headless
request could) scales by 1 rather than dividing by zero.

**The letterbox mechanism stays, but nothing reachable produces it any more.** Where the output
aspect differs from the project's, the project rect is fitted inside the raster, centred, and the
leftover is black bar. The clear is the *whole raster expressed in project coordinates* rather
than the project rect, so one fill paints the picture's ground and its bars together. A
resolution preset no longer produces that case beyond sub-pixel rounding, because `getResolution`
derives a preset's width from the **project's** aspect: preset height is fixed (1080/720/480, and
since ESCSUITE-34 also 360 — which only the GIF format offers, see "GIF Export"), width is
round-to-even(height x project aspect), and `'project'` stays exact. It used to take the
aspect from `getBaseDimensions` — the bottom clip's source — so a 16:9 project whose bottom clip
was 4:3 exported 960x720 for "720p". Only a caller with no project resolution at all falls back
to the source aspect, the same fallback `'project'` itself takes — and that fallback is used by
both the output size and the project's own drawing space together, so the two can never disagree.
There used to be a fourth option, `'original'`, whose output *was* the bottom clip's source size
regardless of the project's own shape — the one case that could produce a real, deliberate
letterbox, and one the export dialog never offered (only a hand-built headless job spec could
reach it). ESCSUITE-111 dropped it rather than fix it: every resolution left in
`ExportOptions['resolution']` ties its output aspect to the project's, to no more than
rounding — about one output pixel of bar, never a real letterbox — and `core/outputTransform.test.ts`
still exercises the mechanism itself directly with hand-built, genuinely mismatched sizes. That
one-pixel bar is `getResolution`'s own round-to-even step, not a fallback: 480p of a 1280x720
project is 854x480 (853.33 rounded up to the nearest even width), and 854/1280 (0.66719) is not
quite 480/720 (0.66667), so `projectToOutputScale`'s `Math.min` leaves a third of an output pixel
of bar on each side even with a project resolution given throughout — pinned at the exporter
level by `exportWebM.test.ts` / `exportMP4.test.ts`'s "leaves a sub-pixel bar..." case. A job spec
that asks for `resolution: 'original'` is now a validation error (`services/headless-artist`'s
`parseJobSpec`), not a silently-accepted value.

`ctx.filter` is the one length the transform does not reach, so both exporters pass
`MediaDrawOptions.filterScale` now (see the Preview section, where it was born). That needed
`drawMediaWithFrame` and `drawTransitionWithFrames` to take `MediaDrawOptions` as well — the
comment on the latter saying "an export's canvas is always its own project" was exactly the
premise this ticket falsified.

**Nothing else composites.** `workers/decodeWorker.ts` decodes and holds frames; it has no
canvas at all. The compositing is in
`exportWebM.ts` and `exportMP4.ts` and nowhere else, which is why two call sites were the whole
fix (since ESCSUITE-34, WebM's half of it lives in `elementFrames.ts`, which `exportWebM.ts` is
the first caller of — still one composite per pipeline). The headless kit drives these same
exporters through `window.__renderProject`, so it gets the fix for free — including the
manifest, which `headless/renderProject.ts` sizes with the same `getResolution`.

**The exporters draw media and overlays in one interleaved track-order pass, the same pass
`drawFrame.ts` draws for the preview** (ESCSUITE-124). Both exporters used to draw every media
clip first (in track order), then the active transition, then **every** overlay clip afterwards
— sorted among themselves but unconditionally on top of all media, regardless of the overlay's
own track index. The preview was never wrong: `drawPreviewFrame` sorts every active clip
(media and overlay together) by track index and draws that one list top-to-bottom, so an
overlay on a lower track than a video is exactly as hidden behind it as the video is opaque, and
a blur shape (`shapeBlursBackground`, which samples "the canvas so far") only ever blurs the
media actually below it. An export disagreed on both counts: an overlay parked on an empty
track under a full-height video — reachable with no deliberate effort, since
`findEmptyTrack` (`store/overlaySlice.ts`) hands a new overlay the first track with *no* clips
at all, which is often one under existing video — was invisible in the editor and visible, on
top, in the file; and a blur shape one track below a video blurred that video too, the opposite
of both exporters' own "blur overlays only affect content below them" comments. The fix is the
same shape in both: `activeClips` (`getClipsAtTime`'s result, already track-sorted) is looped
once, branching on `clip.overlayType`, instead of split into a media pass and a hoisted overlay
pass. The transition itself still draws where it always did in both pipelines — after that one
loop — which already matched the preview and needed no change; only the interleaving of media
and overlays within it did. The ruling that decided the direction: the preview is what the user
arranges the timeline by, so it is the two exporters (and the headless bundle, which shares them
for free) that had to be made to match the preview, not the reverse.

**The incoming side's animation is clamped to the same clip time as its frame (ESCSUITE-133).**
`drawTransition` and `drawTransitionWithFrames` (`core/canvasRenderer.ts`) each draw two sides
per frame, and the incoming side's clip time used to be `currentTime - incomingClip.timelinePosition`
with no floor — negative for the whole transition whenever the incoming clip's `timelinePosition`
is at or after the outgoing clip's end, which is the ordinary case for two clips placed back to
back on one track (the same-track case `getActiveTransition` looks for first). The frame drawn
underneath was already clamped in that case (`exportMP4.ts`'s own frame fetch falls back to
`incomingClip.startTime`, the clip's first frame, whenever its unclamped source time would be
negative); the animated opacity/transform/blur was not, so the two halves of the same draw
disagreed about which instant of the clip they were showing. `getIncomingClipTime`
(`core/exportTypes.ts`) is the shared clamp — `Math.max(0, currentTime - incomingClip.timelinePosition)`
— both functions call now, so the preview and both exporters (which draw a transition's incoming
side through these same two functions) can't drift apart on it. Its own doc comment is explicit
about what this does and does not change: `interpolateKeyframes` already floors any time at or
before a property's first keyframe to that keyframe's own value, so a `fade` in-preset (whose
first keyframe sits at time 0, value 0) reads as opacity 0 whether the clip time handed to it is
0 or -0.5 — clamping fixes the inconsistency, not that preset's own opacity during the overlap.

**A transition owns the entrance of its incoming clip and the exit of its outgoing clip
(ESCSUITE-139).** ESCSUITE-133's last sentence above named what it deliberately did not fix, and
this is it: a clip with its own `fade` in-preset, sitting on the incoming side of a `fade`
transition, was faded *twice* — once by the transition (the whole point of it) and once by its own
preset, which reads opacity 0 for the entire overlap when the incoming clip's clip time is the
clamped 0. The arriving picture stayed invisible until the transition was over, and then snapped
in. The outgoing side had the mirror of it: its own fade-out multiplied the transition's, so the
departing picture vanished early, and a `blur` or `scale` preset on either side compounded the
same way (every property the preset drives, not opacity alone). The ruling: **while a clip is the
incoming side of an active transition its in-preset is treated as complete (steady state), and
while it is the outgoing side its out-preset is treated as not started. The clip's own keyframes
still apply, and a preset outside a transition window is untouched.**

There is still exactly ONE evaluation path. `getAnimatedValues` takes an optional sixth argument,
`AnimatedValuesOptions`, whose only member is `suppressPreset?: 'in' | 'out'`; the suppressed
side's generator is simply not called, and `NO_PRESET_KEYFRAMES` (one frozen `{}` for the module)
stands in for its output, so the merge below leaves that property's track to the other preset and
to the clip's own keyframes. Leaving a side out **is** the steady state the ruling asks for, with
no invented values and no second interpolation routine: every in-preset's LAST keyframe and every
out-preset's FIRST keyframe already hold the clip's base transform/effects. It composes with
ESCSUITE-125's clamps for free — the generator that would have clamped is the one not being
called.

The renderer says which side it is drawing through `TransitionModifiers.suppressPreset`
(`core/exportTypes.ts`), the one field there that is not geometry. `transitionSideModifiers` in
`core/canvasRenderer.ts` is where it is set — `'out'` for the outgoing side, `'in'` for the
incoming — written onto whatever object `transitionModifiersFor` leaves behind (or the frames
pipeline's `crossfade` fallback, or `{}` for the element pipeline's draw-untouched case), because
the suppression applies to a side of *any* active transition including a type with no geometry of
its own. Mutating that object is free and safe: both producers build a fresh one per call, so a
transition frame still allocates exactly the one modifiers object per side, and
`animatedValuesFor` maps the field onto one of the two frozen `PRESET_SUPPRESSION` option objects
(in `utils/animation.ts` since ESCSUITE-147, shared with the preview's geometry) rather than
building a literal per draw. `drawClipToCanvas` and `drawImageToCanvasWithModifiers`
read it and pass it on, which is why the fix reaches the preview and both exporters at once and
why a **non-transition** draw — which passes no modifiers at all — cannot be affected.

The compositing order is untouched: the incoming clip is still skipped by the ordinary track-order
pass (in `drawFrame.ts` and in both exporters — ESCSUITE-124's one interleaved pass) and drawn only
as the transition's own side, so nothing double-draws. The animation-lookup counts the three
`*.perf.test.ts` files pin are unchanged too, by construction: suppression is an argument to the
same one `getAnimatedValues` call each draw already made, never an extra lookup — it in fact does
strictly *less* work, skipping one preset generator per suppressed side.

**Two consequences. The first is closed; the second is deliberate.**

*The selection chrome and the pointer follow the picture (ESCSUITE-147).* ESCSUITE-139 left the
readers of a clip's animation behind the draw: the preview's selection box
(`components/Preview/previewGeometry.ts`' `getOverlayBounds`, which the box, the hit test, the
marquee and the inline text editor all measure through) and a drag's keyframe-mode starting point
(`components/Preview/dragGeometry.ts`) each called `getAnimatedValues` WITHOUT the suppression. With
a **geometric** preset (`slide-*`, `scale-*`, `pop`) on the side the transition owned, the box, the
click target and the seed were all at a position the picture had left — halfway through a 1 s
`slide-left` out-preset under a `fade`, on a 1920-wide project, the picture is at x 960 and all
three were at 480 — and a keyframe-mode drag started there wrote every keyframe it made offset by
the preset's delta. (Under a `fade` or `dissolve`, which move nothing, they agreed throughout.)

`presetSuppressionFor(clip, transition)` in `core/exportTypes.ts` is now the single answer to
"which preset side does this transition own for this clip", beside `getIncomingClipTime` and for
the same reason: the renderer knows the *side* it is drawing and reaches for `PRESET_SUPPRESSION`
directly, while every reader knows a clip and a transition instead, and one function is what keeps
the readers from drifting from each other or from the draw. It returns `undefined` for a clip the
transition does not name, which is every clip outside a window and the third clip inside one.

It takes the **clip**, not its id, for one reason: **an overlay is never suppressed.** The
suppression reaches a draw through `TransitionModifiers`, and only the two media paths take
modifiers — `drawFrame.ts` and both exporters' interleaved passes dispatch a `clip.overlayType`
through `drawOverlayClip` *ahead* of the "skip a clip the transition will draw" check and hand it
nothing — so a text or shape overlay carrying a transition is drawn with its own Animate Out preset
fully applied, whatever the transition says. A reader keyed on the id alone would have suppressed
it, which is this ticket's bug with the sides reversed, in the one configuration that previously
agreed. `ClipEditor` hides the transition section for an overlay, so only an imported or
hand-edited project can reach it; the guard lives here because the invariant is the renderer's, not
the editor's. (That configuration is separately inconsistent and older than this ticket:
`exportMP4.ts` skips *any* transition-side clip, overlays included, so an export drops the overlay
for the window the preview draws it in. Untouched here.)

The plumbing is additive, so no existing caller moved: `getOverlayBounds` gained an **optional
trailing options argument** (`{ transition }`) after `project`, and ESCSUITE-155's `getClipOpacity`
takes the same `OverlayBoundsOptions` for the same reason — opacity is the property a `fade` preset
drives, so the gate that refuses a click on a transparent clip has to evaluate it with the
transition's side left out. Without that it read 0 for the *whole* of a same-track transition (a
`fade` in-preset's first keyframe is opacity 0 at clip time 0, and `interpolateKeyframes` floors
any earlier time to it, which is where the incoming clip sits for the entire window), so the clip
the viewer could see arriving was unclickable until the transition ended. **The converse is a
deliberate ruling: a clip the transition is drawing at alpha 0.02 IS clickable.** The suppressed
opacity reads the clip's own (≈1) while the drawn alpha may be almost nothing, because the
transition's alpha belongs to no clip's animation — the same boundary as the geometric offset
below — and the clip arriving is exactly what the user is reaching for.

Also additive: `hitTest.ts` and `selectionOverlay.ts`
carry it as an optional `transition` field on the `PreviewSceneContext` slice they already take;
`dragGeometry.ts`'s `measureDragStart`, `clipsIntersectingMarquee` and `textClipAtPoint` take it as
a trailing argument; and crop mode's two halves (ESCSUITE-157) take it the same way —
`cropOverlay.ts`'s `drawCropOverlay` as a trailing `options` after `screenScale`, `CropHandles.tsx`
as an optional `transition` prop. `measureDragStart` passes it to its *second* lookup too — the one that derives
the seeded scale for an image or video clip — so the seeded position and the seeded scale describe
one picture. Absent or `null` reads as "no transition here", which is what all of them assumed
before.

The transition is derived by the two callers that own a scene, with `getActiveTransition`:
`useTransformHandles.ts` memoises one per `clips`/`tracks`/`currentTime` (so the hit test, the
marquee, the double-click and the drag seed cannot disagree, and the memo is `null` and therefore
referentially stable through an ordinary scrub), and `PreviewPlayer.tsx` derives it inside each of
the two chrome callbacks from the `time` they are drawing at rather than from the store's playhead —
the render loop calls them with its own display time. (The crop chrome is drawn from the first of
those two callbacks and takes the same derivation; crop mode's DOM handle layer is the one
exception to "from the draw time", because it is a React child rather than a canvas pass and so is
derived from `currentTime` inside its own mount guard.) That is one pass over the clips per repaint of
the chrome (two, in fact — one per callback — on top of `drawFrame`'s own), and none at all during
playback, because neither callback is *called* then: `usePreviewRenderLoop`'s scrub effect returns on
`isPlaying` and its playback effect draws the frame alone. (`selectionOverlay`'s own `isPlaying`
early return is the weaker guarantee of the two — it is reached after the argument has been
evaluated.)
No `*.perf.test.ts` figure moves: the suppression is an argument to lookups those files already
count, and the new `getActiveTransition` call is on the selection-chrome path, which
`drawFrame.perf.test.ts` does not draw (its scene has no transition under the selected clip either).

Every reader now suppresses: the selection box and the multi-select boxes, the handle
cascade, the z-order body hit (position *and* opacity), the marquee, the double-click, the drag
seed, and — since ESCSUITE-157 — crop mode's dim and its eight handles — every one of them through
`presetSuppressionFor`. Two readers deliberately do **not**
suppress. `InlineTextEditorAnchor` asks for a clip's box with no
`time` at all, so it takes no animation lookup to suppress. And the keyframe panel's graph and track
(`KeyframeGraph.tsx`, `KeyframeTrack.tsx`) plot both preset sides as authored, because they edit the
*animation* rather than the frame — a graph drag moves an existing keyframe in `(time, value)` space,
never by a screen delta, so there is no seed to displace and nothing for the suppression to protect.

**The limit:** the transition's OWN geometry is still not applied — a `slide-*` transition slides the
picture a whole frame width, and the box stays where the clip is. That is not an oversight of the
same mechanism but a different quantity: the suppression makes the readers agree about the clip's own
animated state, which is exactly what a keyframe drag writes into, whereas the transition's offset is
re-applied by the renderer every frame and belongs to no clip. Seeding a drag from it would
reintroduce this bug with a new cause, so the box and the seed cannot share one number there; and a
box that tracked a slide would still say nothing about a wipe's clip region, which `OverlayBounds`
cannot express at all. Boxing a clip mid-`slide-*`-transition is therefore a documented v1 limit, in
the same family as the rectangular box a `circle` mask gets.

*A preset longer than the transition steps at the boundary (open).* The suppression is decided per frame
from whether a transition is active, so it ends exactly when the transition window does, and the
preset it was hiding resumes mid-curve. A 3 s `fade` in-preset under a 1 s transition is fully
opaque through the overlap (its own fade suppressed, the transition's alpha doing the work), then
drops to roughly a third at the boundary and fades up again over its remaining two seconds; the
out-side mirror pops back to full opacity the instant the transition starts. Equal durations — the
ordinary case, and what the inspector's own sliders encourage — are continuous, because the preset
resumes exactly where it ends. This follows from the ruling rather than working around it: the
alternative is rescaling the user's authored preset to fit the transition, which is a different
feature and a different ticket.

`exportMP4.perf.test.ts` pins the cost: **exactly one `setTransform` per frame** (a version
that set it per clip would slip under a per-frame call ceiling and would have to be wrong about
what it multiplied), and the per-frame call ceiling itself re-measured 24 → 25 for that one
call, with every other figure — `drawImage`, save/restore pairs, animation lookups,
`getContext`, `VideoFrame`s created and closed — unchanged.

**The dropdown says what it does (ESCSUITE-111).** Every option in `ExportDialog`'s Resolution
`<select>` — "Project", "1080p", "720p" and "480p" — prints its actual output dimensions
(`resolutionOptionLabel`, one `getResolution` call per option, against the current project's
resolution), not just its name: "1080p — 1920×1080". A bare "1080p" was surprising on a portrait
project once ESCSUITE-94 made a preset's width follow the project's aspect — it would export
608×1080, narrower than 1920, and the label gave no hint. The dimensions are recomputed on every
render, so switching projects or resizing the canvas updates every option's label immediately.
