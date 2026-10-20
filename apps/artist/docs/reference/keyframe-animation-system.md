<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Keyframe Animation System (`src/utils/animation.ts`)
Clips support animated properties via keyframes:
- **Animatable properties**: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`, `blur`, `volume` (audio clips)
- **Easing types**: `linear`, `ease-in`, `ease-out`, `ease-in-out`, plus quadratic/cubic variants
- **Preset animations**: Clips can have in/out presets (`fade`, `slide-*`, `scale-*`, `pop`, `blur`)
- **Custom keyframes**: Per-property keyframe arrays override presets when present; each keyframe's
  easing is editable on its own in the keyframe panel, not only per preset
- **The time-0 seed fires once per property, not once per write (ESCSUITE-166)**.
  `store/keyframeSlice.ts`'s `setClipKeyframe` is the one write that does more than store what
  it is given: the very first keyframe a property ever gets, if it isn't already at time 0,
  also seeds a keyframe AT 0 holding that property's current base value (the clip's transform,
  effect or overlay field, read fresh at seed time), so there is always a "from" value to
  animate out of. The gate is `currentKeyframes.length === 0` — the property's state *before*
  this write — not whether the array about to be written happens to lack a keyframe at 0; the
  latter was also true on every later write to the property, so a keyframe at 0 the user
  deleted, or dragged away to another time, silently came back on the very next unrelated edit
  to that property, snapping the animation's start value back to the static transform. Fixed by
  reading the gate off `currentKeyframes` instead. `moveClipKeyframe`, `removeClipKeyframe` and
  the preset generators below carry no twin of this pattern — none of them re-derive "should a
  keyframe exist at 0" from the array they are about to write.
- `getAnimatedValues(time, clipDuration, animation, transform, effects, options?)`: Returns interpolated values for a given time — the one entry point, for both the preview and the exporters
- **One preset side can be left out of an evaluation (`AnimatedValuesOptions.suppressPreset`,
  ESCSUITE-139)**, and that is the whole of the option argument. `'in'` skips the in-preset,
  `'out'` skips the out-preset, and anything else about the evaluation — the other preset, every
  authored keyframe track, the base transform/effects — is exactly as it was. It exists for the
  renderer's two transition paths — a transition owns the entrance of its incoming clip and the
  exit of its outgoing clip, so the side's own matching preset must not fight it (the Transitions
  note in the Export Pipeline section has the ruling and the plumbing) — and, since ESCSUITE-147,
  for the preview's geometry, which has to measure a clip under the very suppression the frame was
  drawn under. `PRESET_SUPPRESSION` (two frozen option objects, one per side) lives in this module
  for that reason: the renderer and the readers share the one pair rather than each building a
  literal. Deliberately
  **not** a second interpolation routine, and deliberately not a set of "steady state" values
  either: an in-preset's last keyframe and an out-preset's first keyframe already hold the clip's
  base values, so *not generating* the side is identical to treating it as finished / not started,
  for every property that preset drives. It costs nothing — a suppressed side's generator is not
  called at all, `NO_PRESET_KEYFRAMES` is one frozen object for the module, and the perf files'
  animation-lookup counts per frame are unchanged because this is an argument to the one lookup
  each draw already made.
- Keyframes are stored relative to clip start time (0 = clip start)
- There is **no memo cache**. There used to be one (`getAnimatedValuesCached`, keyed
  `clipId:time`, cleared at export start), but an export draws each clip time exactly once,
  so the key never came round and the cache answered nothing while costing a `toFixed`, a
  string concat and a `Map.set` per clip per frame; a preview cannot use a time-keyed cache
  at all, because it redraws the same clip at the same time after every edit. Deleted
  2026-09-12 — `exportMP4.perf.test.ts` pins the lookup count at frames x active clips.
- **Splitting a clip rebases its animation, it does not copy it (ESCSUITE-95)**. Before this,
  `splitClip` built both halves with `{ ...clip }`, so both inherited the parent's whole
  `animation` — same keyframe times, since those are clip-relative, so a fade near the start of
  the original clip replayed from the second half's own start too; and the same in/out presets,
  regenerated against each half's own shorter duration, so one fade-in/out became two.
  `utils/animation.ts`'s `splitAnimation(animation, splitOffset)` is the pure fix `splitClip`
  calls: per property track, the first half keeps every keyframe with `time < splitOffset` and —
  only when the parent has a keyframe at or past the split — appends one synthesised keyframe at
  `splitOffset` holding `interpolateKeyframes`' own value there, so the picture does not jump at
  the new end (when nothing sits at or past the cut, the last kept value already holds, and
  nothing is appended); the second half keeps every keyframe with `time >= splitOffset` shifted by
  `-splitOffset`, prepending a synthesised keyframe at 0 the same way when the parent has a
  keyframe before the split and none at it. A keyframe within `KEYFRAME_TIME_EPSILON` (0.001s,
  the same tolerance `mergeKeyframes` uses to decide two keyframe times are "the same") of
  `splitOffset` counts as sitting at the split either way, so it shifts onto the second half at an
  exact 0 rather than a small residual, and the first half still gets its usual synthesised
  boundary in its place. A synthesised keyframe's easing copies the neighbour it stands in for —
  the keyframe that followed it in the parent for the first half, the one that preceded it for the
  second. Presets split by ownership rather than by geometry: the in-preset stays with the first
  half and the out-preset with the second (fade in at the start, fade out at the end, exactly that
  literally), and the half that loses a preset resets that side to `DEFAULT_ANIMATION`'s "none"
  shape — but a **kept** preset's `duration` is left exactly as authored, even past its own half's
  new, shorter length. That was a deliberate call, not an oversight: the inspector's own slider
  bound (`maxPresetDuration()`, moved to `utils/animation.ts` by ESCSUITE-110 below — still
  re-exported from `clipEditorModel.ts` for every existing import) is a UI limit on new input, not
  an invariant every writer must also enforce, and an unclamped 3s fade-in on a 2s first half still
  renders bit-identically to what the parent clip showed over those same two seconds — clamping the
  duration would have changed the picture instead of preserving it. A **trim**, below, makes the
  opposite call, because it has no "what the parent showed" to fall back on: the trimmed-off
  content is simply gone. `split`
  builds each half with `cloneClip` (the same `structuredClone` helper `duplicateClip` uses)
  rather than `{ ...clip }`, so `transform`, `effects`, `transition`, `mask` and `stroke` are all
  deep-copied too, closing the latent aliasing where every field above shared one object between
  the two halves and only survived it because every writer replaces rather than mutates.
  **What a split does not preserve exactly**: only the two boundary values (and a keyframe already
  sitting at the split) carry over exact. A segment that straddled the cut is re-eased over a
  shorter span on each side — the parent's easing ran end-to-end over its own two real keyframes,
  while each half now runs the same easing function over a fraction of that gap — so for any
  easing other than `linear`, the curve between a synthesised boundary keyframe and its neighbour
  differs slightly from the parent's curve over that same stretch, even though both halves meet at
  the same value at the cut.
- **Trimming a clip rebases its animation too (ESCSUITE-110)**. Shortening a clip from either
  timeline handle used to touch neither the clip's keyframes nor its preset durations: a keyframe
  past the new end sat there as dead weight (still listed in the keyframe panel, never played), and
  a preset longer than the trimmed clip could leave `generateOutPresetKeyframes` computing a
  negative `startTime` — a 2s fade-out on a clip trimmed to 1s opened the clip already part-faded,
  with the keyframe panel plotting that keyframe off the left edge. `utils/animation.ts`'s
  `trimAnimation(animation, { start, end })` fixes both, sharing its keyframe arithmetic with
  `splitAnimation` rather than keeping a second copy of it: `cutEnd`/`cutStart`, the two halves of
  `splitAnimation`'s old inline loop, are now standalone functions both call. `start` and `end` are
  the surviving interval in the clip's ORIGINAL (pre-trim) local-time coordinates, so `end - start`
  is always the trimmed clip's new duration; trimming from the end is `cutEnd(sorted, end)` alone
  (`start` is 0), trimming from the start is that result's `cutStart(_, start, sorted)` (dropping
  and shifting the front — `sorted`, the ORIGINAL uncropped track, is `cutStart`'s `reference`
  argument for the boundary it synthesises at `start`, not `cutEnd`'s already-cropped output: doing
  it the other way re-eases the segment leading up to `start` a second time, over the wrong span,
  and gives a different — for any easing but `linear`, wrong — answer than interpolating the
  original segment once, directly, at `start`), and a combined trim of both edges — not something
  the UI's single-handle drag produces, but the function itself does not assume otherwise —
  composes the two in one pass. Unlike a split, a trim makes only one clip, so there is no ownership
  question for the presets: both `in` and `out` stay on the one clip that remains, each with its
  `duration` clamped to `maxPresetDuration(end - start)` — the same bound the inspector's own
  sliders enforce, and, since this ticket, exported from `utils/animation.ts` rather than
  `clipEditorModel.ts` (still re-exported from there for every existing import) so `trimAnimation`
  does not need a util importing from a component directory — UNLESS the preset's `type` is
  `'none'`, in which case its `duration` is left alone: that field does nothing for a `'none'`
  preset (both generators bail out before reading it), so clamping it would report a number the UI
  never used and would lose whatever it held if the preset were switched back on later. That clamp
  is otherwise the one place a trim's behaviour deliberately parts ways with a split's:
  `splitAnimation` leaves a kept preset's duration untouched even past its own half's new length,
  because an unclamped preset there still renders bit-identically to what the parent clip showed —
  a trim has no such fallback, since the trimmed-off content is simply gone, so the clamp is the
  only way to keep the picture sane. Lengthening a clip (dragging a handle outward) changes nothing
  about its animation at all — the store only calls `trimAnimation` when the new duration is
  strictly shorter than the old one, by construction rather than by any special-case check.
- **Choosing a preset clamps its duration too, not only a trim (ESCSUITE-125)**. `trimAnimation`'s
  clamp above only ever runs when a trim shortens a clip that already has a preset; it never ran
  when a preset was *chosen* in the first place. `useClipEditorActions.ts`'s four preset handlers —
  `handleAnimationInTypeChange`, `handleAnimationInEasingChange`, `handleAnimationOutTypeChange`,
  `handleAnimationOutEasingChange` — carry a `duration` forward from either the clip's existing
  preset or the handler's own `?? 0.5` fallback, and neither of those was ever bounded: picking any
  preset in Animate Out on a clip under 1s stored a duration the clip could not hold, and
  `generateOutPresetKeyframes`' `startTime = clipDuration - duration` went negative — the clip
  opened mid-animation, the same picture ESCSUITE-110 had already fixed for a trim. (The other two
  handlers, `handleAnimationInDurationChange` / `handleAnimationOutDurationChange`, take their
  `duration` straight from the slider that calls them, whose own `max={maxPresetDuration(clipDuration)}`
  already bounds it, so they needed no change.) The fix is the same clamp trimming already makes —
  `Math.min(duration, maxPresetDuration(selectedClip.duration))`, exempting a `type: 'none'` preset
  for the same reason `trimAnimation` does — applied at all four write sites instead of only at
  trim time. Belt and braces: `generateOutPresetKeyframes` itself now also clamps its `duration` to
  `clipDuration` (not the tighter `maxPresetDuration` the UI enforces — just enough to keep
  `startTime` from going negative), so a hand-edited project or a file saved before this fix cannot
  reach the negative-`startTime` picture either, regardless of which handler wrote it.

  **The write goes through `trimClip`, not `updateClip` (review round 1).** The first version of
  this fix put the rebase inside `updateClip` — the one action that moves a clip's `startTime`/
  `endTime` — rebasing from the clip's CURRENT `animation` on every write. A trim writes on every
  mousemove, though, so "current" meant "whatever the previous move of the SAME gesture had already
  cropped it to": dragging a handle in past a keyframe and back out past where the gesture started
  compounded the crop on every move instead of undoing it, and the dropped keyframe never came
  back. `trimClip(clipId, edge, updates, origin, skipHistory?)` is `updateClip`'s replacement for
  this one write, and fixes it two ways. First, GESTURE SAFETY: `origin` — the clip's trim/position
  **and animation** exactly as they stood when the gesture began, threaded from `useTrimDrag`'s
  `TrimOrigin` (captured once, on mousedown) all the way to the store — is what every move rebases
  from, never the clip's live one, so the write is a pure function of (origin, current pointer
  position) rather than of the gesture's history: moving back to exactly where the drag started
  restores the original animation exactly, however many moves came between. Second, EXPLICITNESS:
  which edge moved is `edge`, passed straight through from `TrimState.edge` (the value `useTrimDrag`
  already tracks) rather than inferred inside the action from which of `updates`' fields happen to
  be set — the inference was correct (`updates.startTime` for a source clip's own trim point,
  `updates.timelinePosition` for an extendable overlay/image clip, which has no source to trim so
  its front-trim moves `timelinePosition` instead) but invisible from the type, and its
  `timelinePosition` arm went untested. `updateClip` itself is back to carrying no animation logic
  at all, for its one other caller (`useClipEditorActions.ts`'s mask/stroke handlers, which never
  touch `startTime`/`endTime`) to trip over.

  **Review round 2 finished the job.** `edge` was already explicit for the animation rebase, but
  `trimClip` still guarded its duration recompute on `updates.startTime !== undefined ||
  updates.endTime !== undefined || updates.duration !== undefined` — a second sniff, and, since
  this action has exactly one caller and that caller always sends `startTime` and/or `endTime`, a
  branch no real call could ever take the "false" side of: untestable dead code, and coverage
  said so (the base's `clipSlice.ts` measured 2 uncovered branches; round 1's measured 5). Duration
  is now recomputed unconditionally, with no guard at all, and the front cut for a start-edge trim
  reads `(updates.timelinePosition as number) - origin.timelinePosition` — asserted rather than
  defaulted with `??`, since `computeTrimUpdate` always supplies `timelinePosition` on a start-edge
  update and a caller that broke that contract should get a loud `NaN` rather than a silently-wrong
  `start`. `TrimOrigin` itself moved from `components/Timeline/timelineGeometry.ts` to
  `store/types.ts` — a store action's parameter type belongs in the store, and a second,
  independently-typed copy of the same shape (what round 1 had — `trimClip`'s literal object type
  happened to match `timelineGeometry.ts`'s `TrimOrigin` structurally, but nothing enforced that)
  is exactly the kind of drift that turns into a real bug the day one changes and the other does
  not. `timelineGeometry.ts`'s own `TrimOrigin` is now `export type { TrimOrigin } from
  '../../store/types'` — a re-export, not a second declaration — since a component may import from
  the store but the reverse is not allowed.
- **An extendable clip's pair is always 0 / duration (ESCSUITE-304).** A text or shape overlay, or
  an image clip (`store/extendableClip.ts`'s `isExtendableClip`, the one predicate for it) has no
  source timeline, so its `startTime` / `endTime` are `0` / `duration` — what
  `addTextOverlayClip` / `addShapeOverlayClip` and `convertLegacyOverlays` write. `splitClip` used to
  give the second half of every clip `startTime = <split offset>`, which is right for a media clip
  (its second window on the source starts there) and wrong for an extendable one: `trimClip`
  recomputes `duration = endTime - startTime`, and `computeTrimUpdate`'s extendable arms wrote only
  `endTime = <new length>`, so trimming the second half of a 10 s overlay split at 4 s in by 1 s
  from either edge gave a 1 s clip (`startTime 4`, `endTime 5`), and a trim past the offset a
  negative one that `parseProject` refused on reopen. `splitClip` now gives both halves of an
  extendable clip `startTime: 0, endTime: <own duration>` (a media clip's halves are unchanged),
  and both of `computeTrimUpdate`'s extendable arms write `startTime: 0` beside `endTime`, so a
  clip already carrying a stale offset is put right by its next trim. Either fix alone makes the
  split-then-trim sequence come out right; each has its own pin (`projectStore.timeline.test.ts`,
  `timelineGeometry.test.ts`), and the gesture-level pin in `useTrimDrag.test.ts` reads 1 s only
  with both removed. A file already holding such a pair is repaired by the migration — see
  `projectMigration.ts` in the store table.
