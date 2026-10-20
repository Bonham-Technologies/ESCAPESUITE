<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Frame timestamps and keyframes

`WebCodecsRecorder` stamps every encoded `VideoFrame` with the **recording clock at capture** —
`performance.now()` since `start()`, paused time excluded, rounded to microseconds. One private
`nextFrameTiming()` helper decides it for all three capture paths (`MediaStreamTrackProcessor`,
`requestVideoFrameCallback`, the `setTimeout` loop), so they cannot drift apart.

- It used to be `frameCount * 33333 us`. `getDisplayMedia` does not promise 30 fps: a window or a
  screen capture routinely delivers 5-15 frames a second, and counting frames made N of them span
  N x 33.3 ms however long they really took. A 60 s take at 15 fps came out as a 30 s video track
  against 60 s of audio — playback at 2x, with the audio lagging
- **Strictly increasing**: a computed timestamp that does not advance on the previous frame's
  becomes previous + 1 us — two frames inside one tick of a coarse or frozen clock would
  otherwise be stamped the same. This is an **encoder-level** guard, not a container-level one:
  `VideoEncoder` is fed a monotonically increasing presentation timeline and a zero-delta frame
  is a meaningless presentation. Mediabunny itself throws only when a timestamp is below the
  largest of the *previous GOP*, and its WebM muxer rounds each timestamp to a whole millisecond
  (`Math.round(1e3 * chunk.timestamp)`), so 1 us apart and identical land on the same block
  timecode either way
- **A keyframe once per elapsed second** — `keyFrame = timestamp >= nextKeyFrameUs`, then
  `nextKeyFrameUs = timestamp + 1_000_000`, the first frame always a keyframe. The count-based
  rule it replaced (`frameCount % frameRate`) only meant one a second while the source really ran
  at 30 fps; at 10 fps it was one keyframe every three seconds, and seeking paid for it. A
  resume is **not** forced to be a keyframe: a pause consumes no recording clock, so the frame
  after it is keyed only if a second of *recording* has passed since the last keyframe
- **`getDuration()` reads the same clock**: `startTime`, `pauseStartTime` and `pausedDuration` are
  `performance.now()` milliseconds, so the duration the user is shown and the length written into
  the container are read from one monotonic source. They are not guaranteed identical — the
  controller reads `getDuration()` inside `onStop`, after `stop()` has awaited the encoder flushes
  and `output.finalize()`, so it runs a little past the last frame's timestamp. It does not
  matter, because `useRecordingSave` saves `metadata.duration` extracted from the finished blob
  and falls back to `getDuration()` only when that is missing or zero
- The two fallback paths still put a nominal `duration: frameDurationUs` on the `VideoFrame`. The
  muxer derives presentation gaps from the timestamps — a WebM SimpleBlock carries no duration —
  though the segment `Duration` is the last block's timecode *plus* its duration, so the nominal
  33333 us does reach the file, as one frame's worth at the tail
- **`recorder.ts` (MediaRecorder) is untouched.** It stamps no frames of its own — MediaRecorder
  times them — so its `getDuration()` still measures with `Date.now()`; there is nothing for it to
  keep in step with

**One clock, one bookkeeping record per encoder.** `nextFrameTiming(timing, now)` reads the
recorder's shared `startTime` and `pausedDuration` — which is what makes two pipelines' frames
one timeline — while the strictly-increasing guard and the once-a-second keyframe rule live in a
per-pipeline `FrameTiming` (`newFrameTiming()`: one for the screen, one for the companion, both
reset by `start()`). Sharing those two numbers would have interleaved pipelines pushing each
other's timestamps forward and handing the second stream only the keyframes the first did not
claim. `webcodecs-recorder.test.ts` pins the property directly — "stamps both encoders from the
one clock — same tick, same timestamp": two frames captured at one clock reading carry the same
timestamp, each stream's first frame is a keyframe, and a pause is excluded from both.

**The audio pipelines follow the same rule with a different unit.** Each audio pipeline — the mix
and every audio companion — has its own capture with its own stamps, reset by the same `start()`.
Per pipeline rather than shared, and that is the point: three pipelines advancing one counter would
interleave and stamp each other's audio. What they share is the **origin** — one `start()`, one
`AudioContext`, one render clock, one sample rate — which is what puts every part of a take on one
timeline. How each capture stamps is the next two sections.

**Two clocks, made one (ESCSUITE-296).** The audio is counted in **context time** — at the rate the
AudioContext renders: the render position itself on the AudioWorklet path (ESCSUITE-299, below),
the samples `onaudioprocess` delivered on the ScriptProcessorNode fallback — and the video used to be stamped
in `performance.now()`. Nothing compared them, so a take drifted out of sync linearly with its
length: every callback the page never received took 85.3 ms out of the audio, an output device's
crystal running ε fast against the system clock put the audio ε·T behind, and a context that
ignored the 48 kHz request was stamped and labelled as 48 kHz anyway. Three fixes, in
`webcodecs-recorder.ts` and `core/audioGapFiller.ts`:
1. **Lost audio is filled — the rise in the baseline deficit, in render quanta.** *Since ESCSUITE-299
   this is the ScriptProcessorNode fallback's alone* (`createAudioGapFiller()` is called from
   `audioWorkletCapture.ts`'s fallback arm and nowhere else): the AudioWorklet path loses nothing and
   has nothing to fill. One filler per pipeline (the mix and each audio companion). What the ESCSUITE-296
   rig measured in headless Chromium 156, which every earlier version of this rule got wrong, and
   which nobody should have to re-derive:
   - **`playbackTime` is read at dispatch**, not from the buffer's position: under jank it sits one
     buffer ahead of `currentTime` from p5 to p95, and its offset from the sample count tracks
     dispatch lateness with r = 1.00, slope 0.99. (Counting each event's own gap — round 1 —
     read +87, −25 and −33 lost callbacks on takes that lost 0, 0 and 1.)
   - **A real loss arrives as 128-sample creep**, one render quantum (2.67 ms) at a time, not as a
     dropped 4096-sample buffer: ~43 ms over a minute under a 60 ms-per-100 ms busy loop, matched by
     a −41 ms A/V marker drift.
   - **Whole-buffer rules miss it**: the rolling minimum peaked at 80 ms over 8 callbacks and
     58.7 ms over 24, under a 0.95-buffer threshold, while a half-buffer threshold filled a buffer
     that was never lost (lateness above half a buffer can be sustained).

   So each event has a *deficit* — its reference time minus the samples delivered since the
   anchor. The reference is the event's `playbackTime` (dispatch-time is harmless: only minimums
   are used), else the context's `currentTime` read in the callback, else none, and then the event
   takes exactly the old path (what keeps `webcodecsRecorder.perf.test.ts`'s
   one-`AudioData`-per-callback law exact on the fallback path; the AudioWorklet path's law is one
   `AudioData` created, encoded once and closed per posted chunk — the deliberate pin change
   ESCSUITE-299 made, 2026-10-16). Lateness only raises a deficit, so the **baseline** —
   the minimum over the last 8 events or 4 s of them, whichever is more (47 at 48 kHz) — ignores
   it, and lost content raises it for good. The first full window's baseline is the **anchor**, so
   a constant dispatch latency is never filled; a baseline two quanta or more above the anchor is
   filled with all but one of those quanta (zero-valued `AudioData`, chunks of at most 4096 from one
   reused zero buffer, stamped contiguously before the delivered buffer) and the anchor rises by
   what was filled. The window is 4 s, not 2, because on the rig's real log 2 s over-filled by 16 ms
   (a transient rise of the minimum that later fell back) and 4 s matched; the last quantum is left
   because filling every quantum the moment it shows filled a few ms of pure jitter over ten
   minutes — the residual is under two quanta (5.3 ms) and never accumulates. A window whose
   reference times span under half its nominal length is a burst queued behind a hang and is not
   judged. A fill lands about a window after its loss. One fill is capped at
   `MAX_GAP_FILL_SECONDS` (5 s) with one warning per pipeline; the rest stays a step. A reference
   that is not finite is skipped (its buffer's samples still counted), so one NaN cannot poison the
   anchor or the baseline. Two bounded limits, both the price of a windowed minimum: a loss inside
   the take's last window (~4 s) is never filled, and because the anchor never falls, a take whose
   whole first window is uniformly late keeps that lateness unfilled — the price of never filling a
   constant latency. Known limit:
   lateness that never comes back to its floor for a whole window — independent uniform 0–60 ms on
   every callback, where only 4 % land within a quantum of the floor (the rig: 20 %) — can read a
   quantum or two high; bounded, and the suite pins it at ≤ 2 quanta in ten minutes.
2. **Video is stamped in context time.** `start()` reads `audioContext.getOutputTimestamp()`;
   usable (present, finite, non-zero), every frame is stamped with the context seconds elapsed
   since `start()`, extrapolated on `performance.now()` from that pairing and re-read every
   `CONTEXT_CLOCK_REFRESH_MS` (2 s) on the frame path and at every resume, pause time excluded in
   context seconds; `start()` logs which clock the take uses. The strictly-increasing and keyframe
   rules above are unchanged. No `getOutputTimestamp()`, zeros (a context that is not running), or
   a non-finite reading gives the whole take today's `performance.now()` stamps; an unusable
   *refresh* keeps the last good anchor. If the render clock stalls mid-take (context time frozen
   while the wall clock runs), the frames extrapolated across the stall run ahead of it, and the
   first refresh after it pulls the clock back: the next frames are stamped 1 µs apart until the
   video is back with the audio — the picture over that stretch is effectively lost, rather than
   the old permanent step. `getDuration()` stays on `performance.now()`: the primary's stored
   duration is probed from its file, but a companion's is the recorder's wall-clock length, off
   from its muxed length by ε·T (about a third of a second an hour at 100 ppm).
3. **The context's real rate** — `audioContext.sampleRate`, read once after it is built, with one
   `console.warn` naming it when the engine did not honour the 48 kHz request — is the rate of
   every `AudioData`, every audio timestamp, every gap filled and every audio encoder's
   `configure()`. At such a rate the take first asks `AudioEncoder.isConfigSupported()` for Opus,
   and refuses to start if the answer is no, rather than recording a take with no sound.

What a user sees: a long recording no longer drifts further out of sync the longer it runs.
`webcodecsRecorder.audioClock.test.ts` (which replaced the hunt's probe) drives 10- and 60-minute
simulated takes through it — with `playbackTime` both exact and read at dispatch
(`scriptProcessorPlaybackTime()` in the audio double: jitter, queued bursts behind 300 ms and 3 s
hangs, the rig's busy-loop jank, sustained 0–60 ms lateness, a constant latency, 128-sample creep
including the rig's ~43 ms a minute, whole-buffer losses, three pipelines losing independently,
`currentTime` in place of `playbackTime`) — and
`audioGapFiller.test.ts` pins the helper, one case per guard.

**The audio capture: an AudioWorklet, with a fallback (ESCSUITE-299).** The gap filler above is a
heuristic because Chromium computes `playbackTime` when the main thread *dispatches* an
`AudioProcessingEvent`. An `AudioWorkletProcessor.process()` runs on the render thread for every
128-frame quantum without exception and reads the render position exactly (`currentFrame`), and
what it posts over its `MessagePort` is queued, never dropped. So `core/audioWorkletCapture.ts`'s
`createAudioCapture(context, source, { onChunk, label })` — one per audio pipeline, hiding which
path is live — captures through an AudioWorklet wherever it can:

- **The processor** (`AUDIO_CAPTURE_WORKLET_SOURCE`, registered as `'escapecraft-capture'`) is
  loaded with `addModule()` from a `text/javascript` Blob URL — there is no file to serve it from
  in a single-file build — and the URL is revoked once `addModule()` settles. **If that rejects, the
  same source is retried once as a `data:text/javascript;charset=utf-8,…` URL** (ESCSUITE-317):
  opened from disk (`file://`, the offline build), Chromium 156 mints `blob:null/<uuid>` and refuses
  it as a worklet module (`AbortError`) while accepting `data:`; Firefox 157 accepts both; WebKit 26.6
  behaves as Chromium does — refuses the `blob:` module, accepts `data:` (ESCSUITE-321, 2026-10-17; pinned by the
  standalone spec's WebKit case). `blob:` stays first because the hosted `script-src` admits `blob:` and
  must not have to admit `data:`; the retry is the general rule rather than an `isFileOrigin()` gate,
  so any opaque origin (a sandboxed frame) is covered. When both are refused the one fallback line names both rejections, `blob:` first, the `data:` payload elided (the CSP pin reads the `blob:` refusal from it). The one `console.info` line says which kind
  loaded — "(blob module)" or "(data module)". The processor gathers quanta into
  chunks of `CHUNK_FRAMES` (4096, the ~85 ms a ScriptProcessor buffer was) per channel and posts
  `{ frame, channels }`, `frame` the render position of the chunk's first sample, the two
  `Float32Array`s transferred. Once the page has encoded a chunk (copied planar first, so nothing
  keeps the channels) it posts `{ recycle: channels }` back, transferred — even a chunk that kept
  nothing, since the node lives until `close()`, and never after `close()` — and the processor fills
  its next chunk from that pool, allocating a fresh pair only when the pool is empty (ESCSUITE-303:
  two fresh arrays per chunk were ~32 KB of garbage on the render thread every ~85 ms). The pool
  keeps at most `POOL_PAIRS` (4) pairs and drops a fifth, and a pair that is not `CHUNK_FRAMES` long
  (a sliced tail); a recycled pair is never cleared up front, so a quantum with nothing connected
  writes its zeros rather than assuming them. The node is two channels, explicit, connected to the destination
  (silent) so the engine pulls it; an input with nothing connected is recorded as silence, the
  quantum's length read from the node's output rather than assumed to be 128.
- **Stamping is by render position, never by arrival.** The take is a list of recorded spans of the
  render clock — `start()` opens one, `pause()` closes it, `resume()` opens the next, each read as
  `round(currentTime × sampleRate)`, the same frame count `currentFrame` reports. What a chunk
  rendered inside a span is encoded, stamped
  `round((frame − span start + frames recorded before the span) / sampleRate × 1e6)` µs, at
  `sampleRate = audioContext.sampleRate`, planar f32; a chunk that straddles `start()`, a pause or a
  resume is cut there to the frame. So a chunk the page receives seconds late is neither lost nor
  mis-stamped, the audio starts at 0 and runs on across a pause with no gap and no overlap, and
  **pause and resume reconcile the two clocks**: the recorder reads the video's paused time
  (`pausedContextSeconds`, from `getOutputTimestamp()`) and the audio's paused render frames
  (`currentTime`) at the same two moments on the same render clock, so the two subtract the same
  pause, to within a render quantum (2.7 ms), never cumulative.
- **`stop()`** (asked at the top of the recorder's `stop()`, awaited before any encoder is flushed)
  closes the open span at the render position it is called at — so the tail is cut where the take
  ended, not where the render thread got to the message — and posts `'flush'`; the processor posts
  its partial tail and `{ flushed: true }` behind every chunk still queued, and the capture closes the node and its port when that acknowledgement arrives —
  after `FLUSH_TIMEOUT_MS` (1 s) without one it warns once and closes anyway, so a render thread that
  has stopped cannot hold a take hostage. A chunk that arrives after that is ignored. `close()` (the
  recorder's `cleanup()`) lets the node go at once and settles a pending `stop()`.
- **The fallback**: a context with no `audioWorklet` (a browser without one, or an insecure
  context) or whose `addModule()` rejects both the blob: and the data: module gets ESCSUITE-296's ScriptProcessorNode capture from the
  same call, exactly as it was — the samples delivered counted into the stamps, the gap filler
  filling what the page never saw, the context-time video clock unchanged.
- **The choice is made once per `AudioContext`** — once per take, however many pipelines it has —
  and logged once with `console.info`, naming the path (and, for a refused module, the error).
- **The first Opus packet's timestamp is the encoder's, not the capture's (ESCSUITE-321 U-1 /
  ESCSUITE-331).** Firefox 157's Opus `AudioEncoder` subtracts its 312-frame (6.5 ms) lookahead from
  every output timestamp — packets at 0, 13500, 33500 … µs (0, 14, 34 ms in the WebM's 1 ms
  timescale), packet 0 clamped — while Chromium 156's are at 0, 20000, 40000 …; both write OpusHead
  pre-skip 312, so a player honouring CodecDelay trims 6.5 ms from either file and a Firefox take's
  audio may start 6.5 ms earlier than the same take's in Chromium. The capture is not the cause: the
  `AudioData`s the worklet hands the encoder line up end to end in both engines (each stamp = previous
  stamp + previous length; the partial first piece `start()` cuts is intended and pinned). Measured
  with `apps/e2e/tests/perf/first-packet.probe.spec.ts` on branch `verify/escsuite-321`
  (`ESCSUITE_321_PROBE=1`; `*.probe.spec.ts` is ignored by the perf config). Whether to re-base the
  packet timestamps in `webcodecs-recorder.ts`'s encoder output callback is ESCSUITE-331 (Low; under
  the 45 ms lip-sync threshold, left as a documented offset).

**The hosted CSP admits the module.** A worklet module is fetched under `script-src`, so
`vercel.json`'s `script-src` carries `blob:` (ESCSUITE-299; before it, every hosted take was refused
the module and quietly fell back). `apps/e2e/tests/production/csp-audio-worklet.spec.ts` records a
take under the policy `serve-dist.mjs` serves and expects the AudioWorklet line and no violation,
and — with `blob:` stripped from the served `script-src` — the ScriptProcessorNode line naming the
refused `blob:` module (Chromium 156 fires no `securitypolicyviolation` and prints no refusal for a
blocked worklet module; the recorder's own line is the one trace); `serve-dist.test.mjs` pins `blob:` in the policy without a browser. The dev
server, the standalone file and the headless kit send no policy. A self-hosted build that sends its
own needs `blob:` in `script-src` too, or it gets the fallback.

**An audio companion whose encoder fails before its capture exists** — which the real API cannot do
(an error callback is a task, and setup has only microtasks between `configure()` and the capture
being set), but a double can — is refused without throwing inside the error callback: `endCompanion`
finds no capture to stop, the `failed` flag is the mark, and `initializeAudioCompanion` stops the
capture the moment it is built.

`webcodecsRecorder.audioWorklet.test.ts` drives takes through the AudioWorklet double in
`src/test/doubles/audio.ts` (`enableAudioWorkletDouble()`; off by default, so every older suite
keeps the fallback), which runs the real processor source: a 10-minute take with 1 % of chunks
held behind a 2.5 s hang ends on the render clock within a chunk with no silence inserted and every
chunk encoded once; a 44.1 kHz context stamps from `frame / 44100`; a pause leaves no seam; the tail
is flushed and a late chunk ignored; each fallback is engaged with the filler live.
`audioWorkletCapture.test.ts` pins the module, the processor included — and the pool, through the
double's count of every `new Float32Array` the processor makes (`processorArrayAllocations`) and its
lineage log of every buffer that crosses the port (`transfers`): a 20-chunk take with the page five
chunks behind once allocates exactly ten arrays, none after warm-up with the page up to four behind,
and never posts a buffer the page still holds.

`webcodecs-recorder.test.ts` pins all of it against a scripted `performance.now()`: a 30 fps
source, a 15 fps source (the bug above), the strictly-increasing guard under a frozen clock,
keyframes at 0 / 400 / 800 / 1200 ms, paused time excluded from the stamps, and — on the
`MediaStreamTrackProcessor` path, the one every Chrome/Edge screen take actually runs on — the
frame that survives the 0.8x throttle stamped at the 40 ms the clock says.
