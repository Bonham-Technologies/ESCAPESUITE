<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Audio Waveform Visibility (`src/components/Timeline/AudioWaveform.tsx`)

**Where the peaks come from**: `utils/waveform.ts`'s `extractWaveformData`, the one
implementation — called by `core/videoProcessor.ts` for every file the media library imports
(audio *and* video) and by `app/takeImport.ts` for every part of a handed-over take
(ESCSUITE-71). Those are the only two writers, and neither recomputes: a source's peaks are
computed once, when the media arrives, so a source that arrived without them never gets any.
`TimelineTrack` draws a waveform only when the source carries **both** `hasAudio` and a
non-empty `waveformData`, so a source with peaks and no flag shows nothing — which is why the
take import fills the flag in for a recording stored before ESCAPECRAFT wrote one.

**How the peaks are decoded** (ESCSUITE-338). `extractWaveformData` streams: mediabunny demuxes
the file's primary audio track and decodes it a chunk at a time (WebCodecs `AudioDecoder`, or
mediabunny's own PCM reader for a WAV), and `utils/waveformPeaks.ts`'s `PeakReducer` folds each
chunk into min/max peaks and drops it. Peak memory is the peaks plus one decoder chunk instead of
the whole track as Float32 (a ten-minute 48 kHz stereo Opus file: renderer peak RSS +101 MB
streamed against +473 MB through `decodeAudioData`; numbers in
[`performance-benchmarks.md`](../../../../docs/reference/performance-benchmarks.md)). The reducer
buckets exactly as the old whole-buffer code (`peaksFromPcm`, kept verbatim) — mono is
`(L+R)/2` in Float32, `ceil(duration × 100)` buckets of `floor(length / buckets)` samples by
absolute index, min/max from 0, `hasAudio` = any peak past 0.001 — so for the same PCM the peaks
are identical whatever the chunking (`waveformPeaks.test.ts`). It holds samples only for the first
`streamingThreshold` (~4.8 s at 48 kHz), because the bucket size depends on the final length;
after that it runs the four bucket sizes that length can still pick and keeps the right one.
Frames before timestamp zero (codec priming an MP4 edit list declares) are dropped, as
`decodeAudioData` drops them.

The old whole-file `decodeAudioData` path is the **fallback**, taken when the streamed one cannot
read the file: no demuxer recognises the container, the codec has no `AudioDecoder` here (or there
is no `AudioDecoder` at all), the decode throws part-way (warned), or the codec
is **MP3**, which mediabunny decodes without trimming the LAME/Xing encoder delay and padding that
`decodeAudioData` trims (streamed peaks would sit ~25 ms late). A container mediabunny reads and
finds no audio track in answers `hasAudio: false` with no decode at all.

## Audio placement: holes are lost audio (ESCSUITE-368)

**Decision (owner, 2026-10-27).** A MediaRecorder Opus track (a CRAFT PiP or webcam take) has
**holes**: packets whose timestamps jump 20–50 ms past the end of the one before, where the
recorder lost audio. They are real lost audio, not timestamp jitter. ESCAPEARTIST places a
source's decoded audio **by its packets' timestamps** and leaves each hole silent, in the export
mix (`core/audioMixer.ts`) and the waveform peaks (`utils/waveform.ts`), both through
`utils/audioPlacement.ts`. The preview already did: it plays the source through a `<video>` /
`<audio>` element, which honours the timestamps. Laying the samples end to end instead closed
every hole and pulled the rest of the take earlier: measured on 120 s PiP takes on a loaded host,
−170 to −189 ms laid end to end and −173 ms through the WebM export, against +29, ≈−10 and +21 ms
placed by timestamp. This supersedes the 2026-10-23 reading that the gaps were jitter (and the
ESCSUITE-367 note not to fill them), and reopens ESCSUITE-297 H4.

- **How.** Neither mediabunny's `AudioSampleSink` nor Chromium's `AudioDecoder` passes a packet's
  timestamp through exactly (both count decoded frames from the first; mediabunny resyncs only once
  they drift a whole chunk apart), so `PacketClock` reads the
  packets' timestamps (`EncodedPacketSink`, metadata only) alongside the decode and pairs them
  with the decoded chunks in order, one chunk per packet. `TimestampPlacer` puts each chunk at
  its timestamp: a later one leaves silence before it, an earlier one has its overlapping start
  trimmed, so samples never stack.
- **Tolerance: 10 ms** (`PLACEMENT_TOLERANCE_SECONDS`, half a 20 ms Opus frame). A chunk within
  10 ms of where end to end puts it is not moved, and the error is measured against the
  timestamps themselves, so jitter never adds up. A MediaRecorder track's per-packet jitter is a
  few ms either way and cancels; its holes are 20–50 ms. A file whose packets tile — a CRAFT
  WebCodecs take, WAV, MP3, AAC from other tools — comes out sample for sample as before.
- **Opus and AAC only** (`placesByTimestamp`): their every packet decodes to one chunk of one
  fixed frame, so chunk and packet pair up in order, and MediaRecorder writes nothing else. Any
  other codec (Vorbis, whose first packet decodes to nothing and whose blocks vary; PCM; FLAC;
  MP3) is laid end to end as before: a pairing off by one there would move audio in a file with
  no holes.
- **First chunk.** The clock is set from the second chunk: Chromium trims Opus pre-skip from the
  first chunk (648 of 960 frames for a CRAFT take), so the first chunk's timestamp says nothing
  about where its frames end. (A decoder that swallowed its first packets whole would shift the
  pairing, and so each hole, by that many chunks; Chromium's Opus and AAC decoders do not, and
  Safari's AAC is unmeasured.) A hole between the first two packets is not seen, and a track whose
  first packet is stamped after zero still starts at the source's frame 0 (as before; the preview's
  media element honours that lead-in, the export does not).
- **`decodeAudioData` fallback.** It returns one buffer with no per-packet lengths, so
  `placeDecodedFile` reads the packets' timestamps and, for an Opus or AAC track only (one fixed
  frame per packet), takes the median step as the frame. If fewer than 80% of steps are within
  30% of it (a track mixing frame sizes), or the timestamps hold no more than 10 ms of holes
  overall, the buffer stays end to end; otherwise it is cut into one equal run per
  packet and each run placed. AAC priming that `decodeAudioData` trims does not count as a hole.
- **The guard.** `apps/e2e/tests/regressions/ESCSUITE-368.spec.ts` (`@nightly`) records 120 s
  takes on both recorder paths and exports the PiP take; each must keep its beep-to-picture
  offset within 50 ms from first beep to last.

What still differs from the old peaks, measured in Chromium 141:

- **Sample rate.** Peaks are computed at the file's own sample rate. `decodeAudioData` resampled to
  the AudioContext's, which is the output device's rate, so the old peaks were never the same on a
  44.1 kHz and a 48 kHz machine. At equal rates the peaks match to 3e-5 (a CRAFT WebCodecs-recorder
  Opus WebM muxed by mediabunny, with and without a video track; a MediaRecorder Opus take; a 16-bit
  WAV) or exactly (Vorbis).
- **Opus pre-skip.** mediabunny's Matroska demuxer ignores the OpusHead pre-skip (CRAFT's files
  carry 312 samples and no CodecDelay), but Chromium's `AudioDecoder` trims it itself: the first
  decoded chunk of a 960-sample frame is 648 samples and the stream is exactly as long as
  `decodeAudioData`'s. So nothing here skips it, and skipping it again would put the peaks 6.5 ms
  early. An engine whose `AudioDecoder` did not trim it would show peaks 6.5 ms late.
- **`DiscardPadding`.** An ffmpeg-muxed WebM whose last Opus block carries `DiscardPadding`
  (mediabunny's muxer and MediaRecorder write none) streams up to one frame longer, because
  mediabunny does not apply it. The old bucketing's `floor(length / buckets)` can then move from
  480 to 479 samples (or back), and the peaks drift by one sample per bucket against the old ones.
- **AAC priming** in an MP4 is dropped only because mediabunny hands the edit list's priming frames
  over with negative timestamps, which the streamed path skips; a file whose priming is not
  expressed that way keeps it (~21 ms of leading frames). Unmeasured here: this Chromium build
  decodes no AAC.
- **Over full scale.** Opus mixed louder than full scale is soft-clipped by `decodeAudioData`'s
  decoder and not by `AudioDecoder`; `PeakReducer` clamps its peaks to [-1, 1], so they stay in
  range, though a clamped peak is not the soft-clipped value. In-range PCM is unaffected.

The audio **library thumbnail** is drawn from the same peaks (`generateAudioThumbnail(peaks)`,
resampled to one column per pixel), so an audio import decodes its audio once; it used to run its
own `decodeAudioData` of the first channel first. Decoding stays on the main thread's event loop
(the `AudioDecoder` itself decodes off it; the reduce is a min/max pass per chunk) — a worker
would need the decode worker's file:// inlining for the headless and standalone builds.

**Resolution follows the visible window, not the clip box** (ESCSUITE-13). Before this, the
component always resampled the clip's *whole* trimmed range to at most 2000 samples and drew
it across a canvas capped at `MAX_CANVAS_WIDTH` (4000 CSS px), with `canvas.style.width`
stretched to the clip's full (unclamped) width beyond that. Zooming in bought nothing: a 60s
clip read exactly 2000 distinct peak values at zoom 1 (3000px box) *and* at zoom 10 (30,000px
box, a 7.5x CSS stretch of the same 4000px bitmap) — the resample never got finer, only wider.
Three ceilings stacked to cause it: the 2000-sample cap, the 4000px backing-store clamp, and
(unreachable without raising the other two) `utils/waveform.ts`'s 100 peaks/sec source
envelope.

The fix moves the unit of resampling from "the clip" to "the slice of the clip actually on
screen": `TimelineTrack` computes each clip's `visibleRangePx` — the intersection of its box
with `Timeline`'s `scrollLeft`/`containerWidth` (both exposed from `useVirtualizedTimeline`,
previously unused outside it) — and passes it to `AudioWaveform`. A clip whose whole box fits
on screen gets `undefined` (a zero-allocation shortcut: there is no window narrower than the
clip to speak of). A clip wider than the viewport gets `{ offset, width }` in clip-local
pixels. Either way, `AudioWaveform` resamples only `getPeaksForRange`'s slice for that window
— the whole clip's range in the `undefined` case — so scrolling or zooming in on a wide clip
keeps shrinking the *time span* one resample covers, which is what actually buys detail, rather
than stretching the same whole-clip array wider. (Round 2, below, replaced the sample-count
formula sketched in the original PR here with a continuous one and added scroll-side
throttling; see that section for what actually ships.) The resample itself is a `useMemo` over primitives
derived from props (never the `visibleRangePx` object's identity, so a `TimelineTrack`
re-render that leaves the window unchanged — a clip drag elsewhere on the same row, a
playback tick — costs nothing); each `AudioWaveform` instance also keeps a small
`(zoom bucket, window) → resampled peaks` cache on a ref, invalidated outright the moment its
`peaks` array reference changes, so scrubbing back and forth over one clip at one zoom does not
re-resample every pixel of scroll. `TimelineTrack.waveform.perf.test.ts` pins the call-count
property: one resample per zoom or scroll change, zero per animation frame.

The CSS/backing-store stretch is gone too, on **both** paths: the backing store and
`canvas.style.width` are now always derived from the same number — the requested width (the
window's, or the whole clip's in the fallback) clamped to `MAX_BACKING_DIMENSION / dpr` — so
they can never disagree. The canvas is also repositioned with an explicit `style.left` (the
window's offset, 0 in the fallback) rather than relying on `.waveform`'s CSS default, since it
no longer spans the clip's full box when windowed.

**Round 2 (same ticket, same day): the fix above was correct but too expensive on scroll, and
left a visible seam.** A scroll fires faster than it renders — a trackpad or inertial scroll can
raise many `scroll` events inside one animation frame — and each one wrote `scrollLeft` into
React state that every on-screen audio clip's window depends on, so one scroll *event* (not
frame) cost one full `resamplePeaks` allocation per visible clip, with the request itself
overshooting the source's real 100 peaks/sec envelope by 5–10x (a 6s window asked for
thousands of samples a 600-peak source cannot supply, and `resamplePeaks` dutifully
duplicated what it had to answer). There was also a visible discontinuity exactly at the
fallback/windowed boundary — a clip that had just filled the viewport read 2000 samples, the
same clip scrolled one pixel further read several thousand, and the envelope visibly flattened
at that frame. Four changes, all in `AudioWaveform.tsx` unless noted:

- **The window is quantised to a 64px grid** (`WINDOW_BUCKET_PX`, `bucketWindow`) before
  anything downstream reads it — rounding the start down and the end up, so the bucketed window
  always contains what was actually asked for. A scroll that moves by less than one bucket
  changes nothing: not the memo's dependencies, not the cache key, not the canvas's size or
  position. This also closes the discontinuity above as a side effect: the bucketed window is
  usually a little *wider* than the viewport, which hides a frame or two of scroll/render lag
  behind its edges.
- **There is no separate "fallback mode" any more.** `targetSamplesFor` runs one formula
  everywhere: at least `FALLBACK_SAMPLE_FLOOR` (2000) samples when the window's own data
  supports it, otherwise one sample per device pixel of the window — but *never* more samples
  than `getPeaksForRange` actually returned for that window (`windowPeakCount`, no overshoot).
  Because the formula is continuous in the window's own pixel width rather than switching on
  "is this windowed at all", there is no boundary left to be discontinuous across, and
  `TimelineTrack`'s `visibleRangeFor` still reports no window (`undefined`) for a clip that
  fully fits on screen purely as a zero-allocation shortcut, not because the arithmetic differs.
- **The scroll handler itself is rAF-coalesced** (`useScrollSync.ts`'s `handleTrackScroll`):
  the ruler and the track headers are synchronous DOM writes as before, but the call that feeds
  React state (and therefore every visible clip's resample) is deferred to at most once per
  animation frame, latest `scrollLeft` wins — the same pattern `useVirtualizedTimeline.ts`'s
  `useScrollTracker` already used elsewhere in this file, just not on this path.
- **`resamplePeaks` (`utils/waveform.ts`) takes an optional reusable output array.** Each
  `AudioWaveform` instance keeps a small pool of evicted entries' arrays
  (`WaveformCache.freeBuffers`) and hands one to a cache-miss resample instead of letting it
  allocate fresh — `resamplePeaks` mutates each `{min,max}` slot already at an index rather
  than replacing it, and never aliases a source peak object (the old single-sample branch
  returned `peaks[i]` directly, which would have let a later mutation of a reused buffer
  corrupt the caller's own data).

  The cache itself (`WaveformCache`) is also now a real LRU, not FIFO: a hit deletes and
  re-inserts its `Map` key, which places it at the end, so eviction — always from the front —
  never removes a window the user keeps scrolling back to. It is bounded by total samples held
  (`MAX_CACHE_SAMPLES` = 2,000,000, a circuit breaker rather than a tight budget now that a
  window's own size is capped at its source peak count) rather than by entry count, and its key
  additionally includes `startTime`/`endTime`/`sourceDuration` — the window's pixels alone
  under-specify what `getPeaksForRange` actually reads, so a trim that moves those without
  moving the clip's pixel window must still miss rather than reading back a stale slice.
- **`useScrollSync.ts`'s container-width measurement moved from a passive effect to
  `useLayoutEffect`.** A passive effect runs after the first paint, so `containerWidth` stayed
  at its initial 0 for one frame, `viewportRight` read `Infinity`, and every clip — including
  one wide enough that the (then-)fallback path clamped its canvas — took the whole-clip path
  for that one frame, visibly compressing a wide clip's waveform into the left part of its box
  until the real width arrived. A layout effect runs before paint, so the browser never shows
  that frame.

**What the fix is actually worth**: production peaks are still extracted at 100/sec
(`utils/waveform.ts`), which is now **the** binding ceiling above roughly one screen pixel per
10ms of clip (\~100px/sec of clip on screen) — past that point `targetSamplesFor` is capped by
`windowPeakCount`, not by pixels, and more zoom buys nothing further without raising the
extraction rate too. Below that point, a 60s clip's finest window improves from 30ms/sample
(whole clip ÷ 2000) to the source's own 10ms/sample floor — about **3x**, not the order of
magnitude a dense synthetic test source can show. The ticket's own worst case is where it
matters most: a 10-minute clip's whole-clip fallback was 300ms/sample, so the same 10ms floor
there is about **30x**.

**Round 3 (same ticket, re-review of round 2): the free-buffer pool wasn't actually tested, the
sample budget was still too large in absolute terms, two defects, and a loose end on the
seam.**

- **Buffer reuse, made real.** Round 2's `MAX_FREE_BUFFERS` pool was fed only by eviction, and
  with entries near `MAX_BACKING_DIMENSION` in size, one eviction always covered the next
  insert's overshoot — so the pool only ever held 0 or 1 buffer, never tested past its own cap.
  `MAX_CACHE_ENTRIES` (1024) is a second, independent eviction trigger alongside
  `MAX_CACHE_SAMPLES`: a *count* of windows kept, which bounds a session of many small/sparse
  entries (a near-silent recording, a heavily zoomed-in short clip) that the sample budget alone
  would never catch, since nothing else bounds how many tiny entries accumulate. 1024 is
  deliberately *larger* than what the sample budget needs for realistically-sized entries
  (which it already bounds at 32–660 distinct windows, depending on entry size) specifically so
  the two caps don't collide — a small count cap would itself become the binding constraint and
  prevent the sample budget, and the free-buffer pool's own overflow behaviour, from ever being
  exercised by a realistic-entry-size test.
- **The sample budget is 500,000, not 2,000,000, now with the arithmetic that number implies.**
  Round 2 reasoned the 2,000,000-sample figure as "nowhere near what a realistic session
  reaches" without converting it to bytes; it is 64–96 MB of retained peaks **per mounted audio
  clip**. 500,000 (~16–24 MB) is still generous against what a realistic window costs. The
  actual fix — storing peaks as two parallel `Float32Array`s instead of an array of `{min,max}`
  objects, which the draw loop could read with zero allocation — touches `resamplePeaks`'s
  public return type and every existing caller/test of it, a larger refactor than this round
  had room for; lowering the budget is the stopgap, and the `Float32Array` conversion is the
  documented next step.
- **Defect: bucketing could manufacture a window out of nothing.** `bucketWindow` rounds its end
  up, which — applied to a *genuinely* zero-width request (a clip just past the strict viewport
  edge but still inside the virtualiser's wider overscan, so it is mounted and drawing at all) —
  could produce a window of up to `WINDOW_BUCKET_PX - 1` pixels where none should exist. The
  zero-width check now runs on the raw, pre-bucket width, before `bucketWindow` ever sees it.
- **Defect: `TimelineTrack`'s per-clip `visibleRangePx` cache (NIT-2, round 2) never shrank.**
  A clip scrolled away and never revisited — or, the common case, trimmed away or deleted
  outright — left its cached object in the `Map` forever. `pruneVisibleRangeCache`
  (`visibleRangeCache.ts` — its own file, not `TimelineTrack.tsx`, so it can be `export`ed
  without breaking that file's Fast Refresh) deletes entries for clips no longer in `clips`,
  run whenever `TimelineTrack`'s own `clips` prop changes identity (no more often than that).
- **The fallback/windowed seam (MINOR-3, round 2) gained a direct test**: a window explicitly
  covering the whole clip (`{ offset: 0, width: fullWidthPx }`) now has a test asserting it
  draws the same detail as the implicit whole-clip case (no `visibleRangePx` at all) — the
  clearest possible proof there is no separate code path left for the two to disagree across.
- **`Timeline.tsx`'s `viewportRight` no longer reads `Infinity`.** Round 2's `useLayoutEffect`
  fix measured `containerWidth` before a *real* browser's first paint, but jsdom never reports a
  non-zero `clientWidth` at all — so a test render saw `containerWidth` stay 0 forever and
  `viewportRight` read `Infinity` for its entire life, not just one frame, meaning every clip
  always took the whole-clip path in every test that didn't explicitly stub a width.
  `DEFAULT_VIEWPORT_WIDTH` (1280, an ordinary desktop width) replaces `Infinity` outright when
  `containerWidth` is 0, so the first (and every) resample windows to something sane instead of
  a clip's entire, possibly enormous, box.

Waveform visualization adapts to clip selection state:
- **Default colors**: Purple (`rgba(138, 43, 226, 0.6)`) for audio, blue tint for video with audio
- **Selected state**: White (`rgba(255, 255, 255, 0.85)`) for high contrast against blue selection background
- **Custom color**: `color` prop overrides default/selected colors when provided
- **Height is the exception to that, and must fit exactly** (ESCSUITE-76): the component writes
  one number to both the backing store and `style.height`, so nothing is rescaled vertically —
  what matters is that the number is the **clip box**, because `.clip` is `overflow: hidden` and
  a taller canvas is simply cut off at the bottom with its centreline left sitting low. The
  caller passes `TimelineTrack`'s `clipBoxHeight`: `track.height` less `.track`'s 1px
  `border-bottom` (which `.clip`'s `height: calc(100% - 8px)` resolves against, `.track` being
  `border-box`) less that 8px inset, clamped to `.clip`'s own `min-height: 40px` — 51px at a
  standard 60px row. It was `track.height - 4`, i.e. 56px, until ESCSUITE-76. The thumbnail's
  attribute box is the same expression, so the two cannot drift.
