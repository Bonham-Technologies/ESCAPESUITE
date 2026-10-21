<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Timeline (`src/components/Timeline/`)
`Timeline.tsx` is wiring only — the store selectors, the refs for the three scrolling panes,
one call per module below, and the JSX around them. It owns no gesture state and binds no
document listeners itself. The hooks are called in a fixed order — playhead, in/out, scroll
sync, clip drag, trim, track actions, marquee, seek — and the order is the one the effects ran
in when they all lived inline, kept so that the hooks that bind listeners or observers still
mount and clean up in that sequence. It is a weaker constraint than it used to be: since the
gesture hooks stopped re-binding per pointer frame (below), the only ordered events are each
gesture's own bind and unbind, so a re-ordering would change which hook binds first at a
gesture boundary rather than on every render.

**One listener pair, one measurement, one snap array — per gesture, not per pointer frame.**
All five gesture hooks bind their `document` pair through `src/hooks/useDocumentListener.ts`
(or an effect shaped like it) on a **boolean** that flips twice a gesture — `dragState !== null`,
`trimState !== null`, `tlMarqueeStart !== null` — so nothing the moves write can re-bind them.
The live gesture is held in a ref beside its `useState` value: the state drives the render (the
ghost clip, the live trim, the rectangle), the ref is what the handlers read, and the handler
itself is still rebuilt every render and swapped in through `useDocumentListener`'s own ref, so
the moves and the release see exactly the props the old deps arrays gave them. Because the pair
is unbound by an effect rather than synchronously, a mousemove batched with the mouseup still
reaches a handler whose gesture is over; each one checks its ref and does nothing
(`useClipDrag.test.ts`, `timelineGestureCaching.test.ts`). The mouseup stays a plain
bubble-phase `document` listener — no capture, no `once` — because `marqueeJustFinished` has to
be set before the click that follows it. That click does not always arrive, though: a browser
fires `click` at the nearest common ancestor of the mousedown and mouseup targets, and a release
that lands outside the track container (over the header column, the ruler, anywhere) is one the
container's own `onClick` never sees — so the ONLY thing that used to clear the flag
(`useTimelineSeek.handleTrackClick`) never ran for that gesture, and a later, unrelated click on
bare track would find it still set and be silently swallowed (ESCSUITE-168). The fix is a
one-shot `document.addEventListener('click', …, { once: true })`, armed the moment the flag is
set, that clears it on the very next click wherever it lands — consuming the gesture's own
terminal click (whichever element it happens to fire on) instead of waiting for one that may
never reach the container at all. It has to be **bubble**-phase and on `document`, not capture or
`window`: React 19 delegates at the root container (`createRoot(#root)`,
`packages/shared/src/bootstrap/index.tsx`), which sits *below* `document` in the tree, so a
bubble-phase `document` listener fires *after* React's handlers — on the gesture's own terminal
click, `handleTrackClick` still runs first, sees the flag set, stands down and clears it itself,
and the one-shot fires second as a no-op (`Timeline.editing.test.tsx`'s "does not deselect on the
click that ends a marquee" is the case that holds this ordering). Capture phase, or `window`
instead of `document`, would fire the clear *before* React's own handler and silently
reintroduce the bug the flag exists to prevent. The listener is held in a ref and given back in
a mount-scoped cleanup if the timeline unmounts before the next click ever arrives (a project
load, an undo back past "no clips") — the only other place it could otherwise outlive. And a
flag left set by a gesture whose terminal click never fires **at all** (its mousedown target
removed from the tree before the mouseup — a real browser then dispatches no click for it) is
cleared a second way: `handleTrackMouseDown` clears it unconditionally at the start of every new
gesture, since by then the previous one's click has either already landed or never will.
`timelineGestures.perf.test.ts`'s `isGestureEvent` filters to `'mousemove' | 'mouseup'`, so the
one-shot `click` listener is invisible to both halves of the count it asserts — `2 listeners, 1
getSnapPoints, one pass over the track rows, per gesture` counts the mousemove/mouseup pair
alone, not every `document` listener this hook binds. Three of the
five hooks used to re-bind per pointer frame — 42 adds and 42 removes over a 20-move gesture —
and `usePlayheadDrag` and `useInOutDrag` never did; their 2/2 is pinned exactly too, so a
refactor cannot drop them into the churn. `useDragListeners` (the other export of
`src/hooks/useDocumentListener.ts`) is deliberately **not** what any of them use: its
imperative start/stop would unbind the pair synchronously inside the mouseup and move
`marqueeJustFinished` relative to the click that follows. It currently has no caller at all,
and should be adopted across the five or deleted. Two things the
directory uses come from outside it: `useVirtualizedTimeline` (`src/hooks`), which decides
which clips are near enough the viewport to draw, and `MarqueeSelection`
(`src/components/Preview/`), the rectangle the preview and the timeline share. Every module
here has its own test file except `types.ts`, which is types only (and excluded from
coverage); `Timeline.tsx` itself is covered through `Timeline.test.tsx`,
`Timeline.editing.test.tsx` and `Timeline.chrome.test.tsx`, which drive the rendered
component.

| Module | Owns |
|--------|------|
| `Timeline.tsx` | The composition: the store selectors, the container/ruler/headers/track refs, the hook calls in their fixed order, the in/out region and snap-line overlays, and the info bar. Also `clipsByTrack`, the memo that gives each row an identity-stable `clips` array — see the memo-boundary note below |
| `timelineGeometry.ts` | All of the timeline's maths as pure functions — ruler tick spacing (`rulerIntervals`: the zoom picks the label step first, the smallest 0.1–60 s ladder step >= 80 px (so labels never get coarser as zoom grows), then the minor tick as the smallest ladder step >= 50 px that divides the label step (the scale is first held at `MIN_PIXELS_PER_SECOND`, 5, the zoom control's floor, so both always exist; at the maximum zoom labels bottom out at 0.25 s); 50 px/s keeps 61 ticks for the 60 s scene but labels every 2 s; `RulerTick` carries its `label`, and `RULER_MAJOR/MINOR_INTERVAL` are gone; and `formatRulerTime` gives the label tenths or hundredths when that step is under a second), pointer-to-time, clamping, snap resolution for a drag, the trim's re-derivation from its origin, and the marquee's time/Y ranges and hit tests. No ref, no store, no render |
| `types.ts` | `DragState` and `TrimState` — the two gesture shapes the hooks own and `TimelineTrack` draws from, so neither has to import the other. **Types only** — it is excluded from coverage, so a single runtime value in it would go unmeasured |
| `TimelineRuler.tsx` | The ruler: ticks and labels, the marker flags (each a `<button>` named `Marker <label> at <time> — Delete to remove`: Delete or Backspace removes it (propagation stopped, so the window's delete-selected-clips shortcut does not also fire), double-click still does, focusing a flag copies the ruler's `scrollLeft` into the track container so a Tab to an off-screen flag does not leave the ruler out of line with the tracks, and a click or Enter/Space seeks to the marker's own time through `onSeek` (`useTimelineSeek.handleSeekTo`, which pauses and clamps) with propagation stopped, so the ruler's pixel maths is never consulted for a marker — ESCSUITE-251), the in/out handles and the region they bracket. `React.memo`'d — nothing on it can change during a gesture. Also exports `TimelineMarkerLines`, the marker verticals drawn down over the tracks (not memo'd: it re-renders with `Timeline` and is two divs) |
| `TimelinePlayhead.tsx` | The playhead line — `React.memo`'d and subscribing to `currentTime` itself, so a playback tick moves this element instead of re-rendering the timeline |
| `TimelineTimeReadout.tsx` | The `current / total` readout in the info bar, split out for the same reason |
| `TimelineTrack.tsx` | One track row: its clips (only the ones the virtualiser passed), the drag preview, the trim's live sizing, and each clip's label, **masked thumbnail**, waveform and keyframe diamonds. `React.memo`'d, which holds for a marquee or a scrub but not for a clip drag — `dragState` is one of its props |
| `visibleRangeCache.ts` | `pruneVisibleRangeCache` (ESCSUITE-13 round 3): deletes `TimelineTrack`'s per-clip `visibleRangePx` cache entries for clips no longer on the row. Its own file rather than living in `TimelineTrack.tsx` purely so it can be `export`ed and unit-tested directly without breaking that file's Fast Refresh (`react-refresh/only-export-components` disallows a component file exporting anything else) |
| `TrackHeader.tsx` | One header row: volume (one drag or held key = one undo entry, through `ClipEditor/useSliderGesture.ts` — ESCSUITE-242) and mute, the track name (a `<button aria-label="Rename track <name>">`: click, Enter, Space or double-click opens the `aria-label="Track name"` field, Enter commits, Escape discards, and Enter or Escape hand focus back to the button a tick later so Enter's own keypress cannot press it and reopen the editor — ESCSUITE-251; the only state in the directory that is not a gesture), the reorder arrows and the visibility/lock/delete controls. `React.memo`'d — its props are stable through a clip drag, a marquee and playback, so the whole column sits those out. **Not through a trim**: `useTrackHeaderActions`' `handleDeleteTrack` depends on `clips`, and a trim writes the store every move, so `onDeleteTrack` changes identity per frame and the column re-renders anyway |
| `ClipKeyframeDiamonds.tsx` | The keyframe markers along a clip: every animated property's times, deduplicated and placed |
| `AudioWaveform.tsx` | The canvas waveform inside a clip. Resamples the clip's *visible window* — not its whole box — so detail follows zoom instead of being frozen at a whole-clip cap (ESCSUITE-13); the CSS size and the backing store are always the same clamped number, so a canvas never stretches past what it actually holds |
| `useScrollSync.ts` | Keeping the ruler, the headers and the track container pointed at the same place, and the `ResizeObserver` that tells the virtualiser how wide the container is |
| `useTrackAreaCache.ts` | One gesture's worth of track-area geometry: the container's client origin and each `[data-track-id]` row's box in the container's own **layout space**, taken on mousedown so a move reads only `scrollLeft`/`scrollTop`. Dropped and re-taken on `scroll` (captured — scroll does not bubble) and on window `resize`, the two things that move the box under a live gesture. Invalidation is **event-based**, so a layout change that fires neither — an autosave or an undo changing a row's height mid-drag — would leave it stale where the old per-frame measurement absorbed it; unreachable through the UI today (a clip drag writes nothing until release, and no control resizes a track while a pointer is down), and if row heights ever become dynamic the hook to reach for is the `ResizeObserver` `useScrollSync` already installs on this container, not a third listener |
| `usePlayheadDrag.ts` | The playhead scrub: `isDraggingPlayhead` (which the marquee and the track click both read) and the document listeners that write `currentTime`. A scrub pauses playback for its own length (ESCSUITE-246): the preview's render loop writes the playback position into the store while it runs, so a scrub over a playing timeline was overwritten within 200 ms (about 12 frames) of release, and mid-gesture too, and the playhead snapped back. The grab reads `isPlaying` into a ref and calls `setIsPlaying(false)` before the first write — the ruler click's shape (`useTimelineSeek.ts`) — and the release calls `setIsPlaying(true)` only if that ref says playback was running, so a scrub started paused ends paused; the loop restarts from the store's `currentTime`, which is where the pointer let go. One store write each way per gesture, none per move (`timelineGestures.perf.test.ts` is unchanged). A grab with no move resumes from the frame the preview was showing at mousedown: the grab's pause makes the render loop publish its last frame to the store as it stops (ESCSUITE-281), as Space and Pause do — it used to resume from the store's last throttled write, up to ~200 ms behind the readout. A resume that lands in a gap between clips plays on from the next clip (ESCSUITE-280; it used to stall "playing" without advancing, as starting playback in a gap did) |
| `useInOutDrag.ts` | The in and out marker drags — one pair of listeners for both handles, asking which flag is up to decide which point started the gesture. Which point it is currently *writing* can change mid-gesture (ESCSUITE-165): dragging the in handle past the out point flips the gesture to the out handle, writing both points explicitly in the one move that crosses, so `playbackSlice.ts`'s own swap-on-cross invariant — correct for a direct write from outside a gesture — never fires mid-drag and the region never collapses to one mousemove's width. The stationary point is read live (off the same `inPoint`/`outPoint` refs the hook mirrors every render) at the instant of each crossing, not snapshotted once at mousedown, so a write to it from outside the gesture — the keyboard's I/O shortcuts, the Toolbar's in/out buttons, both of which call `setInPoint`/`setOutPoint` directly — is what a crossing sees rather than something it silently discards |
| `useClipDrag.ts` | Dragging a clip, and the three other readings of the same mousedown (razor split, ctrl/cmd toggle, locked-track refusal). `dragState` is the preview; the store is written on release — which is why the snap points and the track rows are both taken once, on the mousedown, and never re-taken per frame. A drop that changed both the row and the time writes twice there, and the second write carries `skipHistory` so the whole drag is one undo step (ESCSUITE-79, below). A drop by a **multi-selection** is the other branch of that same commit: one `moveSelectedClips` carrying both deltas, all-or-nothing (ESCSUITE-80, below). The grab point (where the pointer took hold of the clip) is also taken once on mousedown, but as a TIME — `pixelsPerSecond` can change mid-drag (`+`/`-` zoom needs no pointer of its own), and a pixel distance measured at the old zoom would describe the wrong grab point once the pixel grid underneath it has changed. `handleMouseMove` re-derives the pixel offset from the grabbed time and the *current* `pixelsPerSecond` on every move (`timeToPixels`, the twin of the `pixelsToTime` the rest of the file already uses), rather than from a pixel figure cached at whatever zoom the gesture started at (ESCSUITE-168). `DragState` used to also carry that pixel distance as `offsetX`, read by nothing at all, inside this hook or out — deleted rather than kept as a write-only field (ESCSUITE-181); the grab point the moves actually use, `offsetSecondsRef`, lives beside `snapPointsRef` instead |
| `useTrimDrag.ts` | Dragging a clip's edge: a store write on every move, always re-derived from the origin recorded on mousedown, plus the ripple tool's shift of everything after it. The per-move write makes `clips` a fresh array every frame, which is exactly why the listeners hang off `trimState` and not off the clips |
| `useTimelineMarquee.ts` | Rubber-band selection: the drag threshold that tells a marquee from a click, the hit test over rows and time, and the `marqueeJustFinished` flag that keeps the closing click from seeking — cleared by the next `click` anywhere, through a one-shot `document` listener armed the moment the flag is set, rather than only by a click that happens to land on the track container (ESCSUITE-168, see "One listener pair..." above). The rows are still walked on the release only — once per gesture, never per frame |
| `useTrackHeaderActions.ts` | What the header buttons do: raising and lowering a track (with the reversal between display order and the store's bottom-up indices) and deleting one, asking first if it still holds clips — "Ctrl+Z will bring it back", not "this cannot be undone" (ESCSUITE-168): `removeTrack` pushes an undo entry like every other edit, so the old wording scared the user off a reversible action |
| `useTimelineSeek.ts` | The click-to-seek handlers (plus `handleSeekTo(time)`, the marker flags' exact-time seek) — the ruler's, and the track area's with every reason it stands down (a drag, a scrub, the click that ended a marquee, a click on the playhead) and the deselection it does when the click really was on bare track |

**Three memo boundaries, and why they are where they are.** A timeline gesture's state —
`dragState`, `trimState`, the marquee rectangle — lives in the hooks `Timeline` calls, so every
pointer frame re-renders `Timeline` and, before this, everything under it: four rows, four
headers and a ruler that rebuilt 61 tick objects, 20 times a drag. `TimelineRuler`,
`TrackHeader` and `TimelineTrack` are each `React.memo`'d, and the memoisation that makes the
third one work is `Timeline`'s own `clipsByTrack`: `getTrackClips` used to `map` a fresh array
per track per render, and a fresh `clips` prop defeats a memo entirely. **Memoise the array
before, or with, the row — never the row alone.** What each boundary actually catches, measured
2026-09-13 in `timelineGestures.perf.test.ts` (renders per pointer frame, before → after):

| | clip drag | marquee |
|---|---|---|
| `TimelineTrack` | 4 → 4 (`dragState` is its prop) | 4 → 0 |
| `TrackHeader` | 4 → 0 | 4 → 0 |
| `TimelineRuler` / `getRulerTicks` | 1 → 0 | 1 → 0 |

In the browser (`pnpm perf`, paired alternation, three rounds per arm) that is **clipDrag
10.91 → 8.77 ms of JS per frame (−19.6%)** and **marquee 10.39 → 5.54 ms (−46.7%)**, both with
disjoint ranges; `playheadScrub` is unchanged, because a scrub writes `currentTime` and
`Timeline` does not subscribe to it. Forced layouts are untouched at 0.82 and 0.98 per frame —
those were round 2's Task 2, and this is the render half. Those two gestures, plus playback,
are what the header memo holds for; a **trim** is the gesture it does not, for the reason in
its table row above. `TimelinePane` stays **unmemoised** on purpose (see the App section). The
three ceilings for a drag are asserted as exact zeroes, not at 2x: a single re-render per frame
means a prop has become unstable again. The whole round is written up in
[docs/performance/2026-09-13-timeline-profile.md](../../docs/performance/2026-09-13-timeline-profile.md),
including the caveat that the millisecond figures are dev-build numbers while the render
counts are what a release build keeps.

**A media clip carries its own masked thumbnail (ESCSUITE-65, decision 5).** `TimelineTrack`
draws one `<img>` of the clip's *source* thumbnail at the head of the clip and shapes it with an
inline CSS `clip-path` from `utils/maskClipPath.ts`: `circle(<h/2>px at <h/2>px 50%)` for a
circle mask, `inset(0 round <fraction x h>px)` for a rounded one, and nothing at all for
neither. The circle is **hugged to the thumbnail's left edge** rather than centred in the 91px
box, and that is a deliberate fix rather than an oversight: a clip is as wide as its duration
and `.clip` is `overflow: hidden`, so a 0.2s clip is 10px wide and shows only the thumbnail's
first 10 pixels — a centred circle spans x 20-72 and that clip would show an empty rectangle
where an unmasked clip shows its picture. Only the *centre* moves; the radius is still
`maskPathFor`'s, so it is a placement choice and not a second piece of geometry, and
`inset(0 round r)` already starts at the left edge and needs no equivalent. The
geometry is not a second copy — `maskClipPathFor` asks `core/clipMask.ts`'s `maskPathFor` for
the shape of a 16:9 box of the thumb's height and only says the answer in CSS, so the inscribed
circle, the clamp to half the shorter side and "a rounded rectangle with square corners is a
rectangle" have one implementation each, and one test asserts the thumbnail's radius *is*
`maskPathFor`'s. The thumb's shorter side is its height, which is why one number is enough and
why the stored radius (a fraction of the clip's shorter side) resolves here against exactly what
it resolves against in the frame. DOM and CSS, never a canvas: the timeline drew no picture at
all before this, and a canvas per clip would put a second rasteriser on the gesture path.

Four properties of that `<img>` are load-bearing and each is asserted in
`TimelineTrack.test.tsx`. It is **`position: absolute` inside `.clipContent`**, so it is out of
flow — in flow it would be the tallest item in a `flex-wrap: wrap` row whose duration is
`width: 100%`, and it would push that duration past `overflow: hidden` and out of sight; out of
flow the name/duration layout is byte-identical, the trim handles keep their `z-index: 5` above
it, and no pointer frame has anything new to lay out. It is **`pointer-events: none`** and
**`draggable={false}`**, so it can never be an event target nor start a native drag racing the
clip drag — the hit geometry is `target.closest('[data-clip-id]')` plus a measurement of
`[data-track-id]` rows (`useTrackAreaCache.ts`), and an element inside a clip changes neither.
Its box is **one number each, on the `width`/`height` attributes**, computed from `track.height`
in the component because CSS cannot read a track's height and a `clip-path` circle needs a pixel
radius — leaving the inline `style` to carry the `clip-path` alone, which is what lets one
assertion on the whole style attribute prove the thumbnail is masked *and* not stroked. And it
is **`aria-hidden` with `alt=""`**: the clip's name is already its label, and this is decoration.
It also carries `decoding="async"`, because the virtualiser unmounts and remounts clips as the
timeline scrolls and so creates these `<img>`s in bursts; nothing on the page waits for the
picture, so a burst has no business on the main thread.
It costs the row no store read — `sourceMedia` is the lookup the waveform already needs — and
`timelineGestures.perf.test.ts` and `App.rerender.test.tsx` were byte-unchanged and green when
it landed, which is the proof it costs no listener, no rect read, no render and no subscription.
The `timeline-interaction` benchmark was re-run before and after and its three per-frame
forced-layout figures did not move.

**That run did witness a drawn thumbnail** — corrected here by ESCSUITE-76, which set out to add
the arm it thought was missing and found it already there. `loadPerfScene` imports a real MP4
through the media library's own file input, so `processVideoFile` gives the browser scene's
source a `thumbnailUrl` and all twelve media clips draw one; the spec now counts them
(`thumbnailsDrawn`, asserted `=== 12` before a gesture runs, and reported in
`perf-report.json`), so the arm can never go blind unnoticed. Measured 2026-09-26: 12
thumbnails drawn, and the per-move forced layouts still 0.82 / 1.00 / 1.00 —
[docs/performance/2026-09-13-timeline-baseline.md](../../docs/performance/2026-09-13-timeline-baseline.md#2026-09-26-the-benchmark-arm-was-never-blind-escsuite-76).
The half that really was blind is the **jsdom** one: `perfScene.ts`'s `sceneSource` carries no
`thumbnailUrl`, so the per-frame *counts* had never seen an `<img>`. ESCSUITE-76 closed that too,
with `sceneSourceWithThumbnail` and a variant arm in `timelineGestures.perf.test.ts` that
drags the scene twice — 0 thumbnails then 12 — and asserts the listener adds and removes, the
container and row rect reads and the renders per frame are **equal**, plus zero rect reads on any
of the twelve `<img>`s. The a-priori argument (out of flow, a fixed attribute box that neither
reads nor contributes to in-flow layout, `pointer-events: none` so it is on no hit path) is
therefore now asserted in the counting half and measured in the timing half.

**Paint order is three offsetless `position: relative` rules, and they are load-bearing too.**
`.clipThumb` is positioned with `z-index: auto`, which paints in CSS 2.1 Appendix E **step 8** —
after *all* in-flow, non-positioned content of its stacking context — regardless of tree order,
so being `.clipContent`'s first child bought it nothing and the thumbnail painted *over* the
clip's own name at 45% opacity. `.clipName`, `.clipDuration` and `.clipIcon` are therefore
`position: relative` with **no offsets**, which moves them into step 8 as well, where tree order
decides and they win as later siblings; no geometry moves, which is why no existing test changed.
One visible side effect, worth saying rather than leaving to be discovered: giving `.clipContent`
a containing block made it *positioned*, so a clip's label now paints **over** its waveform
instead of under it — the reverse of what `AudioWaveform.module.css`'s comment claimed before
this slice, when the canvas at `z-index: 0` was in step 8 and the in-flow label was not. Arguably
the right order, and small, but it is a real visible change on an audio clip. jsdom computes no
paint order at all (it has neither layout nor paint), so this is pinned in those two files'
comments and nowhere else.

Three deliberate limits, so none of them reads as a bug. **The stroke is not drawn on the
thumbnail** — v1 shows the shape; the border stays in the frame. **The preview's
selection box and hit test stay rectangular** (`components/Preview/hitTest.ts`,
`selectionOverlay.ts`): a circle-masked clip is still selected, dragged, resized and rotated by
its drawn rectangle. And **the media library's card stays unmasked** (`VideoUploader.tsx`),
because that thumbnail belongs to the *source* file and one source can back several clips with
different masks — which is also why the mask could not simply be put there instead.

**A media clip can also carry a crop (ESCSUITE-6), and it is the one static
property that changes the clip's rectangle.** `core/clipCrop.ts` owns the
arithmetic; `drawWithMaskAndStroke` takes the source rectangle and issues the
**nine-argument** `drawImage(source, sx, sy, sw, sh, x, y, w, h)` — the
five-argument form is gone from `core/clipMask.ts`, unconditionally, because a
branch there would be a second rule about crops inside the one function meant
to have no opinion about them. The drawn size is the cropped region times the
clip's scale, still anchored on its normalised centre, so **cropping shrinks
the picture in place** rather than stretching the remainder over the old box;
mask and stroke are computed from that smaller box, so a cropped circle-masked
clip gets the smaller circle and `clipMask.ts` needed to learn nothing about
crops for that to be true. The `drawImage` *count* per frame is unchanged,
which is why the three per-frame ceiling files are byte-identical.

Because a crop *is* the rectangle, `getOverlayBounds`
(`components/Preview/previewGeometry.ts`) reports the cropped size for a media
clip — the opposite of the mask's treatment above. One edit covers the
selection box, the eight handles, the marquee's AABB and a drag's seed
measurements, because `hitTest.ts`, `selectionOverlay.ts` and `dragGeometry.ts`
all read that one function; each has a case of its own so that stays a
contract. **Fit to Canvas reads the crop too** (MINOR 2, final review):
`handleFitToCanvas` passes `clipEditorModel.ts`'s `fitToCanvasScale` the
cropped region from `croppedSourceRect`, not the source video's own
dimensions, so pressing it on a cropped clip fills the frame with the picture
that is actually drawn rather than reserving room for the part that is no
longer on screen.

**One deliberate v1 limit remains.** The **timeline thumbnail is not
cropped** — `utils/maskClipPath.ts` is untouched, so a cropped clip's tile
still shows the whole frame's picture (masked, if it is masked). The v2
ticket's (ESCSUITE-157) other limit — **no on-canvas crop handles** — is
closed: `cropClipId` (`store/uiSlice.ts`) names the clip crop mode is open
on, or `null`; `CropSection`'s header carries a second button, "Crop on
canvas", beside Reset — `aria-pressed` on whether the latch names the
*selected* clip (and **looking** pressed, not just reading as pressed: a
`.resetButton[aria-pressed='true']` rule fills it with the same accent every
other `aria-pressed` control in the panel uses), live on a locked track because
looking at a crop is reading, not editing (the eight handles go inert there, via
their own `disabled`, not the latch). The **one** thing that disables it is a
clip whose source has left the media library — `sourceWidth` 0, which
`cropTarget` refuses — where latching would mean a pressed toggle with nothing on
the canvas, so it is `disabled` with a `title` saying why instead. It is a latch deliberately left unsynchronised: nothing clears it
on a selection change, a clip delete, a project load or an undo, because every
reader is required to compare it to the current selection rather than trust it
on its own — which is how all four of those leave crop mode for free. Escape
leaves it too, second in the cascade (`useAppKeyboardShortcuts.ts`, above),
ahead of the in/out points and the two selection branches so that deselecting
is never what leaves crop mode — and the same Escape leaves it from a focused
handle itself (below), rather than falling through to that cascade, because
`CropHandles`' own `onKeyDown` claims it first.

**That branch has to apply the same "inert unless it names the selection" rule
the other readers do, not just state it** (ESCSUITE-170). It used to gate on
the raw `cropClipId` alone — `if (cropClipId) { … return; }` — so an inert
latch (crop mode opened on clip A, the selection since moved to clip B) made
Escape claim the key for a mode that was already off on screen, clear nothing,
and `return` before the in/out points were ever reached: the symptom was
"Escape does nothing the first time, and needs pressing twice, with no
announcement either time." The branch now reads `cropClipId &&
cropClipId === selectedClipId` — `selectedClipId` was already a dep of this
hook — so an inert latch takes neither side of this `if` and the cascade falls
through to the in/out points exactly as if no latch were set at all. The latch
itself is still not cleared by this fall-through (clearing it would mean
`setSelectedClipId` writing into the crop slice, the cross-slice write
ESCSUITE-157 deliberately left alone), so re-selecting clip A still re-enters
crop mode on its own — a live wart, not this ticket's to close — but Escape no
longer swallows a keypress for a mode that is already inert.

While crop mode is open, `PreviewPlayer` renders `components/Preview/CropHandles.tsx`
over the canvas instead of the ordinary resize handles — a DOM layer, not canvas
chrome, because a handle has to be focusable and independently `disabled` for a
locked track, and because ESCSUITE-90's CSS-pixel-sized chrome is exactly what a
button already is. Each handle's cursor is computed **once**, inline — its resize
keyword from `cursor.ts`' table, or `not-allowed` when the row is locked
(ESCSUITE-88's answer); a stylesheet `:disabled { cursor }` rule cannot reach past
an inline style, which is why there is no longer one. Eight `<button>`s at the kept region's corners and edges
(`CROP_HANDLES`'s compass points, in reading order so a screen reader walks
top, sides, bottom), inside one `role="group"` framed in the clip's own CSS box
and rotated with it by a single `rotate()`; the dim over the cropped-away
picture is separate canvas chrome in `cropOverlay.ts`. A handle owns the one or
two insets its compass point names (a corner owns both axes) and writes
through `useCropHandleGesture`, which also carries the compensating `transform`
a crop write needs (`cropWriteFor`) — except on a clip whose placement is
keyframed, where the crop goes alone.

**Every crop write in the app goes through the same two functions**
(ESCSUITE-171). `cropUpdateFor` (`core/clipCrop.ts`) is the decision about what
the store may *hold*; `cropWriteFor` (`core/cropDrag.ts`) is the decision about
where the picture then *sits*. So the one rule, for the eight on-canvas handles
and for the inspector's four sliders, its number fields, its five aspect presets
and its Reset/"None" alike: **a crop write keeps the edges it is not changing
where they are**, by writing the compensating centre beside the crop — except on
a clip keyframed on `x`/`y`/`scaleX`/`scaleY`, where `cropCompensatesCentre` says
no and the crop goes alone (a static centre would fight the keyframes and lose at
playback), and except on a clip with no source frame to measure a centre
against, which is only ever reached by the all-zero "clear the crop" write
`cropUpdateFor` allows a clip whose source has left the media library.

One accepted inexactness comes with that, and **since ESCSUITE-171 both surfaces
share it, not just the drag**: `cropCentreFor` carries the displacement out
through the clip's **static** rotation, so on a clip whose `rotation` is
keyframed the compensation is a hair off — the same family, one step smaller, as
the "Known wrinkles" paragraph below names for a drag on a scale- or
rotation-keyframed clip. Documented rather than branched on, exactly as it was
when only the handles could reach it.

The difference between the two surfaces is only what they rebase from. A **drag**
rebases every move from the press — reading the previous move's output would
compound (ESCSUITE-110's trap in a different gesture) — so `useCropHandleGesture`
carries a `start` object. Each **inspector** write is its own gesture, so
`handleCropChange` reads the clip's current crop and transform (off `selectedClip`,
which the inspector already subscribes to, so this costs no new subscription —
`ClipEditor.rerender.test.tsx` holds that line). Until ESCSUITE-171 the inspector
wrote `{ crop }` and nothing else, which was a named v1 limit with an unnamed
consequence: the Crop section's Reset left a handle drag's compensating centre
behind, so the uncropped picture stayed displaced by exactly the drag's offset,
for good.

**Crop mode's chrome and its handles appear and disappear together**, because
both ask one question. `visibleCropTarget` (`cropOverlay.ts`) is `cropTarget`
plus the clip's own time window — end exclusive, as `selectionOverlay.ts`' test
has always been — and `PreviewPlayer` calls it once for all three of the chrome,
the canvas' own pointer handlers and the handle layer's mount. Scrubbing the
playhead off the cropped clip therefore unmounts the eight handles rather than
leaving them live and draggable over an unrelated frame; the latch survives, so
scrubbing back in returns the mode. Before the final review the chrome carried
that comparison alone and the layer carried none.

**And they come and go with the picture, not just with the playhead** — one
rule, asked in two places (ESCSUITE-171, ESCSUITE-178). `CropOverlayScene`
carries the timeline's `tracks` and `cropTarget` refuses a clip whose track is
missing or not `visible`; `selectionOverlay.ts`'s `drawSelectionHandles` /
`drawMultiSelectHandles`, `hitTest.ts`'s `hitHandlesOnClip` (the cascade both of
`hitTestHandles`' passes feed the *selected* clip through directly, with no
z-order filtering of its own — the actual gap, since the second, all-clips pass
already went through `getClipsAtTime` and was already safe) and
`dragGeometry.ts`'s `clipsIntersectingMarquee` (which never routed through
`getClipsAtTime` at all — it needs each candidate's drawn *box*, which that
helper does not compute, so it gained its own `tracks` parameter) all ask the
one `store/trackVisibility.ts` question `getClipsAtTime` (`store/clipQueries.ts`)
asks before the renderer draws a clip at all — `isTrackVisible(tracks, trackId)`,
or `isVisibleTrack(track)` where the caller already has the lookup — so none of
them can drift apart. Hiding a clip's track
used to leave crop mode's chrome dimming a ghost of a frame the renderer was
skipping, with eight live, draggable handles over it, and left the *ordinary*
selection box and its live resize handles untouched entirely elsewhere — a
hidden clip stayed fully grabbable everywhere crop mode was not open on it.
Both are fixed the same way now: hiding a track takes the chrome, the live
handles and the marquee's reach with it, exactly as the clip's own picture
already disappears, and showing the track again brings all of it straight
back — hiding a track is a view toggle, and both crop mode's latch and an
ordinary selection survive it exactly as they survive a scrub; the selection
itself never changes; there is nothing to restore, since nothing about *it*
ever did. `PreviewPlayer` already subscribed to `tracks` for every scene that
needs it (it reads them for `isTrackLocked` and `getActiveTransition` too), so
none of the scene memos gained more than one dependency.

One deliberate non-change remains. **"Crop on canvas" is not disabled for a
hidden track**, unlike the `sourceWidth === 0` case it shares a refusal with
(`CropSection.tsx`): hiding a track is a reversible view toggle, so a pressed
toggle with no chrome behind it is the **scrub** precedent — already accepted,
and one click of the track's eye brings the mode back — where a source that has
left the media library is not coming back and the toggle says so.

**The crop frame follows the picture through a transition** (ESCSUITE-147's
suppression, threaded here). Both halves of crop mode's geometry are measured off
the one `getOverlayBounds` the selection box, the hit test, the marquee and the
drag seed read, so both take that function's optional `{ transition }`:
`drawCropOverlay` as a trailing `options` argument after `screenScale`, and
`CropHandles` as an optional `transition` prop. `PreviewPlayer` derives each with
`getActiveTransition` — the chrome's inside the chrome callback, from the `time`
it is drawing at, exactly as the selection chrome's is; the handles' inside the
`{cropping && …}` mount, from `currentTime`, so it costs one pass over the clips
per render while crop mode is open and nothing at all the rest of the time.
Without it, a clip carrying a **geometric** Animate Out preset (`slide-*`,
`scale-*`, `pop`) inside a transition window drew its crop frame — and laid its
eight draggable handles — where the preset says the clip is rather than where the
renderer draws it: halfway through a 1 s `slide-left` out-preset under a `fade`,
on a 1920-wide project, the picture is at x 960 and the frame was at 480. A crop
surface is the one place that is unarguable, because the user is deciding which
part of *that* picture to keep. The transition's own geometry is still not
applied, which is the same documented v1 limit `getOverlayBounds`' other readers
carry.

**Mouse and keyboard reach the same write.** Dragging a handle rebases every
move from the crop and transform the gesture **started** with — never the
previous move's own output, the ESCSUITE-110 trim-compounding trap in a
different gesture — and throttles to one `updateClip` per animation frame, one
undo entry for however many moves a drag makes. The **arrow keys** nudge a
focused handle instead: one source pixel per press, ten with Shift
(`CROP_NUDGE`), through the same `cropForHandleMove`. A focused handle owns
all four arrows unconditionally — including the two it has no inset on, which
it still claims and simply does nothing with, so the playhead cannot step out
from under a user whose focus is on a crop handle — and `e.repeat` (held key)
resumes the open gesture rather than starting a new one, `useSliderGesture`'s
rule for a held slider arrow, so one held key is one undo entry. Each press
reads the clip's crop and transform fresh off the store
(`useEditorStore.getState()`) rather than off the `clip` prop: unlike a drag, a
key press has no gesture-start object to rebase a *later*, separate press
from, and in an isolated render (without `PreviewPlayer`'s own subscription
re-rendering this component between keydowns) the prop would otherwise still
hold what it did before the first press landed. A nudge that cannot move — an
arrow the handle does not own, or one already clamped at the frame's edge —
writes nothing and costs no undo entry (`cropsEqual`), and a write the store
refuses (a track locked mid-gesture) is as silent as everywhere else
(ESCSUITE-87's shape).

The same `<span role="status" aria-live="polite" aria-atomic="true">` that sits
beside the handles announces a landed nudge — "Crop left: left 1 px", in
source pixels rather than the inspector's percentage because a one-pixel nudge
of a wide source rounds a percentage to "0%" — through the identical
zero-width-mark alternation `KeyframePanel/hooks/useKeyframeGraphKeyboard.ts`
uses (copied rather than imported, so the preview does not take a dependency on
the keyframe panel for one character): two consecutive announcements of the
same text differ by a trailing zero-width space (`​`) so an `aria-atomic` region whose text
would otherwise be unchanged is still re-read. The mark only disambiguates two
*immediately adjacent* announcements, not an arbitrary round trip — two
announcements separated by exactly one other real announcement land back on
the same mark parity, so a right-then-left-then-right sequence whose first and
third announcements coincide can still collide on screen (an undo or any other
silent intervening change does not share this problem, since it makes no
announce call at all).

**Shift means two different things depending on which hand is on it.** On the
mouse it locks the kept region's aspect for the drag (`cropRegionAspect`,
above); on the keyboard it is `CROP_NUDGE.coarse` — ten source pixels instead
of one — and does nothing to the aspect, because a single-inset nudge has no
shape to hold.

**A keyup or blur ends only the gesture it actually belongs to** (ESCSUITE-169).
`onMouseDown` focuses the handle explicitly — so the arrow keys have something
to nudge once the mouse lets go — which means Shift's own keyup, released to
drop the aspect lock without releasing the mouse, reaches the handle mid-drag
too. `onKeyUp` used to be `gestureHistory.end()` for any key at all, so
releasing Shift (or any other key) mid-drag closed the gesture the mouse was
still driving: every write the throttler made afterwards then pushed its own
undo entry, five moves becoming five entries for one drag. The fix is two
guards. `onKeyUp` is as selective as `onKeyDown` already is — it ends the
gesture only for a key `ARROW_STEPS` recognises, so Shift's keyup (and any
other key's) does nothing. And both `onKeyUp` and `onBlur` are ignored while a
mouse drag is open (`endDragRef.current` non-null, the same ref the drag's own
teardown uses) — the drag's own `mouseup` is what ends it, so a key released,
or focus lost to a window switch, mid-drag must not end it early. Neither
guard touches a **keyboard** nudge's own gesture: outside a mouse drag, the
arrow key that opened it still ends it on keyup, and blur still closes a held
key's gesture exactly as before (`CropHandles.test.tsx`'s own case for that).
`ClipEditor/useSliderGesture.ts` carried the identical shape in the other
direction — `onKeyDown` called `begin()` for ANY non-repeat key, Shift
included, and `onKeyUp` `end()`d for any key, so a Shift tap mid-**pointer**-drag
of an inspector slider split that drag too — and took the same two guards:
`onKeyDown`/`onKeyUp` act only on a key the range input itself responds to
(`RANGE_KEYS`: the arrows, Home, End, Page Up/Down), and both are ignored while
`pointerDownRef.current` is true. Its `onBlur` keeps neither guard, same as
crop's reasoning but the opposite conclusion: a slider's pointer drag has no
document-level listener standing by to supply the eventual release, so blur
*is* the substitute for a `pointerup` that may never come, and must end the
gesture regardless of key or pointer state — `ClipEditor.sliderHistory.test.tsx`'s
"ends a gesture on blur as well as on release" is the case that pins it.

**Playback takes the handles away and gives them back.** `cropTarget`'s
`isPlaying` condition makes the chrome stop and the eight handles **unmount** the
moment playback starts, while the latch itself survives — so the mode returns on
pause, on the clip the user left it on. Related, and not fixed: a focused handle
claims only Escape and the four arrows, so `PlaybackControls`' own window listener
(which skips only input/textarea/select targets) still takes **Home** and **End**
from it. Space was this note's third key and is fixed (ESCSUITE-247: the handles are
`<button>`s, so Space is left to them); Home and End remain. Arrow-stealing was fixed
deliberately (spec §8); this is its sibling, left alone here.

**Known wrinkles, left as they are rather than fixed in this ticket.** The drag
is **mouse events only** (`mousedown`/`mousemove`/`mouseup`), the same scope
`useTransformHandles.ts` already has, so there is no crop drag from a touch
pointer. On a clip whose **scale or rotation is keyframed** the drag does not
track the pointer exactly: the handles sit on `getOverlayBounds`' *animated* box,
while `sourceDelta` divides by `start.transform.scaleX/Y` and un-rotates by
`start.transform.rotation` — the **static** values — so a clip animated to 2x
moves its handle at half the pointer's rate, and one animated 45° off its static
rotation grows the crop along the wrong axis. The same accepted family as the
compensating centre above, named rather than discovered. Eight 12px handles also
**overlap** on a clip drawn small on screen, which is inherent to a fixed CSS
size rather than a defect. An **unmount mid-drag commits** the pending move
instead of abandoning it — the gesture's teardown runs the same `throttled.flush()` → `end()` its own
`mouseup` handler does, so a drag cut off by the layer going away (an Escape
fired elsewhere, a selection change, a delete) still writes its last pending
position. **Escape on a focused handle does not return focus to the
inspector's "Crop on canvas" toggle**: the two live in separate component
trees, and reaching across would mean threading a ref through the store, so
the handles unmount and focus falls to the document — the known wart spec §8
names rather than a bug.

Two canvas gestures the crop branch leaves alone: a **double-click still opens
the inline text editor** on a text overlay sitting above the cropped clip
(`handleDoubleClick` stays bound regardless of crop mode, since it only ever
acts on a text clip at the point), which reassigns `selectedClipId` and so
leaves crop mode exactly as spec §1 asks for any other selection change; and
`drawMultiSelectHandles` is a separate callback that still runs and would draw
dashed boxes for any *other* selected clips, though nothing in the app today
appears to reach that — `toggleClipSelection` and `selectClipsInRange`
(`store/selectionSlice.ts`) both reassign `selectedClipId` too, which usually
makes `cropTarget` null before a second clip could join the selection.

**The handle layer needs the canvas element, and the canvas can go away out
from under it** — importing another video, or anything else that empties and
refills the timeline, unmounts the canvas and remounts a new one in the
`hasContent && !isLoading` arm. `PreviewPlayer` used to gate `CropHandles` and
`InlineTextEditorAnchor` on `canvasRef.current` read during render
(`cropping && canvasRef.current && …`), which sees the value from the
*previous* commit — React assigns refs after rendering, as part of the commit
itself — so the render that mounts the new canvas still saw the old, stale
ref for that one pass and dropped the layer until something else (a playhead
move, a selection change) happened to trigger a further render
(ESCSUITE-160). The canvas element is now held in state (`canvasEl`, set by
the canvas' callback ref alongside `canvasRef.current` for the imperative
callers — the draw loop, the chrome, the pointer handlers — that still read
the ref from inside events and effects rather than during render), and both
layers gate on that state instead: the state update lands in the same commit
that mounts the new canvas, so there is no dropped frame to self-heal from.
The marquee selection layer takes no canvas element at all — it gates on
`marqueeActive && marqueeStart && marqueeCurrent`, which come from pointer
events already bound to a mounted canvas — so it never had this gap.

**Committing the inline text editor (ESCSUITE-250).** `handleInlineTextCommit` writes only a
text that is not blank (`trim() !== ''`): an empty or whitespace-only commit restores the
previous text — no write, editing ends — because a text overlay with no text is nothing and
`updateTextOverlayData` would otherwise name the clip `''`. An unchanged text is refused by the
store, not the component, which compares against the live `textData` at commit time.
