<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Testing

Vitest + Testing Library in jsdom, with a v8 coverage floor enforced by `pnpm test:coverage`
(see the root `CLAUDE.md`'s coverage policy for the numbers and the rule that they only go up).

**Tests never mock the module under test.** Doubles stand in for boundaries the browser owns —
screen and camera capture, canvas, WebCodecs, Web Audio, muxing, IndexedDB — never for
CRAFT's own orchestration. A double records what it was asked to do and the test asserts on
the outcome, not on the double.

- **`src/test/doubles/`** — one file per browser API jsdom does not implement, each with a
  header saying what it stands in for and why: `mediastream.ts` (`MediaStream` /
  `MediaStreamTrack`, backed by a real `EventTarget` so an `ended` listener genuinely fires,
  plus `MediaStreamTrackProcessor`), `recorder.ts` (the recorder `core/recorder-factory`
  builds, keeping the same surface over MediaRecorder or WebCodecs), `canvas.ts` (a recording
  `CanvasRenderingContext2D` plus `toBlob`), `video.ts` (the `<video>` elements the code
  creates, which jsdom never loads), `audio.ts` (`AudioContext` and the nodes the recorder and
  converter build on it), `webcodecs.ts` (`VideoEncoder`, `AudioEncoder`, `VideoDecoder`,
  `VideoFrame`, `AudioData`), `mediabunny.ts` (the muxer, recorded rather than run) and
  `browser.ts` (the prototype-level gaps `installBrowserStubs()` fills — media playback,
  navigation from an anchor click, `window.open`).
- **`src/test/appDoubles.ts`** — the collaborator modules the `App.*.test.tsx` files hand to
  `vi.mock`: the recorder factory, permission overrides, thumbnail generation, conversion,
  "send to editor" and analytics. It imports no application code at runtime, so a `vi.mock`
  factory can pull it in while the module it stands in for is still being mocked.
  `resetAppDoubles()` clears every recorded call between tests.
- **`src/test/appHarness.tsx`** — the shared App setup: **`resetRecorderStore(config?)`** puts
  the Zustand store back to a freshly loaded app with every capability present (a missing
  capability is something a test says explicitly), **`renderApp()`** mounts `App` and settles
  its mount-time async work inside `act()`, `flush()` lets promise chains — IndexedDB included
  — settle on a real macrotask even under fake timers, `screenStreamDouble()` /
  `webcamStreamDouble()` / `micStreamDouble()` build the capture streams a take needs, and the
  `installRafDouble()` family drives the PiP compositor's animation frames by hand. It also
  re-exports `installBrowserStubs()` from `doubles/browser.ts`, because every App suite reaches
  for it through this module.
  `flush(rounds = 3)` runs a **fixed** number of real `setTimeout(0)` turns — right for settling
  a render pin (`App.rerender.test.tsx`, `App.mp4rerender.test.tsx` count exactly how many turns
  a given change costs, which is the one place a fixed count is the thing under test, and both
  files stay byte-for-byte on `flush()`'s fixed shape) and wrong for anything whose depth isn't
  fixed. The save chain is the sharpest example: `fixWebMMetadata` → `extractVideoMetadata` →
  `generateThumbnail` → `storeVideo` → `storeThumbnail` runs through two real fake-indexeddb
  transactions, and under load three rounds is not a promise the chain drains in —
  ESCSUITE-114 saw it fail 18 assertions at once in `App.saving.test.tsx`, green in isolation
  and in the runs either side of it. `renderApp()`'s own `flush()` carries the same risk on
  every mount, not just a save: `App` mounting kicks off `useCapabilityBootstrap`'s
  `loadRecordings()`, which is `getRecordingsMetadata()` plus one `getThumbnail()` per stored
  recording — real fake-indexeddb transactions again, one more of them for every recording a
  test has seeded. A call waiting on an *outcome* — a saved row, a deleted one, a download, a
  notice, the library itself — uses `@testing-library/react`'s `waitFor(() => expect(...))`
  instead, polling the real DOM until the assertion holds or its own timeout passes.
  `App.saving.test.tsx`, the delete/MP4 cases in `App.library.test.tsx`, and
  **`renderAppWithLibrary(expectedCount)`** — `renderApp()` plus a `waitFor` on the store
  holding that many `recordings`, used by every test in `App.library.test.tsx` that seeds
  IndexedDB before rendering, since `renderApp()` itself is left exactly as it is — are the
  ones that do; a `flush()` call elsewhere in the suite that isn't behind one of those settles a
  mocked capture promise or a keyboard-shortcut dispatch, neither of which has an unbounded
  chain behind it.

  **Why `waitFor` is safe here even though `setInterval` is faked:** every suite that fakes
  timers does it narrowly — `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })`,
  for the countdown and duration tickers only — and leaves `setTimeout` **real**. `waitFor`'s
  50 ms poll interval is dead weight under that (jsdom's `MutationObserver`, which runs on real
  microtasks regardless of any faked timer, is what actually re-checks the assertion after every
  DOM mutation), but its 1000 ms give-up timer is a real `setTimeout` and does fire — a
  deliberately wrong expectation was confirmed to fail in ~3 test-seconds with the assertion's
  own line, not hang. This is load-bearing: widen that `toFake` list to include `setTimeout` in
  a suite that also uses `waitFor`, and every converted call hangs to `testTimeout` instead of
  failing with a useful message.
- **`*.perf.test.ts` files are ceilings, not benchmarks.** `core/compositor.perf.test.ts`,
  `core/converter.perf.test.ts`, `core/webcodecsRecorder.perf.test.ts` and
  `core/recorder.perf.test.ts` count what a frame, a take or a second of monitoring costs —
  canvas calls, emissions, typed arrays, `VideoFrame`s created versus closed, `encode`/`flush`
  calls — through the same doubles the behaviour tests use. Counts, not milliseconds, so they
  are enforced in CI like any other test. The rule (2x the measured value rounded up, the
  measurement and its date in a comment, conservation laws exact, ceilings only ever lowered)
  is in the root `CLAUDE.md`.
- **The milliseconds come from `pnpm perf`, not from here.** `apps/e2e/tests/perf/
  craft-recording.spec.ts` records real takes in Chromium and reports what they cost in
  time: `craft-screen-recording` (a screen take through `WebCodecsRecorder`),
  `craft-pip-recording` (a composited PiP take through the `Compositor` into MediaRecorder,
  whose rate is `compositedFps` because its encoding is off the main thread),
  `craft-separate-tracks-recording` (the same take with the separate-tracks toggle on: two
  `VideoEncoder`s on one clock, split by encoder identity into `screenFramesEncoded` /
  `webcamFramesEncoded`, with the compositor drawing the preview only — plus, since slice 3, a
  tripwire that exactly **two** `AudioEncoder`s ran, the mix on the primary and the microphone
  companion, and a wait for the take's **three** library rows; system audio is off by default and
  the benchmark never clicks a source toggle, so there is no fourth part there) and
  `craft-mp4-conversion` (`convertToMP4` driven through the row's own MP4 button). They
  measure and never assert; the ceilings above are the half that is enforced. Numbers, and
  the two findings the first measurement produced — the compositor's frame gate, **fixed**
  by ESCSUITE-54 with the paired before/after in that file, and the first-take step, still
  open — are in `docs/performance/2026-09-17-craft-baseline.md`.
- **The separate-tracks mode's end-to-end proof is
  `apps/e2e/tests/escapecraft/separate-tracks.spec.ts`** — a real Chromium take against the
  synthetic capture devices — it clicks **System Audio** on, which is what makes the take four
  parts rather than the benchmark's three — asserting what reached `video-editor-db` (four blobs
  under one `takeId`: the screen, the webcam, and the two audio parts whose bytes are handed to a
  real `decodeAudioData` in the page, the primary carrying `overlayPlacement`) and the four rows
  the library draws for them, each labelled with the track it is. **Address ESCAPECRAFT's
  toggles by exact accessible name in e2e code**: the separate-tracks toggle's accessible
  name — "Record webcam as a separate track" — contains "Webcam", so Playwright's default
  case-insensitive *substring* `name` match silently re-resolved to it the moment the Webcam
  Overlay panel appeared. That is what `apps/e2e/utils/seekable.ts`'s `recordPipTake` (the
  `pip-seekable` guard's own helper, whose second step is the click that reveals the toggle) had
  to stop doing: it now asks for `getByRole('button', { name: label, exact: true })` and scopes
  to no class at all. Its wrapper also used to reuse the four source rows' `sourceToggle`
  CSS-module class, which made `[class*="sourceToggle"]` + `hasText: 'Webcam'` — the shape the
  sibling specs scope with — match it too; since ESCSUITE-68 it carries its own
  `separateTracksToggle` class (same four declarations, copied not composed: it is a *mode*, not
  a capture source), pinned by `WebcamOverlaySettings.test.tsx`. The exact-name rule stands
  regardless — the substring match is the half of the trap a class cannot fix.
- **Semicolon dialect is mixed, deliberately.** The suites the test decomposition added
  (`src/hooks/*.test.ts`, `src/utils/recordingFormat.test.ts`, and their siblings) omit
  line-ending semicolons; the older files (`src/App.library.test.tsx` and friends) carry them.
  There is no `semi` lint rule and normalising the tree is not worth burying an unrelated diff
  in — **match the file you are editing**. Changing this is its own ticket, and it would have
  to be decided for `apps/artist` and `packages/shared` at the same time.
