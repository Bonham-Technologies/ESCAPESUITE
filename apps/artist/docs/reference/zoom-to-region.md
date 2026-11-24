# Zoom to region (ESCSUITE-475)

`src/utils/zoomToRegion.ts` (the arithmetic), `src/components/Preview/zoomRegionTarget.ts` (the latch),
`src/components/Preview/ZoomRegion.tsx` (the picker layer and the form) and `useZoomRegion.ts` (the box asked for, fitted).

## What the user does

1. Select a video clip and put the playhead where the zoom should start.
2. Press **Zoom to region** in the inspector's Actions section (video clips only: not images,
   overlays or audio). It is a toggle (`aria-pressed`), and it closes crop mode, whose handles
   would sit in the same place; opening crop mode closes it in turn. Opened from that button, the
   form takes focus on **Region X**; closed with focus inside it, focus goes back to the button.
3. Drag a box on the preview, or type **Region X / Y / width / height** in project pixels. Width and
   height follow each other at the output's aspect ratio. Pick **Hold** (default 3 s),
   **Transition** (default 0.5 s, each of the ease in and the ease out) and **Easing** (default
   Ease In-Out, the inspector's own list).
4. **Apply zoom** writes the keyframes and closes the tool; **Cancel** or Escape closes it writing
   nothing. Escape works from the form and, with focus elsewhere, from the app's Escape cascade
   (after the shortcuts sheet and crop mode, before the in/out points and the selection), so it
   never deselects the clip while the tool is open. A refusal is shown under the fields
   (`role="alert"`) and writes nothing.

The tool is a latch in the UI slice, `zoomRegionClipId`, read exactly like crop mode's
`cropClipId`: it shows only while it names the selected clip, on a visible track, with a video
source, and never while crop mode is open. The store clears both latches whenever
`selectedClipId` changes to another clip or to none, a delete or an undo that prunes the selection
included (`store/toolLatches.ts`, ESCSUITE-500), so selecting the clip again shows the tool
closed; a write that keeps the same `selectedClipId` leaves it open. View state: not in the project, the undo history or a
saved file. The picker layer hides during playback; the form stays. While the tool is open the
canvas' own pointer handling is off and the transform handles are not drawn, as in crop mode.

The form sits between the picture and the info bar. The picture keeps its 120 px floor
(`.videoWrapper`); when the preview is too short for both (a phone, a short window) the form
gives way and scrolls rather than hiding **Apply** under the info bar.

## What it writes

Four keyframes on each of `x`, `y`, `scaleX` and `scaleY`, through one
`updateClipAnimation(clip.id, { keyframes })`, so **one undo removes the whole zoom and one redo
restores it**:

| time (clip time) | value | easing |
|---|---|---|
| start = playhead | the value the clip holds there | chosen easing |
| start + transition | zoomed | `linear` |
| start + transition + hold | zoomed | chosen easing |
| end = start + 2 x transition + hold | the start value | `linear` |

They are ordinary keyframes: the keyframe panel shows, edits and deletes them like any other.
The clip's other keyframes, on these four properties and every other, are kept unchanged. The
`setClipKeyframe` time-0 seed (ESCSUITE-166) is not involved: the write replaces the four tracks
whole.

## The arithmetic: a canvas-space map

Every pipeline draws a media clip as its cropped source rectangle centred at `x * W, y * H`,
`sw * scaleX` by `sh * scaleY` big (`core/canvasRenderer.ts`). Filling the frame with a region R
(project pixels) is the map `p -> (p - R.origin) * k`, `k = W / R.width`, a uniform scale and a
translation of the whole picture, so the zoomed placement is

    x' = (x * W - R.x) * k / W     y' = (y * H - R.y) * k / H
    scaleX' = scaleX * k           scaleY' = scaleY * k

from whatever placement the clip has at the start. **A crop or a non-default base transform needs
nothing special**: the crop only enters through the drawn box the region is clamped to, and a base
transform (or a value the clip's own keyframes hold through the span) is simply the `from`.

The preview and the MP4, WebM and GIF exporters all draw through `drawClipToCanvas`, which reads
`getAnimatedValues`, so a zoom renders the same everywhere. `zoomToRegion.test.ts` checks the
region fills the frame within 1 px at 1080p and is centred at the hold midpoint, both through
`getAnimatedValues` and through `drawClipToCanvas`'s own `drawImage` call;
`apps/e2e/tests/regressions/ESCSUITE-475.spec.ts` checks an exported WebM's pixels.

## The box

`fitZoomRegion` makes any requested box the output's aspect ratio (as wide as asked, or as tall,
whichever is bigger), no narrower than `W / MAX_ZOOM_FACTOR` (10x), no bigger than fits, and
**moves it, not shrinks it, inside the bounds**: the clip's drawn picture at the playhead cut to
the frame (`zoomBounds`). So a box at the edge of the video never shows anything outside the
video. A drag (`dragZoomRect`) grows from the corner it started at towards the pointer. The box
opens at half the frame, centred on the picture (`defaultZoomRegion`). It is re-fitted on every
render, so moving the playhead onto a different placement re-clamps it.

## What it refuses, and says why

- The playhead off the clip, or a zoom longer than what is left of it after the playhead.
- A hold or transition under 0.05 s, or a source whose size is not known yet.
- A masked clip (`mask.kind` other than `none`): a circle or rounded mask would show what is
  behind it once filled to the frame.
- A rotated clip (rotation is not 0 at the start).
- **An overlap**: any keyframe, or Animate In/Out preset point, of `x`, `y`, `scaleX`, `scaleY` or
  `rotation` inside `[start, end]` (named: property, kind, time), or keyframes on either side of
  the span whose values differ (the property animates across it; named with both times). Keyframes
  either side holding the same value are fine: nothing moves there, so writing the zoom between
  them changes nothing before or after it.
- A clip not in the frame at the playhead, or covering less than one tenth of its width.
- A locked track (the form says so; `updateClipAnimation` would refuse anyway, ESCSUITE-84).

## Out of scope

Automatic zoom from cursor or click data, zooming overlays or captions, motion blur.
