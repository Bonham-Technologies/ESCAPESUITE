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
the accessible form). **Move everything after each cut** (a checkbox, on each
time the dialog opens, ESCSUITE-434) decides whether the rest of the timeline
moves with the cut (below); its hint, its `aria-describedby`, says which.
**Remove all** cuts what is listed and closes the dialog with a notice;
**Cancel** and Escape cut nothing.

The dialog is a modal like the others in [`dialogs.md`](dialogs.md):
`useDialogBehaviour`, `role="dialog"`, `aria-modal`, labelled by its `<h2>`,
and part of App's `modalOpen`, so the editor takes no key behind it. Its open
flag is the store's `silenceReview` (ui slice, view state: not in the project,
the undo history or a saved file); App subscribes to `silenceReview !== null`
only, so the list changing does not re-render it.

## Detection (`core/silenceDetection.ts`)

Pure functions over `SourceVideo.waveformData` (about 100 min/max peaks a
second of source, `utils/waveform.ts`):

- `silentRuns` finds runs of silent buckets at a known peak rate;
  `certainSilentRuns` does the same over a peak-length range (below);
- `cutsFromSilences` keeps runs at least `minGap` long and takes `padding` off
  each end, dropping a run the padding would close up;
- `findTakeSilences(clips, sources, clipId, options)` maps the silent runs of
  every clip it listens to onto the timeline, inside the chosen clip's span,
  and keeps only where **all** of them are silent. The minimum gap applies to
  that shared silence.

### What it listens to

The cut (below) removes time from every clip on every row `linkedRows`
reaches, not only from the chosen clip's link group, so detection listens to
the same set (`listenedClips`): every non-overlay clip that overlaps the
chosen clip's span on any of those rows and whose source has sound
(`hasAudio`). That covers the take's other parts, and also a music bed or a
voice-over on a partner's row, or anything on a row only a later piece's link
reaches. Where such a clip is absent it does not speak. A clip with no sound
(a screen part, a silent video) does not block a cut. A clip with sound but no
peaks (its waveform could not be decoded) is never silent within its span, so
nothing there is cut. The first version listened only to the link group, so a
music clip on the microphone partner's row was cut wherever the microphone
paused.

Peaks are min/max, not RMS, so a single click inside a pause keeps it.

### Peak timing (`utils/peakTiming.ts`)

Since ESCSUITE-418 a peak is exactly 10 ms: `peaksFromPcm` / `PeakReducer` put
peak i over samples `[floor(i · q), floor((i + 1) · q))`, q = sampleRate / 100
(`bucketStart`), with a shorter last peak for the track's remainder, so peak i
starts within a sample of i × 10 ms at any rate and length (`waveformPeaks.ts`).
Before it a peak was `floor(L / ceil(L / q))` samples: q − 1 for a length that
is not a whole number of buckets, q for one that is, so it lasted
`0.01 − 1/sampleRate` or `0.01` s depending on the rate and the exact length.
Read at one fixed length, those peaks drift: the first version of this feature
read every track as 48 kHz's 479 samples, which put a pause at 44.1 kHz
0.18 ms/s late (padding gone after ~9 minutes), at 32 kHz 1 ms/s (~96 s), at
16 kHz 4.2 ms/s (~24 s; `decodeAudioData` resamples to the output device's
rate, which a headset can set to 16 kHz), and a 48 kHz track an exact number of
buckets long 2.1 ms/s early. Such peaks are still in caches and project files.

So the extractors report each peak's length (`extractWaveformData`'s
`secondsPerPeak`, `peakSecondsFor`: 0.01 since ESCSUITE-418, the old bucket
over the rate actually decoded at before it), and every writer of `waveformData` stores it beside the
peaks as `SourceVideo.waveformSecondsPerPeak`: the importers
(`videoProcessor.ts`), the take handoff (`takeImport.ts`), the load-time
rebuild and its write-back (`projectManager.ts` `restoreWaveform`,
`storage.ts` `storeRebuiltWaveform`). A rebuild or a stored row's peaks bring
their own length or none; a length is never paired with other peaks.
`peakTimingOf(source)` reads it, and accuracy is then a bucket (10 ms) plus
whatever the codec smears at a pause's edges.

**Peaks without a recorded length** (imported, cached or saved before this
change) are read conservatively, not guessed. The rate they were decoded at
was not kept, so their length is only known to lie between a bucket one
sample short at 8 kHz (`LOWEST_SAMPLE_RATE`, 9.875 ms) and a whole 10 ms.
`certainSilentRuns` keeps only what is silent at **every** length in that
range: a run of silent buckets `[i, j)` counts from `i × 10 ms` to
`j × 9.875 ms`. A cut can then only be shorter than the pause, never eat into
the sound either side, and the padding is kept in full on both sides. The
cost is that the certain part of a pause shrinks by 1.25 % of its position
(0.75 s a minute in), so a pause more than a minute or two into a long legacy
recording is left in. The dialog then says so (`hasApproximateTiming`: "Part
of this recording's waveform was made by an earlier version of
ESCAPEARTIST…"). Nothing rewrites legacy peaks to upgrade them: re-decoding
every legacy source on load is a cost this feature does not justify alone,
and importing the file again gives a source with exact timing. A recorded
length outside 9–10.1 ms (no extractor writes one; a hand-edited file could)
is read as absent.

`peakTimingOf` is the one place peak timing is decided. Its `estimate` (exact
when recorded, 479/48000 otherwise) is what the timeline draws by
(ESCSUITE-418): `TimelineTrack` passes `drawnSecondsPerPeak(source)` to
`AudioWaveform`, and `getPeaksForRange` maps peak i to `i × secondsPerPeak`
rather than spreading the peaks over the source's duration, so the waveform's
quiet stretches sit where these cuts and their bands are. Legacy peaks are
drawn at the estimate only while it accounts for the source's duration (within
1 %; extractor peaks are ~100 a second), and spread over the duration otherwise.

### File format (additive)

`waveformSecondsPerPeak` is an optional field of `SourceVideo`
(`packages/shared/src/types`), so it is also saved in a `.veditor`'s per-source
`meta` beside `waveformData` (`saveProject`). Strictly additive: a file without
it loads as before (its peaks read as legacy, above); a file with it loads in
an older ESCAPEARTIST, which spreads `meta` into the source and never reads
the field, and in the headless kit, whose `meta` check ignores unknown fields.
The container version is unchanged.

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

With the box cleared, rows no link reaches are left where they are, as a
clip's ripple delete leaves them, and markers and in/out points do not move
either. The cut is refused whole
(`false`, nothing written, no history) when one of those rows is locked, the
clip is gone, no range holds any time, or nothing on the rows would change. The
dialog then says a track is locked, or that the clip is no longer on the
timeline (a host page can replace the project under the modal).

### Moving everything after each cut (ESCSUITE-434)

Cutting the take's rows alone left a Blur, a text or shape overlay, the
Captions track, markers and in/out points on other rows where they were, so
everything after the first pause drifted out of step with what it was placed
on. With the box on (the default), `removeTimeRanges(clipId, ranges, true)`
also passes every **other unlocked row** to `cutTimeRanges` as a row to move,
not to cut (`shortenClip`):

- a clip there moves left by the time removed before it;
- one a range crosses is **shortened** by the time removed within it, off its
  out point, and stays one clip (same id): an overlay or a caption is not
  split, a media clip keeps its in point and plays on continuously. Its
  keyframes keep their place in what is left: one inside a range goes, each
  later one moves left by the time removed before it in the clip, and the
  presets are capped to the new length as a trim caps them;
- one a range covers whole is removed, as it is on the take's rows;
- link groups on those rows are left as they are.

The markers and the in/out points move the same way (`cutEditorBlock`): each by
the time removed before it, so one inside a pause lands where the pause closes
up. They live outside `Project` (ESCSUITE-245) and outside the undo history, so
this edit's history entry carries them (`UndoableState.editor`, taken only when
they moved): undo and redo across it restore them with the clips, one Ctrl+Z
for everything. No other entry carries them, so undoing any other edit leaves
them as it always has.

**Locks.** A lock on one of the take's own rows still refuses the whole cut. A
locked row anywhere else is not moved (a lock means "don't touch"), and the cut
goes ahead around it: what is on it stays put and is left behind.

The detection is unchanged: it listens only to the take's rows, since the other
rows are shortened, never cut through.

## Tests

- `src/core/silenceDetection.test.ts`: tone separated by 2 s of digital silence
  found within ±50 ms; the minimum gap; padding on both sides; the threshold;
  take-wide intersection; a pause 590 s into a 600.013 s track at 44.1, 32, 16
  and 48 kHz (and a 48 kHz track a whole number of buckets long) found within
  ±50 ms with the padding kept, through the streamed and the whole-file peaks;
  the same tracks without a recorded length never cut into sound; a music
  clip on a partner's row, an unlinked clip on a transitively reached row, a
  silent video clip and an unreadable clip; and a fast-check property that no
  cut crosses sound in any audible clip on any row the cut touches.
- `src/utils/waveformPeaks.test.ts`, `src/utils/waveform.test.ts`: the
  reported peak length on both extraction paths. `projectManager.test.ts`,
  `videoProcessor.test.ts`, `takeImport.test.ts`: every writer stores it, a
  save round-trips it, a rebuild and a stored row carry their own.
- `src/store/rippleRanges.test.ts`: both rows cut and closed, a late part cut at
  its own offset, link groups per slot, one undo, locks; with everything moved,
  other rows moved and shortened, overlays not split, captions, keyframes,
  markers and in/out points, a locked other row, one undo and redo.
- `src/store/__tests__/silenceRemoval.property.test.ts`: fast-check over takes,
  splits, neighbours and random cuts, with the ESCSUITE-349 `checkInvariants`
  (no overlap among them) and undo/redo identity, plus alignment of every piece
  with its source and one undo restoring the project; with the box on, every
  clip on another unlocked row moved and shortened (never split), a locked row
  untouched, the markers and in/out points moved, and one undo restoring them.
- `src/components/SilenceDialog.test.tsx`: the inspector action, the dialog's
  fields, Keep, Remove all, Escape, the timeline bands, the note for legacy
  peaks, and the "Move everything after each cut" box both ways.
- `apps/e2e/tests/regressions/ESCSUITE-403.spec.ts`: the A/V fixture seeded as
  a separate-tracks take; the pause found, both rows shortened by it and in
  step, Ctrl+Z and Ctrl+Y, and the WebM export decoded to check the pause is
  gone.
- `apps/e2e/tests/regressions/ESCSUITE-434.spec.ts`: the same take with a Blur
  across the pause, a Blur, a marker and an out point after it; with the box on
  the first Blur is shortened and stays one clip, the rest move left by the
  pause, and one Ctrl+Z puts all of it back.
