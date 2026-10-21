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
