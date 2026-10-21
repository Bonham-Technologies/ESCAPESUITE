<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Core Modules (`src/core/`)
- `storage.ts`: IndexedDB layer using `idb` library. Stores video blobs, thumbnails, projects, and settings in separate object stores. `video-editor-db` is shared with ESCAPECRAFT (root `CLAUDE.md`, Data Flow), so **nothing in ARTIST clears a whole object store** — every bulk delete iterates the ids the library itself holds, per id, the way the media library's Clear All and Clear Unused both do (ESCSUITE-142); `clearAllVideos()` and `clearAllData()`, the two functions that used to do exactly that, were deleted for this reason. `resolveThumbnailUrl(id)` is the one mechanism for turning a *stored* thumbnail into a live `URL.createObjectURL` handle — `undefined` when nothing is stored — that both `projectManager.loadProject` and `useSessionRestore.handleRestoreSession` call rather than trusting a `thumbnailUrl` that arrived from disk (ESCSUITE-96). `revokeSourceThumbnails(sources)` is the other half: nothing else ever frees that handle, so it is the one function every path that retires a `blob:` `thumbnailUrl` calls — a no-op for a source with none, or with a non-`blob:` URL. `revokeThumbnailUrl(url)` is the same revoke for a single handle that is not (yet) a source's, so a caller holding one does not fabricate a `SourceVideo` to get it past the guard; `revokeSourceThumbnails` is written in terms of it, so there is still one place a thumbnail handle is freed and one `blob:` check to read. Its callers each own a moment a source's *old* handle stops being needed: `store/projectSlice.ts`'s `removeSourceVideo` (the one leaving), `removeSourceVideosPermanently` (every one in the batch, on a storage clear — ESCSUITE-149) and `resetProject` (all of them, on teardown); `addSourceVideo`'s replace-in-place branch, when a re-add under an id already held carries a *different* `thumbnailUrl` than the one it is replacing — the one place a source's thumbnail changes without the source itself ever leaving the library, and so the one place a session restore landing on a library the CRAFT handoff already filled can free just the id it actually replaces, leaving every other handed-off thumbnail live; and `useProjectActions.ts`'s `loadProjectFile`, over a REFUSED load's *incoming* sources (anything that throws after `loadProject` minted their thumbnails; since ESCSUITE-260 `loadProject` refuses a project `parseProject` refuses itself, before minting or storing anything) — the outgoing library on a *successful* load is `resetProject`'s to free, not this callback's, so the same URLs are never revoked twice (ESCSUITE-113). A handle that never reached the library at all — `setSourceThumbnail`'s, when the media library's lazy rebuild lost a race with a real load — goes through `revokeThumbnailUrl` directly (ESCSUITE-117). **Nothing else revokes a `SourceVideo.thumbnailUrl`** — in particular the `?loadVideo=` handoff (`useHostIntegration.ts`) keeps no owner of its own: it used to hold the URLs `importTake` had already handed to `addSourceVideo` and revoke them in its effect's cleanup, which under StrictMode's double mount (every development build) left every tile of the take dead, because the second run finds the parts already in the library and mints nothing to replace them with (ESCSUITE-117). Undo/redo never call it — a source coming back via redo still needs a working URL — but a `thumbnailUrl` a revoke just killed is also scrubbed (to `undefined`, not rebuilt) out of every undo/redo snapshot that still carries the same string, by `scrubDeadThumbnails` (`store/storeHistory.ts`), called from the same action that revokes: undoing back past a removal, a reset or a replace lands a source with no thumbnail rather than one nothing can ever open, the same as a source that never had one. Since ESCSUITE-117 it does not wait to be genuinely reloaded either: `VideoLibrary` (`components/VideoUploader.tsx`) calls `resolveThumbnailUrl` for every source in the library that has no `thumbnailUrl` — once per source per mount, in-flight ids tracked in a ref so a re-render issues no second read — and hands what comes back to `setSourceThumbnail`. The handle is the effect's until the store takes it, so it is revoked instead if the source has left the library, the editor has unmounted, or a real load got there first. "Has unmounted" is a `mountedRef` scoped to the **component**, deliberately not a flag scoped to the effect run: a rebuild that lands writes the store, which hands the component a new `sourceVideos` array and re-runs the effect, so a per-run flag cleared by the previous run's cleanup told every read still parked that the editor had gone — each freed the handle it had just minted, the re-run skipped those ids as already read, and exactly one tile per burst was repaired (review round 1, which is why undo across a project load — the ticket's own headline case, restoring every source at once — has two tests of its own). The ref is set `true` on the way in as well as `false` on cleanup, because StrictMode's cleanup-then-remount of the same instance keeps the ref, and a clear-only ref would have left every development build "unmounted" from its second mount onward
- `videoProcessor.ts`: Video metadata extraction and thumbnail generation using native `<video>` element and canvas.
  **Duration fallback**: a WebM with no Duration/Cues element — raw MediaRecorder output, or an
  ESCAPECRAFT take whose `fixWebMMetadata` failed — reports `Infinity` (or `0`) on
  `loadedmetadata`. That used to **hang the import outright**, not merely mis-length it:
  `processVideoFile` asked `generateThumbnail` for a frame at `duration * 0.1`, a browser throws a
  `TypeError` on a non-finite `currentTime` (WebIDL `double`), the throw happens inside the
  element's own event handler where no `try/catch` up the stack can see it, and the thumbnail
  promise never settles — so the media row sat on "Processing…" for ever.
  `loadMediaDuration` now seeks to `Number.MAX_SAFE_INTEGER` (browsers clamp to the end;
  Chromium scans the container to find it), listens for both `durationchange` and `seeked`, and
  takes the first usable — finite, positive, and **not the seek target itself**, which an
  un-clamped browser would report straight back — value of the element's `duration`, else of its
  `currentTime` (the position the seek clamped to, which is all some browsers reveal). A
  usable duration on `loadedmetadata` resolves immediately with no seek; nothing usable within 5 s
  rejects with `Could not determine the duration of <name>`, which `VideoUploader` shows verbatim
  in the file's upload row. One `release()` is the single settle path, so the probe is torn down
  exactly once, and the object URL is revoked **exactly once** whichever way the promise settles —
  by `loadMediaDuration`'s own `finally`, or, for `extractVideoMetadata`, which still needs the
  element's source to measure the frame rate, by its `finally` after that — pinned by
  `toHaveBeenCalledTimes(1)` on the success, timeout and error paths. `processVideoFile` passes the
  thumbnail time explicitly as `metadata.duration * 0.1`, because `generateThumbnail` loads its own
  element and would read the same `Infinity`.
  **Thumbnail deadline (ESCSUITE-305)**: `generateThumbnail` gives its element
  `THUMBNAIL_SEEK_TIMEOUT_MS` (5 s, the shape and the figure of ESCAPECRAFT's ESCSUITE-180
  `THUMBNAIL_TIMEOUT_MS`) from the moment it is created to load and land its seek, and rejects
  by name on expiry — `Could not capture a thumbnail of "<name>" — the browser did not finish
  seeking within 5 s`. Firefox never completes a seek into a WebM with no Cues index whose
  target needs a Cluster that does not start with a key frame (see "Seek index repair at
  import"), and with no deadline the import of such a take sat on "Processing…" for ever.
  One `release()` — clear the deadline, detach the three handlers, unload the element
  (`removeAttribute('src')`, `load()`: a wedged element left holding its source counts toward
  the four after which Firefox stops loading new `<video>`s), revoke the object URL — runs
  once on every settle; a seek that lands clears the deadline and detaches `onerror` first, so
  the frame it draws is the only thing left that can settle the promise. A thumbnail was
  already cosmetic: `finishVideoFile` catches a rejection, warns `Failed to generate
  thumbnail:` and stores the video with none (the media library's placeholder tile), so the
  hang was the only way a thumbnail could cost an import — pinned by the wedged-thumbnail case
  in `videoProcessor.test.ts`.
  **`extractAudioMetadata` shares the probe**: `loadMediaDuration(element, objectUrl, name, kind)`
  is the one implementation both importers call — an ESCAPECRAFT take recorded with no camera is
  the same headerless WebM, just Opus-only, and used to build an infinitely long *audio* clip
  (no hang, since the audio path never seeks, but the same wrong length). Only the word in the
  failure message differs: `Failed to load audio: <name>` against the video path's
  `Failed to load video: <name>`, with `Could not determine the duration of <name>` shared.
  **The stored path needs the same guard**: the `?loadVideo=` handoff from ESCAPECRAFT
  (`app/useHostIntegration.ts`) adds a recording from its stored metadata and never calls
  `extractVideoMetadata`, and CRAFT stores `Infinity` in preference to its own wall clock (its
  guard is `duration > 0`, which `Infinity` passes). `resolveStoredDuration(blob, metadata)`
  returns the stored duration when it is usable and otherwise recovers it from the blob, so the
  handoff cannot build an infinite clip either. It recovers the length alone, through
  `loadMediaDuration` — not through `extractVideoMetadata`, which would also measure a frame rate
  its two callers (the handoff and the `.veditor` load) already carry. The `<video>` double
  (`src/test/doubles/media.ts`) models the discovery with `durationAfterSeek` /
  `durationStaysUnknown`, and throws on a non-finite `currentTime` the way a browser does, so this
  class of hang is caught by the unit suite rather than only in a browser. The `<audio>` double
  shares that one `currentTime` setter (`SeekScript`, which both `VideoScript` and `AudioScript`
  extend), so the two importers cannot drift apart in the tests either.
  **Frame rate** (ESCSUITE-276): `SourceVideo.frameRate` used to be written as a constant 30 on
  every import ("will be updated if we can detect it" — it never was), so nothing that read it —
  the in-page decoder's seek window first — was reading the file. `extractVideoMetadata` now
  measures it with `core/frameRateProbe.ts`'s `measureFrameRate(video, FRAME_RATE_PROBE)`, on the
  same `<video>` it already loaded for the duration and dimensions: it seeks the element to 0
  (the duration probe leaves a headerless WebM at its end, where playing presents nothing), plays
  it muted **at half speed** (`playbackRate = 0.5`), collects `requestVideoFrameCallback`'s
  `mediaTime` and `presentedFrames` for up to **8 presented frames or 500 ms**, whichever comes first, then pauses it,
  puts its own `playbackRate` back and seeks it back to 0; the deadline is cleared whichever way it
  finishes. **Why half speed** (review round 2): `requestVideoFrameCallback` fires at most once per
  *rendered* frame, so at 1x on a 60 Hz display (most external monitors, and headless Chromium) a
  120 fps file shows every other frame and its callbacks describe a 60 fps file — 100 read 50, 90
  read 49.18, all stored as `'measured'`, and ESCSUITE-263's seek window would have been a whole
  frame for exactly the 120 fps source this ticket was opened for. `mediaTime` is media time, so
  half speed changes nothing in the arithmetic, and it lets a source up to **twice the display's
  refresh rate** be *sampled*. It does not guarantee the page a callback for every frame: at
  exactly twice the refresh rate (120 fps on 60 Hz) half speed presents at the refresh rate with no
  headroom, and a busy main thread — the import's own thumbnail and waveform work, a loaded
  machine — delays callbacks at any rate, so the page can miss frames the compositor presented. A
  contended real Chromium run read a 60 fps WebM as **20** and **16**, `'measured'`, because every
  spacing it saw was three or four source frames wide (review round 3, G1). That is why the count
  below comes from the compositor's own counter, which a missed callback does not move. The honest
  limit that remains: a source faster than twice the refresh rate (240 fps on 60 Hz) has frames the
  compositor itself never presents, which neither count sees, and it still under-reads, as the
  source at its own speed would. One more, **observed and refused** (ESCSUITE-278): a frame the
  browser decodes too late is discarded unpresented — no callback, no counter step, and the next
  presented frame's `mediaTime` jumps over it — so the counter under-reads. 70 earlier runs never
  showed it; starving the decoder on purpose did. Real Chromium, a bare `<video>` at 0.5x, ten runs
  per condition, quiet, under CDP CPU throttling at 4x and 8x and with a 30 ms busy loop every
  34 ms on top: a 4K 60 fps H.264 MP4 never under-counted (50 runs), but high-bitrate 1080p VP9
  WebMs did in their first ~370 ms — 9 of 50 runs at 120 fps and 8 of 20 at 60 fps, at every
  throttle rate including none, `droppedVideoFrames` rising with each discard — and the counter read
  120 fps as **83.33, 82.57, 76.92, 76.09 or 111.11** and 60 fps as **52.63, 53.33, 48 or 41.92**,
  all `'measured'`, while the per-spacing count over the same media times read the true rate every
  time. Firefox (VP9 120 fps, quiet and busy, 20 runs) never under-counted. `rateFromMediaTimes`
  therefore refuses a counter run on either of two signs, answering `undefined` so the import
  stores 30 `'assumed'` — never the larger of the two counts: **the per-spacing count exceeding the
  counter** (every one of the 17 starved Chromium runs in the probe's own eight-frame window, none
  of the 103 healthy ones), and **`totalVideoFrames − presentedFrames` rising by more than 2**
  between the first and last callback, `measureFrameRate` reading `getVideoPlaybackQuality()` at
  each callback where the element has it — the case where every spacing is a multiple of the true
  interval and the media times hide the discards too. The 2 is the decoder's look-ahead: that
  difference sits two to four frames deep and moved −1 to +2 across every healthy Chromium run
  (Firefox's healthy runs moved −2 to 0), so a strict "grew at all" would have refused 49 of the
  103 — a threshold calibrated on one machine, headless, with software decoding; the discards
  themselves moved it 0 to 4, which is
  why the spacing check, not this one, is the sign every starved run showed. The spacing check also
  refuses, on the safe side, a healthy 120 fps run whose page missed callbacks for 11 or more frames
  in a row (about 183 ms at half speed), which millisecond stamps can round to one interval more
  than the counter. Replayed through the
  fixed estimator, all 140 logged runs either read their true rate or are refused. The budget is
  500 ms rather than the brief's 400 because half speed halves the media it covers — ratified by
  the coordinator in review round 3: 500 ms of wall time is 250 ms of media, which at 24 fps is six
  intervals and seven frames — the eight-frame cap (333 ms of media, 667 ms of wall time) is not
  reached there, the three-frame floor is cleared with room — while 60 fps and above end on the
  cap first. The unit double for this, `displayCappedVideo` in `frameRateProbe.test.ts`, answers at
  most once per 1/60 s of wall time while media time advances at `playbackRate` times wall time,
  and can be told to miss refreshes and to stamp `mediaTime` in whole milliseconds; the other
  doubles answer every frame asked for, which no browser does. The rate is **not** one over a
  spacing: a WebM stamps frames in whole milliseconds, so a 30 fps file's spacings are 33, 34,
  33… ms and any one of them reads 30.30 or 29.41 (60 read 58.82, 24 read 23.81, 120 read 125 —
  review round 1). The rate is `intervals / span` with `span` the last `mediaTime` minus the first —
  the millisecond of rounding spread over the whole span — and the question is only how
  `intervals`, the source intervals the run covers, is counted. **From the compositor** (review
  round 3, G1): `presentedFrames`, which Chromium reports with each frame callback, is the
  compositor's count of the frames it has presented, so the last callback's minus the first's is the
  interval count, whatever the page missed. An instrumented run (Chromium 154, 0.5x, 8 frames /
  500 ms, quiet, under a concurrent vitest coverage run, and with a 30 ms busy loop every 34 ms on
  the page's own main thread) matched every media-time jump to the counter's gap one for one — a
  busy 60 fps MP4 reported spacings 16, 34, 33, 33, 34, 33, 33 ms against gaps 1, 2, 2, 2, 2, 2, 2,
  which from the times alone would read 30 had its first spacing also been doubled — so a busy main
  thread changes how many callbacks the probe sees but not the rate it reads. A counter that
  advanced fewer times than there were callbacks after the first describes no run of presented
  frames, and the run answers `undefined`. `getVideoPlaybackQuality().droppedVideoFrames` is **not**
  read: it is no per-frame signal across sessions — ESCSUITE-276's runs saw Chromium advance it
  about once per callback while every presented frame was consecutive, and ESCSUITE-278's saw it
  stay at 0 on quiet H.264 and rise only with the discarded frames on starved VP9. **From the media
  times** — the fallback, for an engine whose callbacks carry no `presentedFrames` — each spacing is
  counted **on its own**, as `round(spacing / smallest)` intervals against the smallest positive spacing in the run, so a dropped frame adds
  one interval wherever it falls and each spacing's rounding error (about 4 % of an interval at
  120 fps with millisecond stamps) stays inside that spacing; a gap of up to about ten frames still
  counts exactly. Review round 2 (F1) replaced `round(span / median)`, which miscounted once frames
  drop: two error sources at 120 fps, not one — millisecond rounding **and** dropped frames. The
  real 120 fps WebM run that read 126.87 presented frames 1, 5, 6, 7, 11, 12, 13 and 17, whose
  rounded median of 8 ms against a true 8.33 made 134 / 8 round to 17 intervals where there were
  16; and once half the spacings are doubled the median is itself a doubled one, so 120 read 60 or
  65.45 and 60 read 30 — all stored as `'measured'`. On drop-free runs the two counts agree
  everywhere (a seeded sample in the test pins it). The smallest spacing is the true interval
  unless every presented frame dropped one or more frames before it — above twice the refresh rate,
  **or under load** — and then the fallback under-reads with nothing in the media times to show it;
  the counter is what catches that, where the engine reports one. On a variable-rate source (a
  screen capture, a MediaRecorder take) the fallback follows the closest pair of frames presented,
  so it errs high, never low — the safe direction for ESCSUITE-263's seek window. Where the engine
  reports the counter, the same irregular spacings count more intervals than the counter, so the
  run is **refused** by the ESCSUITE-278 spacing check and stored as 30 `'assumed'` (times
  `[0, .033, .083, .116, .2]` with the counter one per callback used to store 20 `'measured'`).
  That is the safe side too: the counter's average over irregular frames is no frame interval, and
  the seek window floors at 30 fps, so an assumed 30 seeks exactly as a measured 20 would have. A repeated
  presentation time counts nothing; one that goes **backwards** makes the run answer `undefined`
  on either path. That is snapped to the **nearest** of the standard rates
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88 and 120 when within **1.5 %** of
  it, else rounded to two decimals. "Nearest" is what keeps an exact 24 or 30 fps MP4 from being
  stored as 23.976 or 29.97; from millisecond timestamps over eight frames a whole rate and its
  NTSC neighbour, 0.1 % apart, cannot be told apart at all, so a 30 fps WebM is stored as 30 or
  29.97 depending on where its frames fall — which no reader cares about. Fewer than three frames,
  a run that ends no later than it starts or whose times go backwards, a presented-frame counter
  that advanced fewer times than there were callbacks after the first, no
  `requestVideoFrameCallback`, a refused `play()`, or a counter run showing a discarded frame (above)
  answer `undefined`, and the import stores `frameRate: 30` with
  `frameRateSource: 'assumed'`; a measured rate is stored with `'measured'`. **This adds up to
  500 ms to a video import** — it runs once, at import, and only for a file that decoded a picture
  (`videoWidth > 0 && videoHeight > 0`; the mic-only `.webm` that `processMediaFile` probes in a
  `<video>` would present no frames and only spend the 500 ms). It is kept off every path that
  already has a rate: the `.veditor` load (the file carries `frameRate` and `frameRateSource` in
  its `meta`; an old file without `meta` falls back to 30 `'assumed'` without playing the blob)
  and the `?loadVideo=` handoff (ESCAPECRAFT writes its recorder's configured rate,
  `'configured'`). The media library imports files one after another, so dropping N videos at once
  can add up to N × 500 ms. Images keep 1 and audio 0, both `'assumed'`. `frameRateSource` is an optional
  field on the shared `SourceVideo` (`packages/shared`); a record with none — everything written
  before this ticket — reads as `'assumed'`, and `DB_VERSION` did not change. The `<video>`
  double grows an optional `frameTimes` script that gives the element `requestVideoFrameCallback`;
  left unset, as in every older test, the element has none, as jsdom's does not, and the probe
  answers at once without playing. Beside it, an optional `presentedFrames` script is the counter
  each callback reports; left unset the metadata carries none and the probe takes the fallback.
  `displayCappedVideo` reports no counter either, so its cases pin the fallback.
  The real-browser pin is `apps/e2e/tests/escapeartist/frame-rate-probe.spec.ts` (ESCSUITE-277): nine committed
  2 s `testsrc` fixtures in `apps/e2e/fixtures/frame-rate/` (H.264 at 24, 30, 60, 120 and 29.97 fps; VP9 WebM at
  24, 30, 60 and 120) imported through the uploader on Chromium, each required to be stored `'measured'` at its own
  rate (exact for the MP4s, the NTSC neighbour also accepted for a WebM). Run 5 times each in one sitting, 45 of 45 passed.
  Either 120 fps file may instead come back refused as 30 `'assumed'` and the pin accepts that, never another rate: on a
  busy runner the page drops a frame decoded but unpresented, the media times step over it while the counter does not,
  and the spacing check refuses on purpose (ESCSUITE-333 for the WebM, seen in CI on 2026-10-18; ESCSUITE-336 for the
  MP4, seen on 2026-10-20; 2 of 10 WebM runs under 4x CPU throttling). A refusal logs its reason
  (`[frame-rate probe] refused: <reason> …` via `console.info`, reasons from `frameRateRefusal`), and the spec copies it
  into a `frame-rate refusal` annotation; `FRAME_RATE_CPU_THROTTLE=4` runs the spec under CDP CPU throttling.
  **The probe runs only on an engine it was measured on — Chromium (ESCSUITE-327).** The same nine
  fixtures on Playwright's Firefox 157 (ESCSUITE-316 U-3, 2026-10-17, the Chromium-only skip lifted) stored
  five as 30 `'assumed'` (the safe side: 24 / 30 / 60 / 29.97 MP4 and 24 WebM), two right (60 and 120
  WebM) and two **wrong `'measured'` claims** — the 120 fps MP4 as **124.62** (outside the 1.5 % snap) and
  the 30 fps WebM as **34.33** (14 % over). Firefox's rVFC metadata — its `presentedFrames` counter and
  `mediaTime` stamps per rate and container — was never characterised the way ESCSUITE-276 / 278
  characterised Chromium's (140 instrumented runs; Firefox was measured for VP9 120 fps alone), so
  `measureFrameRate` takes `engineMeasured` on its options, defaulting to
  `isMeasuredFrameRateEngine(navigator)` in `core/workerDecodeEngine.ts` — **Chromium only**, by the same
  `userAgentData.brands` test the decode worker's allow-list reads — and answers `undefined` at once when it
  is false, before any play, seek or rVFC request, so the import stores 30 `'assumed'`. The probe's
  allow-list is deliberately narrower than the worker's, which admits Firefox: the worker's Firefox parity
  was measured against its own `<video>` (ESCSUITE-262), the probe's was not. An over-read only narrows
  ESCSUITE-263's seek window (more seeks, never a skipped frame), so the picture was never wrong — the
  stored `frameRate` and `frameRateSource: 'measured'` were. Admitting Firefox is a measurement task, not a
  code change: instrument its rVFC per rate and container as 276 / 278 did, re-derive the refusal arms, and
  widen the predicate. The committed spec keeps its Chromium-only skip and gains one Firefox-only case —
  the 120 fps MP4 stored as 30 `'assumed'` — which is the gate's own pin. WebKit (Safari) has `requestVideoFrameCallback` too, so the probe used to run there and could store
  `'measured'`; it now stores 30 `'assumed'` as well (the Playwright pin skips it only because its WebKit
  cannot import media, ESCSUITE-258). jsdom stays an engine nobody measured, so the default is the
  production one: the suites that expect the probe to run (`frameRateProbe.test.ts` file-wide, the
  `frame rate (ESCSUITE-276)` describe in `videoProcessor.test.ts`) call `setEngine('chromium')` from
  `src/test/engine.ts` and `restoreEngine()` after, which puts back only `navigator.userAgentData` and the
  `userAgent` spy, never `vi.unstubAllGlobals()` (ESCSUITE-119); `videoProcessor.frameRateGate.test.ts` pins
  both sides through `extractVideoMetadata`.
- `exporter.ts`: the barrel over **three** export paths — two through WebCodecs +
  `mediabunny` for muxing, and one through neither:
  - **WebM** (`exportWebM.ts`): VP9 video + Opus audio, frame-by-frame encoding with audio mixing
  - **MP4** (`exportMP4.ts`): H.264 video + AAC audio, frame-by-frame encoding with WebCodecs decoding
  - **GIF** (`exportGIF.ts`): animated GIF, **no WebCodecs at all** (ESCSUITE-34) — see "GIF
    Export" below
- `exportGIF.ts`: GIF export. Shares `elementFrames.ts` with `exportWebM.ts` and swaps the
  encoder: per frame one `ctx.getImageData` over the whole output raster and one
  `writer.addFrame`. No audio mixing, no muxer, no encoder queue. Also exports
  `estimateGifBytes(width, height, frames)`, the up-front size heuristic the dialog shows
  before the first frame exists
- `gifEncoder.ts`: the one importer of `gifenc`. `createGifWriter()` returns
  `{ addFrame, bytesWritten, finish }`, where `addFrame` is `quantize` -> `applyPalette` ->
  `writeFrame` behind one method
- `elementFrames.ts`: the per-frame machinery an exporter that draws media **elements**
  (`<video>` / `<img>`) needs, lifted out of `exportWebM.ts` by ESCSUITE-34 so a second
  element-drawing pipeline reuses it rather than copying it. Four functions:
  `loadElementSources` (each unique source into an element, skipping audio-only sources,
  sources with no bytes and overlays), `rewindElementSources` (pause and seek every
  `<video>` to 0 once — the seeks `exportWebM.perf.test.ts` discounts as `initSeeks`),
  `createFrameComposer` (one frame: `openOutputFrame`, sync the live videos to their clip
  times, then the single track-ordered interleaved draw pass and the transition),
  `releaseElementSources` (pause everything and revoke the object URLs) and —
  ESCSUITE-159 — `createElementSourceRelease`, which wraps that last one in a
  run-at-most-once closure both exporters use.
  **One element per live clip of a source** (ESCSUITE-313): `loadElementSources` loads one
  `<video>` per source (`videoElements`, slot 0), and the composer gives the k-th clip of a
  source live in a frame — in `getClipsAtTime`'s track order, then a transition's incoming
  side — that source's k-th element (`core/elementSlots.ts`'s `assignElementSlots` /
  `videoForSlot`). Slot k > 0 lives in `extraVideoElements`, made the first time a frame needs
  it over the **same object URL** (one `createObjectURL` per source, N elements over it,
  revoked once at release) and kept for the rest of the export, so a crossfade does not make
  and drop one per frame; it arrives already paused at 0 and is not rewound, and one that will
  not load is warned about once and kept as `null`, its clip left out. `VideoPlaybackState`
  and the pause-the-rest bookkeeping are keyed by element. Before, a source had one element:
  a clip split and crossfaded into a later part of itself, or the same recording duplicated on
  a track above as a zoom or picture-in-picture, seeked it twice per frame and drew **both**
  clips from the second seek's moment (`[10, 10]` where `[0, 10]` was meant; a worker-vs-
  `<video>` parity MAD of 5.149 against 1.5). A source with one live clip still has exactly one
  element. **The slot arithmetic allocates nothing per frame**: `assignElementSlots(activeClips,
  transition, out)` clears and refills a map the caller owns (the composer and `exportMP4.ts`
  one per export, `drawFrame.ts` a module scratch) with a module scratch for its own counts, and
  the composer builds its lookups and its live-element set once at construction — pinned by
  `exportWebM.perf.test.ts` and `drawFrame.perf.test.ts` counting `new Map` / `new Set` per
  frame (one Map, `getClipsAtTime`'s, and no Set; the tree before the ticket built the same Map
  and one Set). Pinned otherwise by `elementSlots.test.ts`, `elementFrames.test.ts` (two and
  three clips of one source), `sameSourceClips.test.ts` (all three exporters) and the
  two-element case in `exportWebM.perf.test.ts` / `exportGIF.perf.test.ts`. **Every media clip
  of `test/fixtures/perfScene.ts` uses one source**, with V1 and V2 overlapping, so two elements
  are live from 1 s to 12 s of the benchmark scene (three inside the 5.5–6 s transition): the
  browser benchmarks' `preview-playback` and `export-webm` numbers move with this ticket — a
  second element decoding alongside the first, where before one element was sought back and forth
  a second every frame.
  **A source that cannot seek** (ESCSUITE-305): the composer keeps one count per **element** of
  consecutive wedged requests, under the rule in `core/seekWedge.ts`. When a request **starts**,
  an element no longer `seeking` resets it to 0 (`wedgeCountAtStart`): whatever seek was
  outstanding has landed, however late. When its waits are over — the 500 ms seek fallback if it
  seeked, and the 300 ms readiness wait if there is no frame — `countWedgedSeek` resets it for a
  seek that landed (`syncVideoToTime` resolves to whether `'seeked'` fired) or a frame to draw
  (`readyState >= 2`); adds one for an element still `seeking` with no frame — **whether or not
  this request issued a seek**, because an incoming transition clip is held at one time and seeks
  only on its first frame, so resetting on the frames that issued none let such a source finish
  black (review round 1); and leaves it for anything else (a fallback over an element no longer
  seeking but with no frame yet). A healthy seek that lands late — after the fallbacks, so its
  own request counts one — is cleared by the next request's start, so a slow machine whose seeks
  land between requests is never refused (re-review round 1); only an element that stays `seeking`
  across three requests is — a new seek aborts the one in flight, so seeks that each outlast the
  waits plus the gap to the next request are refused too, and those frames could not have been
  drawn either way.
  At `WEDGED_SEEK_FRAMES` (3) it throws `SourceNotSeekableError`, which both exporters' catch turns into an
  `ExportError` with `code: 'SOURCE_NOT_SEEKABLE'` (`exportErrorCodeOf`) and the sentence
  `This browser cannot read "<name>" frame by frame (its seeks never completed). Re-save the
  recording in ESCAPECRAFT, or export in Chrome or Edge.` The name is the `SourceVideo.name`,
  carried as `ElementSources.sourceNames` from `loadElementSources` (the id when the export
  was not handed the source's record). The count is per element, not per source, because an
  element has one playhead (ESCSUITE-313): a source drawn twice in one frame — a split clip's
  crossfade — seeks two elements, each counted on its own, and whichever wedges three times
  running fails the export by the source's name rather than leaving a black file.

  **Load deadline** (ESCSUITE-325): `loadVideoElement(blob, name)` waits for `loadeddata` under the same 15 s `waitForVideoLoad` deadline as the MP4 path. A silent source rejects with `MediaLoadTimeoutError`, which `loadElementSources` handles like any failed load — the existing `Failed to load video <id>` warning (the message names the `SourceVideo.name`, or the id when the map lacks it), then the image fallback, then skipped — so a WebM or GIF export completes without the clip instead of hanging. A further slot's element (ESCSUITE-313, `loadVideoElementFromUrl(url, name)`) goes through the same deadline without revoking the URL its source's first element still reads, and a silent one is treated as any further element that will not load: warned about once, kept as `null`, its clip left out. One timer per load, none per frame. The MP4/WebM split is deliberate and now covers both failure modes (ESCSUITE-328): on the MP4 path every `<video>` fallback rejection, an `error` event as much as the deadline, ends the export with one `ExportError` naming the source ("Could not read <name> — the browser did not report its metadata within 15 s" for the silence, "... the browser could not decode it" for the `error`), the worker released through the ESCSUITE-314 release, and a failed `<video>` is no longer retried as an image (a source that is not an image never decoded as one, and the retry is what hid the failure). The element exporters keep the oracle's warn-and-skip rule for both outcomes; what ESCSUITE-330 changed is a source with *no bytes* at all, which refuses by name in all three exporters with `code: 'SOURCE_MISSING'` — at the `getVideoBlob` in the MP4 load loop, the 314 release freeing the worker — because a load failure has bytes to try and a missing source has none. `loadImageElement(blob, name)` shares the wait with `<video>` (`waitForMediaLoad`, one `METADATA_LOAD_TIMEOUT_MS`): an image that never settles is torn down at 15 s, failing the MP4 export by name and skipped with a warning in WebM and GIF.

  **Who owns the elements** (ESCSUITE-156): `loadElementSources` owns every element it has
  created until it returns, and the caller owns them from then on — a caller only ever
  receives the map, so a rejection partway through the load would strand the elements before
  it with no handle left to free them by. Both media branches therefore degrade rather than
  reject: a video that will not load is retried as an image and then warned about
  (`Failed to load media <id>`), and an **image** that will not decode gets the same
  warn-and-skip rather than failing the whole export, which is what it used to do — one
  corrupt PNG in the library aborted the load and leaked every element ahead of it. An image
  load has the same 15 s deadline a `<video>` does (ESCSUITE-328): one that never settles is
  torn down and skipped like any other failed image. The two
  rejections still possible inside the loop release what it has loaded before rethrowing: a
  failed storage read, and — since ESCSUITE-330 — a source with **no bytes** in storage at all
  (the row gone, or holding no blob: another tab's Clear All or Remove deleted them). That one
  is not a load failure, where the bytes exist and the browser cannot read them; a byteless
  source has nothing to try, used to be skipped without a word, and left its clip
  drawn as nothing in an export that reported "Export complete!". It refuses by name with
  `sourceMissingError` (`exportTypes.ts`, `code: 'SOURCE_MISSING'`, the sentence on the export's
  own trail, which the loader is handed as its third argument), whatever the source's
  `mediaType`; a source no clip uses is never read. The loaders read every clip on the
  timeline — in or out of the exported range, hidden tracks included — so a byteless source
  used only by such a clip refuses the whole export, and so does an overlay clip carrying a
  stale `sourceVideoId` (the app writes `''`; only a hand-written kit job carries one). On the
  caller's side the ownership starts at the load, which is why **both exporters' `try` begins there and not at the frame loop**: `output.start()`,
  either `configure()`, the caller's own `onProgress`, the rewind and the GIF writer all sit
  between the two, and a throw from any of them used to escape past the only
  `releaseElementSources` on the error path — one `<video>`/`<img>` and its object URL per
  source, held for the life of the page. `exportWebM.ts` records each encoder in an
  `openEncoders` list as it is built and its catch closes whatever exists, so the cleanup
  does not have to name handles that may not be in scope yet — and, since ESCSUITE-159, the
  **muxer** beside it: an `Output` that is still mid-file holds its writer and its
  unfinalised target (the encoders are the exporter's own, and the same catch closes them;
  an `EncodedVideoPacketSource` owns none), so the catch `await`s Mediabunny's own
  `output.cancel()`. **Which** outputs get that call is answered by Mediabunny's own
  `state` rather than by a flag the exporter keeps: only `'started'` is mid-file —
  `'pending'` wrote nothing, `'finalized'` is a finished file whose target `finalize()`
  closed (asking anyway only logs "Output has already been finalized.", which the two
  reachable post-finalize paths — the abort check and the empty-buffer refusal — would
  otherwise print), and a `finalize()` that *rejected* leaves `'canceled'`, having already
  released what it had. That is exactly the state test ESCAPECRAFT's recorder `cleanup()`
  applies to its own outputs, and it cannot drift from the library the way a hand-kept
  handle can. **Order matters inside the catch**: the encoders are closed *first*, because
  `close()` abandons the packets an encoder had not delivered yet, and cancelling the output
  first would leave them to arrive at a packet source that refuses them (`Output has been
  canceled.`) from inside an `output:` callback nobody awaits — an unhandled rejection on
  top of the failure being reported, on the ordinary path of a user clicking Cancel
  mid-export. A `cancel()` that itself fails is warned about and goes no further, the way
  ESCAPECRAFT's `cancelOutput` reports one. The GIF pipeline has no muxer to cancel:
  `gifenc` writes into plain JS buffers.
  **Releasing exactly once** is the other half of the same ownership (ESCSUITE-159): the
  success path's release and the catch's are *not* exclusive, because the caller's own
  `onProgress({ phase: 'complete' })` callback — and, in `exportWebM.ts`, the "no data was
  written to buffer" refusal — sit after the first and reach the second, so one export used
  to revoke every object URL twice. Both exporters therefore hold a
  `createElementSourceRelease(sources)` closure and call *that* from both paths rather than
  `releaseElementSources` directly, which also keeps the success-path ordering (release,
  then the `complete` report) exactly as it was. **`exportMP4.ts` follows the same boundary**
  (ESCSUITE-315), though it holds no elements of its own beyond images: its ownership begins at
  `createFrameManager` — a decode worker that may hold up to 512 MB of samples — so its `try`
  begins there too, where it used to begin at the frame loop with the media load,
  `output.start()`, both `configure()` calls and the caller's `onProgress` above it, and a
  throw from any of them left the worker alive until the tab closed. Its catch calls the same
  kind of run-once `release` the success path does (the frame manager disposed, the worker
  terminated, the image URLs revoked — once) and closes whatever its own `openEncoders` list
  holds. The composer takes
  the output `frameRate` because the seek tolerance is a little under half a frame of it —
  the one value that had to become a parameter, 30 for WebM and 10/15/20 for GIF.
  `exportMP4.ts` is deliberately
  **not** a caller: it decodes through `videoDecodeManager.ts` / `frameSource.ts` and draws
  `VideoFrame`s, so it shares `canvasRenderer.ts` but not this. The extraction is a pure
  move — the same warning strings, the same 500 ms seek and 300 ms readiness fallbacks, the
  same `readyState >= 2` gate — and both of the existing export `*.perf.test.ts` ceiling
  files are byte-identical across it, which is what pins the call order. The third,
  `exportGIF.perf.test.ts`, is what proves the sharing is real rather than claimed: it measures
  **26** canvas calls per frame over the same scene where `exportWebM.perf.test.ts` measures 25,
  the one extra being the GIF pipeline's own `getImageData`
- `audioMixer.ts`: `extractAndMixAudio` is the export pipeline's one audio mixer — both
  `exportWebM.ts` and `exportMP4.ts` call it directly, on the main thread. `exportGIF.ts`
  does **not** call it at all, not even with the result discarded: a GIF has no audio track,
  and mixing the whole timeline to throw it away is the most expensive no-op in the pipeline
  (`exportGIF.test.ts` asserts the mixer is never called). It decodes each
  clip's source with `OfflineAudioContext`, applies `getAnimatedVolume` per sample (so a
  clip's volume keyframes always reach the export, the same as the preview), sums the result
  into one stereo interleaved timeline buffer and normalises the peak back under 1. A clip
  whose track has been deleted is **skipped**, the same as a muted track (ESCSUITE-99;
  previously it was mixed in at full volume), and the same as a **hidden** track (ESCSUITE-127:
  the preview was already silent for one — `store/clipQueries.ts`'s `getClipsAtTime` filters on
  `track.visible` before `usePreviewRenderLoop` builds its audio routing from that list — but the
  mixer built its own clip list and only checked `muted`, so an export used to carry a hidden
  track's audio that no one heard in the editor). There used to also be
  `extractAndMixAudioWithWorker`, a Web Worker fast path (`workers/exportWorker.ts`,
  `utils/workerSupport.ts`) with a main-thread fallback — deleted by ESCSUITE-99, because its
  own mixer multiplied by track volume alone (dropping volume keyframes) and its support probe
  tested for `OfflineAudioContext` *inside* the worker, which real Chromium never exposes to a
  `DedicatedWorker`, so `getWorkerSupport()` always resolved `false` and the worker path never
  ran in production. Every export already went through the main-thread mixer; deleting the dead
  path just stops paying for the Worker spin-up and probe on every export.
- `outputTransform.ts`: the one place project space is carried onto an output raster —
  `projectToOutputScale`, `setOutputTransform` and `openOutputFrame`, called by the preview and
  by both exporters. See "Export Resolution" below
- `projectManager.ts`: Project save/load to `.veditor` files.
  **Container (ESCSUITE-260)**: `saveProject` writes the v2 container defined in
  `projectFileFormat.ts`: 16 header bytes (`89 56 45 44 0D 0A 1A 0A`, then the container version 2
  and the index length N as little-endian u32s), N bytes of UTF-8 JSON index (`{ version: 2,
  project, editor?, videos: [{ id, name, mimeType, meta?, data: { offset, length }, thumbnail?: {
  offset, length, mimeType } }] }`, offsets counted from the payload's first byte), then every used
  source's and thumbnail's bytes back to back in index order. A stored thumbnail of zero bytes is
  left out, as v1's `''` was, so it never restores as an empty (broken) tile. The stored `Blob`s go into
  `new Blob([...], { type: 'application/octet-stream' })` **by reference**: no source byte is read
  on save, there is no `FileReader` and no base64, and the only bytes built in JS are the header and
  the index (whose bulk is waveform peaks). `loadProject` sniffs the first 16 bytes. A v2 header
  goes through `readProjectFileIndex`: a file that opens with the magic but is shorter than the
  16-byte header is refused ("the file ends before its header does"), as the headless kit refuses
  it, rather than sent down the v1 path to fail as JSON. A version above 2 is refused as "newer", and an N over
  `MAX_INDEX_BYTES` (64 MiB) or past the file's end is refused before the index is read. The index's
  shape and every offset and length (a non-negative safe integer) are validated, and a source id the
  index lists twice is refused. Then `assertRangesTile` requires the ranges to tile the payload
  exactly, in order, ending at the file's size: a gap, an overlap, a truncated download (named as
  "declares X of media and holds Y", the declared figure rounded up and the held one down so the two
  never read the same) and trailing bytes are each refused. Each part is then
  `file.slice`d straight into `storeVideo` / `storeThumbnail` and the metadata probes, so a source
  never enters the JS heap. Anything else (every file an older build wrote, and anything that is not
  a project) takes the v1 path: `file.text()`, `readJsonFile`, `base64ToBlob`. **A damaged v1 file
  is refused by name (ESCSUITE-298)** through the same `ProjectFileError` the v2 reader throws,
  where it used to throw whatever `JSON.parse` or a property read threw (a raw `SyntaxError` or
  `TypeError`, shown only as the bare "Failed to load project"). `readJsonFile` checks what the
  loader reads, before anything is written: text that is not JSON ("the file is not valid JSON",
  which also covers a binary file whose magic a corruption broke), a top level that is not an
  object ("the file is not a project file"), a `version` above 1 ("the file names format version 2,
  and a JSON project file is version 1"), `project` not an object, `videos` not a list, an entry
  that is not an object or whose `id`, `name`, `mimeType` or `data` is not a string, a `thumbnail`
  that is present and not a string, a `meta` that is present and not an object (`videos[<i>].data
  must be a string` and so on), and an id listed twice (`the file lists source "<id>" twice`, the
  v2 rule). A `null` thumbnail or meta still counts as absent, as it always did, and so does an
  empty-string thumbnail. A few hand-edited shapes that used to load are now refused: a `meta` that
  is not an object (a list, `false`, `0`, `""`), a thumbnail that is neither a string nor `null`, a
  non-string `id` or `name`, a missing `mimeType`, and a source id listed twice. No ESCAPEARTIST ever
  wrote any of them. `data` or a `thumbnail` that `atob` cannot decode is refused as
  `videos[<i>].data is not base64` (or `.thumbnail`) as that source is restored, inside the shared
  rollback, so a source stored before it is deleted again. `parseProject`'s own
  reasons pass through unchanged, as on v2. **Before any write**, both versions run `parseProject(project, editor)` (`assertProjectParses`) and throw
  `ProjectFileError(reason)` for a project it refuses, so a hand-edited file, or one from a newer
  editor, is refused by name with nothing stored and nothing to roll back (it used to be judged by
  the hook only after every new source had been stored). `loadProject` still hands the project back
  unmigrated, and `useProjectActions` migrates it through its own `parseProject` as before. Also
  before any write, the v2 path sums the data and thumbnail lengths of every entry whose id is not already
  stored (a present row writes nothing, ESCSUITE-151). It refuses, by name, a load that needs more
  than `getStorageEstimate()` says is free: "This project needs 1.5 GiB of storage and this browser
  has 1.0 GiB free." The needed figure rounds up and the free one down (`formatSize(bytes, { round:
  'down' })`), so a refusal never names the same figure twice: 100.5 MiB against 100.2 MiB reads
  "101 MiB" and "100 MiB". The check is skipped when `quota` is 0 (no estimate API, so nothing was
  measured) or the estimate rejects (one `console.warn`), a negative `available` counts as nothing
  free, and no margin is added because the sum is exact. The estimate is approximate, so **a load
  that throws after it started writing rolls back** what it wrote. Every id this call stored is
  deleted through `deleteVideo` (video and thumbnail rows), each in its own `try`/`catch` with one
  `console.warn` per failure, and the thumbnail URLs the load minted are revoked. An id that was
  present before the load is never touched, and the error is rethrown. The rollback lives
  in the loop both versions share (`restoreSources`), so it covers a v1 load too. **A failure after
  the file is read is refused by name too (ESCSUITE-302)**, each a `ProjectFileError` carrying the
  original error as `cause` (`ProjectFileError`'s optional second argument), where each used to reach
  the hook raw and show only the bare "Failed to load project": a metadata probe that rejects (a
  source the browser cannot decode, or ESCSUITE-249's 15 s metadata deadline) is `videos[<i>]
  ("<name>") could not be decoded`; a `storeVideo` or `storeThumbnail` that rejects with a quota
  error, read through `error.cause ?? error` (`isQuotaExceeded` in `core/storageErrors.ts`, the
  ESCSUITE-210 / 217 shape), is `videos[<i>] ("<name>") could not be stored: ` followed by the media
  library's own quota sentence (`STORAGE_QUOTA_MESSAGE`, the one constant the uploader and the
  session autosave also read), and any other write rejection `videos[<i>] ("<name>") could not be
  stored`. Both are raised inside `restoreSource`, so the rollback above still deletes what this load
  stored before the failure. A read of the file that rejects — the v1 `file.text()`, or the 16-byte
  header and the index every file is read through (`readOrRefuse` in `projectFileFormat.ts`) — is
  "the file is too large to read" for a `RangeError` (V8's string or ArrayBuffer ceiling) and "the
  file could not be read" otherwise; nothing has been written by then. A v1 source's base64 decode is
  not a read and keeps its own refusal (`videos[<i>].data is not base64`). A row it cannot
  delete is unreferenced and shows in ESCSUITE-268's "files from earlier sessions" list. Every
  refusal of either version (v1 since ESCSUITE-298), a project refusal, and the storage pre-check is
  a `ProjectFileError` whose message is shown:
  `useProjectActions` says "Failed to load project: \<reason\>" for one, and shows the writer's one
  refusal (an index past the cap, unreachable in practice) on its own. **The format sets no project
  size limit**: a `.veditor` is limited by the browser's download size and its storage quota, not by
  the format. Measured 2026-10-12 on macOS: a project of about 2 GiB (two synthetic H.264 MP4s,
  2,122,572,687 bytes together) saved and reopened in Chromium 153 and Firefox 155 with the heap
  flat — Chromium's `JSHeapUsedSize` after a forced GC moved 17.7 → 17.9 MB across the save and
  15.5 → 16.9 MB across the reopen; Firefox exposes no heap figure to automation, so its claim rests
  on the tab process's resident memory, 259.3 → 260.1 MB and 238.4 → 258.1 MB. The reopen was into a
  fresh profile with empty storage, so every source byte was really written (about 2.12 GB of
  storage used afterwards). WebKit carries the ESCSUITE-258 Blob-in-IndexedDB caveat.
  An older ESCAPEARTIST opening a v2 file fails at `JSON.parse` with its own "Failed to load
  project". The ESCSUITE-241 save budget, its refusal and its short-read check are gone with the
  string they guarded. The picker asks for `application/octet-stream` and filters by the `.veditor`
  extension; the fallback input's `accept` is `.veditor`.
  **Editor block (ESCSUITE-245)**: `ProjectFile` and the session snapshot (`SessionState`) both carry
  an optional `editor: { inPoint, outPoint, markers }` BESIDE `project` — the in/out points and the
  markers live in the store outside `Project` (the undoable document and the headless kit's input,
  which ignores the block), so before this ticket neither a save nor an autosave kept them.
  `saveProject(project, sourceVideos, onProgress?, editor?)` is handed the block as it is handed the
  sources (`useProjectActions` reads `currentEditorBlock()` from `app/editorBlock.ts` at save time);
  `loadProject` returns the file's block as found. **A file is untrusted**: `parseProject(project,
  editor?)` validates a present block by name (`validateEditorBlock`: each point `null` or a finite
  number >= 0, an inverted OR equal pair refused rather than swapped, markers with unique string
  ids, finite time >= 0, string label and colour; reason `editor.<field> ...`), sorts the markers by
  time and returns `{ ok: true, project, editor? }`; an absent block returns none and the caller keeps
  the defaults `resetProject` leaves (no range, no markers). **The autosave is the app's own state and
  is repaired, not refused** (the ESCSUITE-173 / 255 split): `repairEditorBlock` drops a snapshot
  block that fails the same checks to the defaults with one `console.warn`, and never blocks the
  restore. **In/out points past the timeline are clamped, not refused**, on both paths, to the loaded
  timeline's length (a range that collapses to nothing is dropped, and so is a lone point past the end — an in point at or past it, an out point past it); a marker refusal names the entry, `editor.markers[2].time ...`; a **marker past the end is kept**
  — markers are annotations, not playback bounds. `applyEditorBlock` (clear the points, set each
  non-null one, `setMarkers`) is a restore, not an edit: it pushes no undo entry, and it runs after
  the project lands and before `clearHistory()` in both `loadProjectFile` and `handleRestoreSession`.
  **Both paths clamp against the migrated clips, not the saved ones** (ESCSUITE-329): `parseProject`
  already clamped a file's block against `ensureTimelineHasTracks`'s output, but the restore handed
  `repairEditorBlock` the raw session clips — the same project `setProject` had just migrated — so a
  text overlay the ESCSUITE-304 repair lengthens from a saved `4 / 2 / -2` to `0 / 2 / 2` left the block
  clamped against a timeline of negative length and a range inside the restored one dropped. The restore
  now calls `repairEditorBlockForProject(raw, project)` (`store/projectMigration.ts`), which runs the same
  `ensureTimelineHasTracks` pass over the same (ESCSUITE-307-filtered) project and clamps against its
  clips — identical to reading the store after `setProject`, without needing the store (`useSessionRestore.test.ts` mocks `setProject`; the new
  file restores through the real one); the one cost is that the 304 repair's `console.warn` can print twice on
  such a restore. Markers are never clamped, so only the points carry the pin
  (`useSessionRestore.repairedClamp.test.ts`).
  The host's `LOAD_PROJECT` passes no block and the kit ignores it. `ExportDialog` still derives its
  `timeRange` from the store's points, so a restored range is honoured by the next export. The
  autosave's store subscription re-arms on a point or marker change as it does on the playhead.
  **File format**: in a v1 file, each entry in `ProjectFile.videos` carries the video's base64 bytes
  and, since ESCSUITE-97, a `meta?: SourceVideoMeta` beside them — the live `SourceVideo`'s own
  `duration`/`width`/`height`/`frameRate` plus whatever of `frameRateSource` (ESCSUITE-276),
  `mediaType`, `source`, `recordedAt`,
  `waveformData`, `hasAudio`, `takeId`, `role`, `startOffset`, `overlayPlacement` and
  `hasWebcam` it had (`id`/`name`/`mimeType` are already the entry's own top-level fields, and
  `size` is always the restored blob's). `saveProject` writes it from the `SourceVideo` it was
  given, **omitting** a `duration` that is not a finite number above 0 and a `width` or `height`
  that is not a finite number >= 0 (a legitimate 0x0 audio source keeps its zeros) — JSON would
  write `Infinity`/`NaN` as `null`, which the headless kit refuses, and absent already means
  "probe it" to `loadProject` (it recovers the length from the blob) and to the kit (ESCSUITE-326); `loadProject` takes every field from it and never touches the blob when it is present.
  `meta` is optional and the file's `version` stays 1 — purely additive, so a project saved
  before this ticket, or by an older build, has no `meta` and `loadProject` falls back to
  `extractMetadataFromBlob` exactly as it always did. That fallback used to read a video or
  audio element's raw `duration` with no guard, so a saved ESCAPECRAFT take whose WebM has no
  Duration element came back `Infinity` seconds long on every reopen — the same headerless-WebM
  problem `loadMediaDuration` (`videoProcessor.ts`) already solved for import and for the
  CRAFT handoff, just re-introduced by this third hand-rolled probe. `extractMetadataFromBlob`'s
  video and audio branches now call that same exported `loadMediaDuration`, so an old file's
  duration is recovered the same way an import's is, and cannot come back infinite.
  `headless/seedSources.ts` shares that same fallback for a source it wasn't handed full
  metadata for, so a headless render of a headerless source that used to complete instantly
  with a silently wrong `Infinity` duration can now take up to the probe's 5s timeout and reject
  instead — the correct outcome, but a latency and failure-mode change for that one caller.
  Since ESCSUITE-260 the same `meta` rides in each v2 index entry, and both versions hand each source
  to one helper, `restoreSource(entry, blob, thumbnail, existing, written)`. The duration and
  dimension recovery above and the ESCSUITE-151 identity rules therefore cannot drift between v1 and
  v2. A v2 thumbnail keeps its own `mimeType`; a v1 one is still read as `image/jpeg`.
  A file with `meta` skips the blob probe for whichever of `duration`/`width`/`height` it holds
  a usable number for — waveform peaks and take identity are trusted from what was actually
  recorded or computed, not guessed at from the bytes — but `meta` came out of `JSON.parse`, not
  the type checker, so `loadProject` still recovers any of those three from the blob if a
  hand-edited file's value is not a real, non-negative finite number (review round 1); a
  `thumbnailUrl` inside `meta` is never trusted either way; the only source of one is
  `resolveThumbnailUrl` over what is actually stored, exactly as ESCSUITE-96 already required.
  `source`/`takeId`/`role`/`startOffset`/`overlayPlacement` — CRAFT's take identity, not
  ARTIST's — are the one part of a restored source's metadata `loadProject` never takes from
  `meta`: a source already in the shared DB (a take ESCAPECRAFT still owns, or one an earlier
  import/load already restored) keeps those five fields exactly as stored, while everything
  else about it (duration, dimensions, waveform data, …) is still rebuilt from the file being
  reopened, the same as for any other source; a source the id names nothing for has them
  cleared outright rather than copied from `meta`. Copying them from the file onto a copy the
  DB doesn't already hold used to put a take the user had deleted in CRAFT straight back into
  CRAFT's own library — CRAFT reads
  `getAllVideoMetadata().filter(v => v.source === 'recording')` (root CLAUDE.md, "Data Flow"),
  with no notion of "this one came from a project file" to exclude it — and trusting the file's
  identity fields even for a source already present would let a stale saved snapshot overwrite
  what CRAFT (or a later edit) has since written (ESCSUITE-151). Either way `storeVideo`/
  `storeThumbnail` only run for a source not already in the DB; a present source's
  `thumbnailUrl` is still refreshed from what is actually stored (ESCSUITE-96).
- `videoDecodeManager.ts`: Main thread API for WebCodecs video decoding via Web Worker
- `frameSource.ts`: Abstraction layer for frame sources (WebCodecs or HTMLVideoElement fallback)
- `clipCrop.ts`: a media clip's **crop** (ESCSUITE-6) — four insets, as fractions of the source frame. `croppedSourceRect(w, h, crop?)` is the region to draw and is read by both media draws in `canvasRenderer.ts` **and** by `components/Preview/previewGeometry.ts`, so the picture and the chrome round it can never disagree; it floors the region at one source pixel, because `drawImage` throws `IndexSizeError` on a zero-width source rect and a throw inside a preview frame kills the whole frame. `isValidCrop(value)` is the shape check `parseProject` runs — four finite insets >= 0 leaving something on each axis — and takes no dimensions, because a project is validated before its media is re-linked. `normaliseCrop(crop, w, h)` is what the inspector stores: clamped to 0-90% per edge, `undefined` for an all-zero crop, and a refusal (`{ ok: false }`, write nothing) for anything that would leave less than a source pixel. `cropForAspect(w, h, aspect, crop?)` is the aspect presets, computed against the region the clip **already** shows rather than the whole frame, so presets compose and Reset is the thing that starts over. `cropUpdateFor(crop, source)` (ESCSUITE-157) is the one decision both crop surfaces make about what to write — `null` for "write nothing", `{ crop: undefined }` for "no crop at all", or `{ crop }` — lifted out of `useClipEditorActions`' `handleCropChange`, so the inspector's sliders and the on-canvas handles (`components/Preview/CropHandles.tsx`) cannot disagree about what the store may hold. It is half of each surface's write: since ESCSUITE-171 both then hand its answer to `cropDrag.ts`'s `cropWriteFor`, which decides where the picture sits. Static: `crop` is not an `AnimatableProperty` and never passes through `getAnimatedValues`
- `cropDrag.ts`: the crop **gesture's** arithmetic (ESCSUITE-157), kept out of `clipCrop.ts` because that module is read by the renderer on every media clip of every frame and none of this is. Eight handles (`CROP_HANDLES`/`CROP_HANDLE_LABELS`, compass points, reading order); `sourceDelta` un-rotates and un-scales a canvas displacement into source pixels, dividing by a scale floored at `MIN_SCALE` (ESCSUITE-173) rather than the UI's own 0.1 — `updateClipTransform` applies no floor at all, so a `.veditor`, a host `LOAD_PROJECT` payload or a headless job spec carrying `scaleX: 0` would otherwise divide by it; `parseProject` now also refuses such a transform outright (see `projectMigration.ts`, below), and this floor is this function's own backstop regardless; `cropForHandleMove(start, handle, delta, source, keepAspect?)` turns that into the next crop, always rebased from the crop the gesture **started** with (never the previous move's output — the ESCSUITE-110 trim-compounding trap in a different gesture) and clamped on the inset that moved, so the edge a handle does not own never drifts. Under `keepAspect` (Shift), `withAspect` additionally caps the region so no derived inset exceeds `MAX_CROP_INSET`: `normaliseCrop`'s own per-edge clamp would otherwise land the independent and dependent insets at different distances from the limit and break the ratio Shift is holding (NIT 8) — a plain `w` drag past 90% has no ratio to break, so its own over-limit inset is correctly left to that same per-edge clamp. The cap widens the region to the largest of what the pointer asked for and what each limited edge allows, so the handle SLIDES TO `MAX_CROP_INSET` and holds there — the same way an unlocked handle already stops at its own single-edge limit — rather than breaking the lock (ruling 2026-10-02, ESCSUITE-173; superseded a same-day interim ruling that refused the move outright and briefly made this function return `undefined`). `cropRegionAspect` reads the kept region's own ratio for Shift-lock. `cropCentreFor` is the compensating-centre arithmetic a crop write needs — cropping shrinks the picture about the clip's centre (ESCSUITE-6), so a crop written alone moves both edges of an axis and a dragged handle visibly lags — and `cropCompensatesCentre(animation)` is the one place that decides whether a write may apply it: false for a clip keyframed on `x`/`y`/`scaleX`/`scaleY` (a static centre would fight the keyframes and lose at playback), true for rotation/opacity/blur keyframes or none at all (operator ruling, 2026-10-02). `cropWriteFor` is the one function that builds the whole `Partial<Clip>` **every** crop write hands `updateClip` — `{ crop, transform }` or `{ crop }` — so there is exactly one history push and one locked-track check per write, and (since ESCSUITE-171) exactly one rule about where a crop leaves the picture, shared by the eight handles and by the inspector's sliders, presets and Reset. `CROP_NUDGE` (`{ fine: 1, coarse: 10 }` source pixels) is the arrow key's step and Shift's — the nudge hands its delta to `cropForHandleMove` directly in source pixels and in the clip's own LOCAL (unrotated) frame, unlike a drag's pointer displacement, which `sourceDelta` un-rotates first; each handle owns fixed insets in that frame, so on an unrotated clip a nudge moves the way the arrow points, and on a rotated one the arrow follows the clip's own axes rather than the screen's (ESCSUITE-173 correction: the design spec and this file both used to claim the former unconditionally). `cropsEqual` is why a nudge that cannot move (an arrow key already at the frame's edge, or one the handle owns no inset on) costs no undo entry, and `cropAnnouncement` is the live-region text, in source pixels rather than the inspector's percentages because a one-pixel nudge of a wide source would round to "0%". Pure throughout — no clip, no store, no canvas, no pointer event — consumed by `components/Preview/useCropHandleGesture.ts`, the hook that drives the eight on-canvas handles (`CropHandles.tsx`), both by mouse drag and by the keyboard
