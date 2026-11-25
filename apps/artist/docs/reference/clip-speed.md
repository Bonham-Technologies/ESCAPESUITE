# Clip speed (`src/store/clipSpeed.ts`, ESCSUITE-471)

A video or audio clip can play from **0.25×** to **4×**, so the waiting parts
of a screen recording (a build, a page loading) play faster. To speed up just
one section, split the clip around it and set the middle piece's speed.

## The model

- `Clip.speed?: number`: source seconds per timeline second. **Absent means
  1**, which is every clip never sped and every clip of a project written
  before this ticket. Setting a clip back to 1 drops the key, so it is the
  clip it was.
- A clip keeps its source span (`startTime`/`endTime`). Its timeline length is
  `duration = (endTime - startTime) / speed`, and the source time under the
  playhead is `startTime + clipTime * speed`. Every reader goes through
  `sourceTimeAt`, `clipTimelineLength` or `sourceSpanToTimeline` in
  `clipSpeed.ts`, never its own arithmetic.
- `clipSpeed(clip)` reads 1 for an overlay, and for a value outside the range,
  whatever the clip carries. Only media clips get a speed (`canHaveSpeed`):
  an overlay or an image has no source timeline.
- Keyframe times (`Keyframe.time`) stay in **timeline** seconds from the clip's
  start, as before. Volume keyframes are read in timeline time too.

## Setting it (`setClipSpeed`)

The inspector's **Speed** section (video and audio clips, after Transition
Out, collapsed until opened) offers 0.25×, 0.5×, 1×, 1.5×, 2× and 4×, plus a
field for any speed in the range (committed on Enter or blur and clamped to
the range, `useCommittedNumberInput`). The section header and the clip on the
timeline (`2.5s · 2×`) show a speed other than 1×. One line says what happens to
the sound, and one says why when the store refuses a change.

`setClipSpeed(clipId, speed)` is one undo step and:

- applies to the clip **and every linked media clip** (a take's screen and
  microphone stay in step). Each part keeps its span; its offset from the
  group's earliest start is scaled by `oldSpeed / newSpeed`, so a microphone
  captured half a second after the screen still lines up;
- scales each keyframe's time by `oldSpeed / newSpeed`, so a keyframe stays on
  the source moment it was set on, and caps the in/out presets and a
  Transition Out at `maxPresetDuration` of the new length;
- **ripples**: the clips that start at or after the group's old end move by
  the length the group gained or lost, all by the same time, on the group's
  rows and every row a link reaches from them (`linkedRows`, the rows a cut
  moves together), so a later take stays in step even with a part (a camera)
  on a row this take never reaches. Other rows, markers and in/out points do
  not move;
- refuses (`false`, nothing written) a speed outside the range, the speed the
  clips already have, an overlay or image, a clip or linked part on a locked
  track, a clip it would move on a locked track, and a change that would run a
  part or a moved clip into a clip it does not move (one that sits between a
  part's end and the group's end on that row): a slow-down's longer part, or a
  speed-up's later clips pulled back over it.

## Playback and export

- **Preview** (`usePreviewRenderLoop`): each element plays at
  `playbackRate = speed` with `preservesPitch` (and `webkitPreservesPitch`)
  off, so the preview sounds as the export does; muted above 2×. A scrub seeks
  to `sourceTimeAt`.
- **Export** (MP4, WebM and GIF, and so the headless render, which runs the
  same exporters through `parseProject`): `exportMP4.ts` and
  `elementFrames.ts` (the WebM, GIF and MP4 fallback composer) fetch each frame
  at `sourceTimeAt`, a transition's two sides included. The frame-source and
  decode-worker layers take source times and needed no change.
- **Sound** (`audioMixer.ts`): up to `MAX_AUDIBLE_SPEED` (2×) the clip's
  sound is **resampled** (linear interpolation, `mixResampled`), so it changes
  pitch with the speed and every sample stays under the frame it was recorded
  with. Above 2× the clip is **silent** in the preview, every export and the
  speech mix, and is no reason for sound in `audioCandidateSources` (the
export dialog's sound note, and the headless render's no-AAC MP4 refusal).
Pitch-preserving time-stretch is out of scope. The resampler
  writes each output frame once; a frame whose interpolation partner is in the
  next decoded chunk is written held and corrected when that chunk arrives.

## Edits on a sped clip

| Edit | Behaviour |
|---|---|
| Trim | The pointer's travel is scaled into the source by the speed (`computeTrimUpdate`, `TrimOrigin.speed`); the minimum length and the neighbour clamp are timeline lengths |
| Split | Cuts at `sourceTimeAt(clip, splitTime)`; both halves keep the speed |
| Ripple delete | Closes the gap by the clip's timeline length |
| Crop, mask, transform, effects | Unaffected (static, or keyed in timeline time) |
| Keyframes | Stay in timeline time; a speed change rescales them (above) |
| Transitions | Play over the clip's timeline end; each side's frame is fetched through its own speed |
| Remove silences | Supported: peaks are read in source time and mapped to the timeline through the speed (`findTakeSilences`); a clip above 2× is silent, so it does not stop a pause being one; the minimum gap and padding are timeline seconds, so a sped clip's pauses are judged by how long they play |
| Transcription | Supported: it transcribes the timeline's speech mix, so a sped clip is heard as exported (pitched, or not at all above 2×) and its captions land in timeline time. A pitched voice may be recognised less well |

## Project file

`speed` is an additive field: no format version change. `parseProject`
refuses a `speed` that is present and not a number from 0.25 to 4, one on an
overlay (other than 1), and one other than 1 whose clip's `duration` is not
`(endTime - startTime) / speed` (to 1e-6 of the length; a hand-written 1 is
held to nothing a clip without a speed is held to): a hand-made file or
headless job spec that left `duration` at the unsped length would play the
source at one rate and lay the clip out at another. An image clip carrying a
speed in a hand-edited file is not refused (the project lists no media
types); nothing the app writes produces one.

## Tests

`src/store/clipSpeed.test.ts` (model, store action, edits, project file),
`src/core/audioMixer.speed.test.ts` (resampling, A/V sync at 0.5×, 1.5× and
2×, silence above 2×), `src/components/ClipEditor/SpeedSection.test.tsx`, and
the Playwright spec `apps/e2e/tests/regressions/ESCSUITE-471.spec.ts` (2× from
the inspector on the A/V fixture, a WebM export 2.5 s long with its silence and
its pictures where the source's land at 2×), and
`apps/e2e/tests/escapeartist/clip-speed-editing.spec.ts` (ESCSUITE-522: a 2×
clip split at the playhead, trimmed by its end handle, every step undone and
redone, saved and reopened in a fresh browser, each length read off the
timeline; a linked screen and microphone take at 0.5×, its microphone's
offset scaled and both rows cut at the same time).
