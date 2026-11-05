# Remove silences (ESCSUITE-403)

Find the pauses in a recording's sound and cut them all in one undoable step.
Filler words and anything model-based are out of scope: detection is a level
threshold over the waveform peaks the editor already has, so it decodes
nothing, fetches nothing and works the same in the offline single-file build.

## Where it is

The inspector's **Actions** section shows **Find silences** for a media clip
when the clip, or a clip linked to it (`linkGroupId`, see
[`linked-clips.md`](linked-clips.md)), has waveform peaks. That covers the
screen part of a separate-tracks take, which carries no sound of its own while
its microphone does. The button is disabled on a locked track.

It opens the **Remove silences** dialog (`components/SilenceDialog.tsx`) with
the list already filled from the defaults:

| Setting | Default | Meaning |
|---|---|---|
| Threshold (dBFS) | −40 | A 10 ms peak bucket whose loudest sample is under this is silent |
| Minimum gap (s) | 0.7 | Shorter pauses are never cut |
| Padding (s) | 0.1 | Kept on each side of every cut, so a word is not clipped at its edge |

Changing a setting finds the pauses again. A field that does not hold a number
in range is marked `aria-invalid` with a hint, and the list stays as it was
until every field reads. Each listed pause has a **Keep** button
(`Keep the pause at m:ss.cc`) that drops it from the list. While the dialog is
open the timeline draws each listed pause as a hatched band through the track
stack (`components/Timeline/TimelineSilenceBands.tsx`, decorative; the list is
the accessible form). **Remove all** cuts what is listed and closes the dialog
with a notice; **Cancel** and Escape cut nothing.

The dialog is a modal like the others in [`dialogs.md`](dialogs.md):
`useDialogBehaviour`, `role="dialog"`, `aria-modal`, labelled by its `<h2>`,
and part of App's `modalOpen`, so the editor takes no key behind it. Its open
flag is the store's `silenceReview` (ui slice, view state: not in the project,
the undo history or a saved file); App subscribes to `silenceReview !== null`
only, so the list changing does not re-render it.

## Detection (`core/silenceDetection.ts`)

Pure functions over `SourceVideo.waveformData` (100 min/max peaks a second of
source, `utils/waveform.ts`):

- `silentRuns` finds runs of silent buckets within a window of the source;
- `cutsFromSilences` keeps runs at least `minGap` long and takes `padding` off
  each end, dropping a run the padding would close up;
- `findTakeSilences(clips, sources, clipId, options)` maps each linked part's
  silent runs onto the timeline, inside the chosen clip's span, and keeps only
  where **every** part with sound is silent (where a part has no clip it counts
  as silent). The minimum gap applies to that shared silence. A part with no
  sound (`hasAudio` not true) is not consulted; a part with sound but no peaks
  (its waveform could not be decoded) is never silent within its clip, so
  nothing is cut there.

Peaks are min/max, not RMS, so a single click inside a pause keeps it. A peak
is read as `SECONDS_PER_PEAK` (479 samples at 48 kHz), not `duration /
peaks.length`: `peaksFromPcm` buckets a track that is not a whole number of
10 ms long in q − 1 samples (q = sampleRate / 100), and reading them as 10 ms
drifted a pause 0.2 s late 100 s in, past the padding. At 44.1 kHz the residue
is ≈ 20 ms per 100 s. Accuracy is then a bucket (10 ms) plus whatever the codec
smears at the pause's edges. The timeline's drawn waveform (`getPeaksForRange`)
still reads `duration / peaks.length`, so over a long recording it sits up to
0.2 % late against the bands.

## The cut (`store/rippleRanges.ts`, `removeTimeRanges`)

`removeTimeRanges(clipId, ranges)` is one store write and one undo step. It
works on the rows `linkedRows` returns: the clip's own row and every row a link
reaches from it, round again until nothing is added, so after a split the
later pieces' partners move too. On those rows `cutTimeRanges`:

- removes whatever lies inside a range, splitting a clip it crosses into the
  pieces outside it (the first piece keeps the clip's id, so the selection
  survives; each piece is a window on the same source; keyframes are trimmed
  to it; the in preset stays only on a piece that starts where the clip did,
  the out preset only on one that ends where it did, as a split leaves them);
- moves every clip and piece left by the time removed before it, which is the
  same at the same timeline time on every row, so a take's parts stay in step;
- keeps link groups segments, as `splitClip` does: in each group, the clips in
  its earliest slot between cuts keep the id, each later slot shares a fresh one.

Rows no link reaches are left where they are, as a clip's ripple delete leaves
them; markers and in/out points do not move either. The cut is refused whole
(`false`, nothing written, no history) when one of those rows is locked, the
clip is gone, no range holds any time, or nothing on the rows would change. The
dialog then says a track is locked, or that the clip is no longer on the
timeline (a host page can replace the project under the modal).

## Tests

- `src/core/silenceDetection.test.ts`: tone separated by 2 s of digital silence
  found within ±50 ms; the minimum gap; padding on both sides; the threshold;
  take-wide intersection.
- `src/store/rippleRanges.test.ts`: both rows cut and closed, a late part cut at
  its own offset, link groups per slot, one undo, locks.
- `src/store/__tests__/silenceRemoval.property.test.ts`: fast-check over takes,
  splits, neighbours and random cuts, with the ESCSUITE-349 `checkInvariants`
  (no overlap among them) and undo/redo identity, plus alignment of every piece
  with its source and one undo restoring the project.
- `src/components/SilenceDialog.test.tsx`: the inspector action, the dialog's
  fields, Keep, Remove all, Escape and the timeline bands.
- `apps/e2e/tests/regressions/ESCSUITE-403.spec.ts`: the A/V fixture seeded as
  a separate-tracks take; the pause found, both rows shortened by it and in
  step, Ctrl+Z and Ctrl+Y, and the WebM export decoded to check the pause is
  gone.
