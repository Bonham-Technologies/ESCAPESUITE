<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Testing

Vitest + Testing Library in jsdom, with a v8 coverage floor enforced by `pnpm test:coverage`
(see the root `CLAUDE.md`'s coverage policy for the numbers and the rule that they only go up).

**Tests never mock the module under test.** Doubles stand in for boundaries the browser owns —
canvas, media elements, WebCodecs, Web Audio, workers, IndexedDB, layout — never for ARTIST's
own orchestration. A double records what it was asked to do and the test asserts on the
outcome, not on the double.

- **`src/test/doubles/`** — one file per browser API jsdom does not implement, each with a
  header saying what it stands in for and why it has to exist: `canvas.ts` (a recording
  `CanvasRenderingContext2D` plus `toBlob`), `media.ts` (the `<video>`/`<img>`/`<audio>`
  elements the code creates, which jsdom never loads or fires events for), `audio.ts`
  (`AudioContext`/`OfflineAudioContext` and real sample data to decode), `webcodecs.ts`
  (`VideoFrame`, the encoder/decoder capability probes, and working encoders for the export
  pipeline), `mediabunny.ts` (the muxer, recorded rather than run), `resizeObserver.ts`, `fileReader.ts`,
  `files.ts` (a `File` on Node's `Blob`, which survives fake-indexeddb's structured clone),
  `globals.ts` (take a global away, the way a browser without that API looks) and `layout.ts`
  (`setRect`/`setRects` — jsdom performs no layout, so every `getBoundingClientRect()` is
  all-zero until a test gives an element a box).
  `./gifEncoder` is the one *application* module that is mocked by name rather than a browser
  boundary (ESCSUITE-34): `exportGIF.test.ts` and `exportGIF.perf.test.ts` count `addFrame` calls
  through it, because the canvas double's `getImageData` answers a 1x1 frame whatever size it is
  asked for and the real quantiser would be reading past the end of it. The real `gifenc` is run
  by `core/gifEncoder.test.ts`, which is the only place it needs to be — so "tests never mock the
  module under test" still holds: the module under test there *is* the wrapper.
- **`src/test/fixtures/`** — shared data and the store reset. `projectStore.ts` exports
  `store()`, `addClip()` and **`resetStoreForTest()`**, which puts the module-singleton store
  back to a freshly loaded editor holding one source video (`resetProject()` alone leaves
  `zoom`, `activeTool`, `loopPlayback`, `cropClipId`, the keyframe panel and the history behind).
  `store()`'s action calls run inside `act()`, because a zustand change with a component
  mounted is a React update. `animation.ts` and `clipFixtures.ts` hold the clip/transform
  and export shapes their suites share.
- **Render helpers** — `src/test/renderApp.tsx` exports **`renderApp()`** (mount `App` and let
  its mount-time session lookup and URL-parameter work resolve inside `act()`) and
  `settleApp()` for the same wait mid-test. `src/test/renderPreview.tsx` exports
  **`renderPreview()`**, which mounts `PreviewPlayer` against every double it needs, gives its
  canvas a layout box, waits out the debounced redraw, and returns the recorded canvas calls
  split into composited frames, plus `settle(ms)` (advance the fake clock, run the animation
  frames that fall due, flush the promises, all inside `act()`).
- **`src/test/appDoubles.ts`** holds the collaborator modules the `App.*.test.tsx` files
  hand to `vi.mock` (storage, project manager, integration, video processor);
  `src/test/domQueries.ts` holds the label-based control queries the editor panels share.
- **Fuzz tests** (ESCSUITE-294) — `src/test/fuzz.ts` is a seeded mutation harness (a written-out
  mulberry32 `createRng(seed)`; byte mutations `truncateAt`, `flipBit`, `resizeDeclared`,
  `swapRanges`; JSON mutations `deleteKey`, `swapType`, `injectNumber`, `nestDeep`, `growArray`,
  drawn together by `mutateJson`; and `expectNamedRefusal(run, isExpected, context)`, which passes
  when `run` returns or refuses with an error `isExpected` accepts and a non-empty message, and
  fails on anything else, a promise still pending after 2 s included). Each input parser has a
  `*.fuzz.test.ts` beside its suite asserting its refusal contract over a few hundred mutations
  of a real input: `core/projectFileFormat.fuzz.test.ts` (the v2 reader, then `loadProject`:
  a `ProjectFileError` or a load, nothing written on a refusal; since ESCSUITE-298 a mutated file
  that loses its magic is driven down the v1 path rather than skipped, and a third loop mutates a
  real v1 file), `store/projectMigration.fuzz.test.ts`
  (`parseProject` returns `{ ok: false, reason }` and never throws, and since ESCSUITE-300 every
  clip it parses has a finite duration above 0) and
  `app/useHostIntegration.fuzz.test.ts` (one `INVALID_MESSAGE` or `INVALID_PROJECT` reply, nothing
  applied). The seed is a constant per file and the iteration count is fixed, so a run is
  deterministic and prints nothing when it passes. Each loop also tallies how many inputs parsed
  and how many were refused and holds both to the counts measured on its seed
  (`expectTallyAtLeast`), because the per-input contract cannot see a parser that quietly turns
  lenient; a change that moves an input across the line on purpose updates those numbers and
  says why. **Reproducing a failure:** the message names the
  seed, the iteration and the mutation in words (`seed 0x5eed0294, iteration 23 … mutation: nestDeep
  project.timeline.shapeOverlays[0] -> depth 116`); rerunning the file replays it exactly, and
  `setAt` / `nestDeep` / the other operators rebuild that one input for a standalone test. The
  headless kit has the same harness, written out again (`services/headless-artist/test/fuzz.ts`).
  The first run found `parseProject` throwing a `TypeError` for a malformed legacy overlay array
  and for a null `tracks` entry (through the host channel, an unhandled rejection with no reply);
  both are refused by name now (see `projectMigration.ts` above), and each input that found them
  is kept as a regression test beside its fuzz case.
- **Property-based timeline tests** (ESCSUITE-349) — `store/__tests__/timelineInvariants.property.test.ts`
  uses [fast-check](https://fast-check.dev) to generate sequences of 1–30 edits and runs each
  through the model in `src/test/timelineModel.ts`, which drives the store the way the editor's
  own gesture does: **add** a clip (the media library's add, at a playhead), **split** (the razor,
  through `getSplitOffset`), **delete**, **ripple delete**, **move** (to a time on a row, or onto /
  before / after another clip, snapped and vetoed as `useClipDrag`'s mouseup does), **trim** (either
  edge, one to three pointer moves through `clampTrimToNeighbours` → `computeTrimUpdate` →
  `trimClip` with a gesture history, and with the ripple tool the `shiftClipsAfter` on release),
  **duplicate**, **undo**, **redo**, and **save → load** (the real `saveProject` writer, the download
  captured from `URL.createObjectURL`, `loadProject`, `parseProject`, then `useProjectActions`'
  reset / `setProject` / `addSourceVideo` / `clearHistory` sequence). The media pool is two videos
  with embedded audio, an audio-only file (all with waveform peaks) and an image.

  **The invariants**, checked after every step:
  1. *Audio counterparts.* Every audio stream a clip plays (`audioCounterparts`) covers exactly
     the clip's picture span (`pictureSpan`): the same timeline range and the same source range.
     On `main` the only counterpart is a clip's **embedded** audio, which `core/audioMixer.ts`
     mixes from `startTime` for `duration` seconds while the picture and the waveform read
     `startTime`/`endTime`. There is no clip linking yet; when linked separate-track clips land,
     `audioCounterparts` returns one more span per linked partner and the invariant covers them
     unchanged.
  2. *Lengths and ranges.* Every number is finite, `duration > 0` and equals `endTime - startTime`,
     `timelinePosition >= 0`, `0 <= startTime < endTime <= source duration` (an extendable clip's
     pair is `0` / `duration` instead), and the clip's source and track exist.
  3. *No overlap.* No two clips on one row overlap by more than `OVERLAP_EPSILON` (the model never
     imports captions, the one importer allowed to keep overlaps).
  4. *Waveforms.* A clip whose source has audio resolves, after any load too, to that source's own
     peaks, and `getPeaksForRange` gives it a non-empty window of them.
  5. *Round trip.* save → load hands back the saved project and library (only the sources a clip
     uses, as `saveProject` writes), and a second save writes the same index and the same media
     bytes. **Exception:** `project.modified`, which a load stamps with the time, is blanked in both
     before comparing. (JSON writes `-0` as `0`; the fixture peaks avoid `0` so they survive exactly.)
  6. *Undo / redo.* Undo then redo (and redo then undo) returns the identical state, byte for byte
     as JSON, with the same stack depths; and every `undo` lands on exactly the project the model
     recorded before the edit it undoes (`redo` likewise).
  7. *Per-op postconditions* (`checkPostcondition`): every clip an edit does not name is unchanged
     (a ripple's downstream clips may change `timelinePosition` only); split halves tile the whole and
     keep playing the same source at every instant; a move changes only row and position; an end
     trim never moves the start or in point, a start trim never moves the end or the source under
     the clip.

  **Running it.** CI runs 200 sequences on the fixed seed `0x5eed0349` (about 2 s). A failure prints
  fast-check's shrunk counterexample — the op list — with the seed and path; paste the list into
  `store/__tests__/timelineInvariants.counterexamples.test.ts` as `runSequence([...])` to keep it.
  Locally, `pnpm --filter=@escapesuite/artist test:fuzz` runs 5,000 (`ARTIST_FUZZ_RUNS`, about 75 s),
  and `ARTIST_FUZZ_SEED=<n>` picks another seed. After the run the suite also asserts a floor on
  real edits (`opCounts`): at least 40% of all ops, and per kind at least one change per 20 runs
  (redo: one per 100), must change the project or the library, so a generator that drifts into
  no-ops fails instead of passing vacuously.

  **Known bugs: guards and `it.fails`.** The suite's first runs found three bugs, filed as
  ESCSUITE-363 (a start trim dragged left of 0 clamps the position but not the in point, so the
  clip's end moves and its picture and sound slip) and ESCSUITE-364 (the ripple shifts in
  `shiftClipsAfter` and `rippleDeleteClip` compare `>=` with no tolerance, so a clip butted a float
  hair before the edge is left behind and overlapped: one guard for the ripple end trim, one for
  the ripple delete; both fixed, guards removed). So that a known bug cannot turn `main` red when a generator change makes
  fast-check draw different sequences, `applyOp` in `src/test/timelineModel.ts` detects each
  trigger and throws `KnownBug` (carrying the ticket key) before the invariants see it; the
  property test catches it and discards the sequence with `fc.pre(false)`. The guards only skip a
  sequence, they never loosen a check. Each bug is still exercised: the counterexample file runs
  its shrunk sequence with the guards off (`resetModel({ guards: false })`, `runSequence(ops,
  { guards: false })`) as an `it.fails` test that asserts the correct behaviour, so it passes
  while the bug is there and fails the day it is fixed. **A fix PR** deletes its ticket's guard
  (each is commented with the key) and flips its `it.fails` to `it`. With the guards in place,
  `test:fuzz` passes on the default seed (5,000 runs, 2026-10-22); before them it failed on
  ESCSUITE-363 at run 248.

  **Adding an operation.** Add a member to `Op` and a `case` to `applyOneOp` in `src/test/timelineModel.ts`
  that calls what the editor's gesture calls (its hook's helpers and store actions, never
  `useEditorStore.setState`), say in `checkPostcondition` what the op may change, and give it an
  arbitrary (with a weight) in the property test's `opArbitrary`. Indices into clips, tracks and
  sources are taken modulo the list at the moment the op runs, so every generated sequence is valid
  and shrinks to a smaller valid one. The per-step invariants apply to the new op with no further
  work.
