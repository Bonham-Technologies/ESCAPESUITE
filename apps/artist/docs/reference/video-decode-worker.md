<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Video Decode Worker (`src/workers/decodeWorker.ts`)
Web Worker for WebCodecs-based video decoding, enabling full-speed exports in background tabs.
`decodeWorker.ts` is only the message-protocol glue (and the one file excluded from coverage — it
runs only inside a worker); the decisions live in modules vitest runs directly.

**Which engines use it at all — an allow-list (`core/workerDecodeEngine.ts`, ESCSUITE-254).** The
`<video>` path is the oracle (it is what every MP4 export used before the worker decoded anything),
so the worker is admitted only in an engine whose worker output was measured against that engine's
own `<video>`; everything else — including the next engine nobody has measured — keeps the
`<video>` path by default. The decision is made on the main thread by `FrameSourceFactory`
(constructor option `measuredEngine`, defaulting to the predicate), before the worker is started or
any source is read into memory; a refused engine's MP4 export says "Decoding in the page; keep this
tab in the foreground" once, as it does when the worker cannot start. Admitting another engine is
a separate decision per engine (ESCSUITE-262 measured WebKit; ESCSUITE-285 ruled it out — see its
row). Measured
(Playwright 1.63's browsers, parity spec and a direct decode-beside-`<video>` probe):

| Engine | Detected by | Measured against its own `<video>` | Admitted |
|---|---|---|---|
| Chromium 153 | `navigator.userAgentData.brands` contains `"Chromium"` (secure contexts, `file://` included — the headless kit and standalone build) | export MAD 0.000/255 over every frame the parity spec compares (frames 0/25/41/last of seven sources, plus the segment starts 8/16 untagged and 17/25 trimmed) since ESCSUITE-265 — the two exports are pixel-identical once both decoders show the same frames; 0.000–0.486 before it, when one in three of the `<video>` export's frames was the previous one; probe decode 0.00; all four display rotations match | yes |
| Firefox 155 | `Gecko/` and `Firefox/` in the user agent | export MAD 0.000 over every compared frame of the untagged, BT.709-tagged, matrix-only, two `colr`-only and trimmed sources, and 0.000 / 0.314–0.337 / 0.353–0.379 / 0.207–0.211 at the full-range source's frames 0/25/41/59 (ESCSUITE-262: the parity spec now runs on Firefox, four runs 2026-10-11; 0.195–0.356 when ESCSUITE-265 ran it by hand); probe decode 0.00 on eight colour and size variants. The trimmed clip's "previous colour segment at export frames 25–26" (68.3/255) that ESCSUITE-254 found was the `<video>` path, not the worker: frame 25 the boundary seek below, frame 26 the seek skip ESCSUITE-263 removed. Its `VideoDecoder` drops `rotation`, so a rotated source is refused and keeps `<video>` (with the notice) — the parity spec's rotated case asserts exactly that refusal on Firefox (one fallback naming "VideoDecoder cannot rotate its output", no `FRAME_READY`, the notice shown) rather than a worker decode. CI's gating job runs Chromium only; Firefox runs under `pnpm test:e2e:browsers` | yes |
| WebKit 26.6 | — | probe decode beside `<video>` (ESCSUITE-262, six colour fixtures): 6.5–8.0/255 mean, up to 17.6 on one frame — colour, not timing. Its `<video>` picks the matrix per stream (BT.601 for untagged SD and a `colr` 6/6/6 box, BT.709 for a fully tagged, a matrix-only or a `colr` 1/1/1 stream) and colour-manages (Apple's 1.961 video gamma to sRGB, SMPTE-C to BT.709 primaries for a BT.601 source; model residual 0.39–0.50); its `VideoDecoder` ignores `VideoDecoderConfig.colorSpace` (echoed by `isConfigSupported`, no effect on a pixel), hands back full-range NV12 tagged `bt709/bt709/iec61966-2-1/full`, and `drawImage` draws it as plain BT.709 with no conversion (residual 0.31–0.49). `copyTo({ format: 'RGBA', colorSpace: 'srgb' })` resolves but writes zeros. No decoder configuration closes the gap; re-wrapping the planes in a new `VideoFrame` tagged with `<video>`'s matrix and primaries (transfer `bt709`, full range) brings every fixture to 0.44–1.22 — a per-frame copy in the worker (one `VideoFrame` allocated and closed per decoded frame), not a `decoderConfig.ts` rule. **Not admitted (ESCSUITE-285)**: WebKit is not a primary export target, that copy is a per-frame cost the editor does not take on for it, and the parity spec cannot run there end to end (it cannot import media under Playwright: IndexedDB refuses the Blob, ESCSUITE-258), so the spec skips WebKit; the in-page `<video>` path is correct on WebKit and stays | no |
| anything else, or no `navigator` | — | not measured | no |

The table is the **decode worker's** allow-list. The import-time frame-rate probe has its own, narrower
one — `isMeasuredFrameRateEngine`, Chromium alone, in the same module — because the probe's Firefox output
was never characterised where the worker's was (ESCSUITE-327; see the frame-rate paragraph under
`videoProcessor.ts`). `isMeasuredWorkerDecodeEngine` is written as that predicate plus `isFirefoxEngine`, so
the Chromium test exists once.

- **`mp4Demux.ts`** — `mp4box.js` demuxing of the first video track: every sample in decode order,
  timestamps in whole microseconds with the **edit list applied** (x264's B-frame files start
  presentation two frames into the media; ignoring that put every frame two frames late against
  `<video>`), the avcC record, the stream's own colour description, and the `tkhd` display matrix
  read as a clockwise `rotation`. **The ordering constraint (ESCSUITE-254):** mp4box parses an
  in-memory file *inside* `appendBuffer()` and fires `onReady` and `onSamples` from within that call,
  so extraction must be armed — `setExtractionOptions()` then `start()` — **inside `onReady`, before
  `appendBuffer()` returns**, then `flush()`. Armed after it returns (how the worker shipped in #89,
  2026-01-17), no sample is ever delivered: every source threw "No keyframes found in video",
  `FrameSourceFactory` caught it with a `console.warn`, and every MP4 export for nine months decoded
  in the page while logging "Using WebCodecs". Completion is the track's own `nb_samples`, with a
  bounded wait that rejects naming the counts (a truncated file is a named failure, not a hang).
  Every refusal below is decided in `onReady`, before extraction is armed, so a refused file has
  none of its samples copied.
- **`avcConfig.ts`** — the first SPS's VUI from the avcC (emulation-prevention bytes removed,
  everything before the VUI skipped): the colour description, the full-range flag, and whether the
  sample aspect ratio is 1:1.
- **`decoderConfig.ts`** — the `VideoDecoderConfig`. **Colour.** A raw `VideoDecoder` given no colour
  space draws a stream that does not describe its colour as BT.709 at every size, where Chromium's
  `<video>` uses a size guess — BT.601 below 720 coded lines, BT.709 from 720 (718 is 601, 720 is
  709, width plays no part) — up to ~20/255 apart on saturated colours. What was measured in
  Chromium 153, `<video>` beside the decoder, shape by shape (ESCSUITE-254 fix rounds 1 and 2):
  **untagged** (nine sizes) — `<video>` draws the guess; **VUI tagging only its matrix** (BT.709,
  primaries and transfer unspecified, 160x120) — `<video>` draws BT.601, the guess, not the tag;
  **VUI fully tagged** BT.709 (640x480, and 160x120 BT.709 and 1280x720 BT.601 files) — both draw the
  stream's own colours whatever the decoder is given; **VUI full-range flag alone** (640x480) — both
  draw the same whatever the decoder is given; **`colr` box alone** over an untagged VUI (6/6/6 and
  1/1/1) — `<video>` follows the box (BT.601 at 1280x720 where the guess says BT.709, BT.709 at
  160x120 where it says BT.601), and the decoder, which sees only the bitstream, draws what it is
  given; **`colr` disagreeing with a fully tagged VUI** — `<video>` draws the VUI's. Firefox 155's
  decoder ignores the config, its `<video>` ignores the `colr` box, and the two matched in every
  shape. The rule implemented (`mp4Demux.ts`'s `StreamColour`): whether a stream is tagged is
  decided by its **bitstream**, the only thing the decoder sees — a VUI with primaries, transfer and
  matrix all specified gets **no** `colorSpace`; a description carried only in a `colr` box (all
  three specified, over an untagged VUI) is handed to the decoder as its colour space; anything else
  gets the guess, with the stream's own range when it signals one. A `colr` box whose code points
  differ from any colour description in the bitstream (fully tagged or matrix-only), or that
  `VideoColorSpaceInit` cannot name (wide gamut, HDR), is refused to `<video>` rather than one of the
  two picked. Pinned at the demux level and in the e2e parity spec (the matrix-only and both
  `colr`-only files are cases there: the matrix-only one is the shape where the rule changes
  Chromium's pixels, and the `colr`-only BT.601 one measured 8.08/255 apart before the box was
  handed over). **Rotation:** the matrix's quarter turn goes in `config.rotation`;
  Chromium (all four turns, against its own `<video>`) stamps it on every output `VideoFrame`, whose
  `displayWidth`/`displayHeight` and nine-argument `drawImage` (the crop's source rect) are then in
  the rotated orientation exactly as `<video>`'s are. A browser that does not implement the member
  drops it from `isConfigSupported()`'s echo and the track is refused. The echo proves the member is
  known, not that it is drawn — enough only behind the allow-list. `hardwareAcceleration` is always
  `'no-preference'`: `'prefer-hardware'` is a requirement in Chromium and would refuse every source
  on a machine with no hardware decoder.
- **`frameDecoder.ts`** — returns the frame `<video>` shows at a time (the latest whose timestamp is
  at or before it, within half a millisecond), from a small cache. It feeds chunks in decode order
  up to the requested one, then one at a time while a reordering decoder holds the frame back,
  resets only to go backwards, jumps straight to a later group's keyframe, flushes at the end of
  the stream, keeps every frame ahead of the playhead (they are what an in-order export asks for
  next) and evicts behind it to `maxCachedFramesPerSource` (8). Every wait is bounded: a decoder
  error or a stall (no progress for 5 s) rejects the request, and every later one, by name.
- **Refused by name, so the source falls back to `<video>`:** a codec other than H.264 (the only
  codec compared against `<video>`; HEVC — the iPhone camera default — VP9 and AV1 in MP4 keep
  `<video>`), a fragmented file, more than one sample description or one with no avcC, non-square
  pixels (a VUI sample aspect ratio or a `pasp` box other than 1:1 — `<video>` draws those wider or
  narrower, and a decoder frame's handling of them was never measured), an edit list other than one
  plain edit, a display matrix other than the four rotations (a mirror, a scale), a codec the browser
  cannot decode, a rotated track in a browser without `VideoDecoderConfig.rotation`, and — before
  anything is read — a source that would take the export past `MAX_WORKER_SOURCE_BYTES` (512 MB,
  `frameSource.ts`), **summed over the export's sources**: the worker holds every encoded sample of
  every source it takes until the export ends (mp4box copies them out of the file, read into memory
  first; the peak while one is demuxed is the budget plus that source again), where `<video>`
  streams from the Blob. The figure is a judgement, not a measurement.
- **A fallback is visible (ESCSUITE-254):** `FrameSourceFactory.createSource(…, onFallback)` reports
  a source the worker refused, and wraps the ones it took so that a frame the worker fails
  mid-export hands **that** source to a `<video>` element for the rest of the export — at the
  failing request's own time, reported the same way — instead of leaving the clip missing. The
  handover is per source: `VideoDecodeManager.disposeSource` rejects only its own source's pending
  requests, and a frame the worker sends back for a request already settled is `close()`d. A
  `<video>` fallback that never loads skips its clip, as the oracle does, and never fails the
  finished export at cleanup; `disposeFrameManager` disposes each source in its own `try`, so the
  worker is always terminated. After the worker is ready, a worker `error` or `messageerror`
  rejects every frame request and every source load in flight, so an export never waits for an
  answer one of those events says is not coming. A worker killed outright (an out-of-memory kill,
  say) is not guaranteed to fire either, and the worker's own 5 s stall bound dies with it, so
  **every frame request also has a main-thread deadline (ESCSUITE-266)**:
  `FRAME_REQUEST_DEADLINE_MS` (15 s) in `VideoDecodeManager.getFrame`, one timer per
  request, cleared wherever the request settles (an answer, an error reply, a dispose, a worker
  `error`, `terminate()`). On expiry the manager terminates the worker, presumed dead, rejecting
  that request and every other request and source load in flight with "Decode worker did not
  answer within 15 s for <sourceId>", so every source the worker held falls back to `<video>` at
  once, through the same handover and the same once-per-export line, rather than each after a
  deadline of its own. **Like the worker's own 5 s bound, it measures silence, not age
  (ESCSUITE-272):** `FrameDecoder.getFrame(seconds, onProgress)` calls the request's listener on
  every decoder output from the moment the request is made until it settles — while it is served,
  and while it is queued behind a request the same decoder is serving (an export asks for two clips
  of one source at once, and the second's answer waits on the first's decode) — and the worker
  posts each call as `{ type: 'FRAME_PROGRESS', requestId }`. The manager re-arms **that request's**
  timer on each one (clear and set, reusing a per-request `expire` callback, so a re-arm allocates
  only the handle) and ignores one for a request it no longer holds (answered, disposed,
  terminated, or never issued). So a live worker still decoding a hard request — a long keyframe
  gap on a slow machine, a transition of a clip onto itself bouncing one decoder between two
  positions — is never mistaken for a dead one however long the request takes, and progress on one
  request cannot keep a silent one alive: a request with no decoder output on its behalf for 15 s
  still terminates the worker as above. The cost is one small message per decoder output per
  waiting request. **Every source
  load has a deadline too (ESCSUITE-273)**, because `exportMP4.ts` awaits every load before the
  frame loop makes a single request, so a worker killed mid-load — where its memory peaks and an
  out-of-memory kill is likeliest — never reached a frame deadline and hung the export.
  `loadDeadlineMs(byteLength)` in `VideoDecodeManager.loadSource` is `LOAD_DEADLINE_FLOOR_MS`
  (30 s) plus `LOAD_DEADLINE_PER_MIB_MS` (250 ms) per MiB, scaled because a load's honest duration
  grows with the file (mp4box parses all of it): a 20 MiB ESCAPECRAFT take gets 35 s, a 512 MiB
  source — the whole per-export budget — 158 s. One timer per load, sized before the post
  transfers (and detaches) the buffer but armed only after the post returns — so a post that throws
  leaves no timer behind to terminate a live worker later — stored beside the load's entry and
  cleared wherever the load settles (`SOURCE_READY`, the worker's error reply, a dispose of that source — which now rejects
  its load with "Source disposed", so its deadline cannot terminate a worker the other sources
  still use — a worker `error`, `terminate()`). On expiry the manager runs the same terminate path
  a missed frame deadline does, rejecting that load and everything else in flight with "Decode
  worker did not finish loading <sourceId> (<n> MiB) within <s> s", and refuses every later load
  with that reason instead of starting another worker. `FrameSourceFactory.createSource` already
  hands a source whose load rejects to `<video>` with the reason, so the source that missed its
  deadline and every source after it fall back there, a source the worker already held hands
  itself over at its next frame (its frame request refused with the same reason), and the export
  continues with the same once-per-export line. **The export's Cancel runs the same terminate
  path (ESCSUITE-314).** The `signal` `initialize()` takes for its startup wait now governs the
  manager for its whole life, through one listener per manager rather than one per request: an
  abort terminates the worker in the abort's own dispatch, rejects every load and frame request
  in flight with the export's own `ExportAbortedError` — which `createSource`,
  `FailoverFrameSource.getFrame` and `getFrameAtTime` pass straight on rather than handing to
  `<video>` or skipping a frame for, and the dialog reads as a cancel — and refuses every later
  load and request with it, starting no new worker. Without it a Cancel waited for the worker to
  answer, which on a healthy slow decode posting `FRAME_PROGRESS` was as long as the decode took,
  and every remaining source was still loaded; `exportMP4.ts` also checks the signal before each
  source load and in the load's `catch`, so the `<video>` path stops loading too. A `<video>`
  load already under way is not interrupted — ESCSUITE-325's 15 s wait, on the in-page path and on
  `FailoverFrameSource`'s mid-export handover alike — so on that path Cancel can take up to 15 s to
  settle; the check after the load is what then throws `ExportAbortedError`.
  `exportMP4.ts` turns any report — and the worker not starting, or the engine not being admitted —
  into the progress line "Decoding in the page; keep this tab in the foreground", **once per
  export**, at the progress the export has reached. The `console.warn` keeps the detail. A source
  that is not an MP4 — a WebM, which is every ESCAPECRAFT recording — is never offered to the
  worker (it demuxes MP4 only), and `createSource` reports it through the same `onFallback` at
  creation, with its MIME type in the reason, whenever the worker is running (ESCSUITE-261); a
  factory with no worker has already raised the line at the export's start. Two WebM sources, or a
  WebM beside an MP4 that is later handed over, still say it once. The export dialog's own up-front
  copy still promises background-tab encoding and is left for the follow-up that either demuxes WebM
  in the worker or rewords the dialog.
- Returns `VideoFrame` clones (transferable) for zero-copy performance; the exporter closes each.
- Pinned end to end by `apps/e2e/tests/export/decode-worker.spec.ts` (Chromium; Firefox run by hand):
  a real source exports with the worker answering `FRAME_READY` and no fallback; the same project
  exported with `Worker` forced off (the `<video>` path, the oracle) matches at frames 0, 25, 41 and
  the last — for an untagged source, a BT.709-tagged 480p, a full-range 480p, a matrix-only-tagged
  source, two `colr`-only sources (BT.601 and BT.709) and a clip trimmed 0.5 s into its source —
  and, on the untagged and trimmed sources, at the first frame of two colour segments whose start is
  not a whole number of microseconds (frames 8/16 and 17/25), within 1.5/255 (measured 0.000 in
  Chromium, 0.000–0.379 in Firefox; decoding the untagged source as BT.709 measured 3.70); and a
  rotated source exports in the orientation its `<video>` shows. The
  `<video>` path's own seek-skip used to be a strict `> 1/30 s`, which repeated about every other frame at 30 fps (fixed by ESCSUITE-263, now half a frame with the rate floored at 30), and its seek target used to be the requested time itself, which showed the previous frame on one frame start in three (fixed by ESCSUITE-265, below; with it removed, frame 8 measured 70.5 in Chromium and frame 25 of the trimmed clip 66.8 in Firefox). Either can move this oracle, so re-run this spec and record the MAD.
