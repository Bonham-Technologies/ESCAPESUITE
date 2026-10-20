<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# GIF Export (`src/core/exportGIF.ts`, `src/core/gifEncoder.ts`, `src/core/exportTypes.ts`)

The third export format (ESCSUITE-34), and the only one that needs nothing from WebCodecs.

- **It is `exportWebM.ts` with a different encoder.** `exportToGIF` takes the same seven
  arguments in the same order as the other two exporters — so the dialog's dispatch and the
  headless renderer's are one-line additions, not a third calling convention — and drives
  `elementFrames.ts`'s composer exactly as the WebM exporter does. Per frame: `composeFrame(t)`
  (the `openOutputFrame`, the per-clip seek, the one track-ordered draw pass, the transition),
  then one `ctx.getImageData(0, 0, width, height)` and one `writer.addFrame`.
- **Everything a GIF cannot carry is absent, not computed and discarded.** No audio mixing (see
  `audioMixer.ts` above), no muxer, no encoder queue, no backpressure wait. What is left is the
  frame loop, which is also the whole of the export's cancellation surface: the abort is checked
  at the top of every frame, so Cancel stops within one frame, and a `checkAborted` after
  `writer.finish()` means a cancel that landed during the finalise never hands a blob back. A
  failing frame wraps in `ExportError` with the diagnostic log and the frame it reached, the same
  shape both other exporters produce, and every exit — success, throw, abort — calls
  the one `createElementSourceRelease` closure, which releases on the first of them to run
  and does nothing on any later one (ESCSUITE-159: the `complete` report sits between the
  success release and the catch's, so a callback that throws there used to free every object
  URL twice). It also refuses **two** things at the door rather than one: the 2x2
  resolved-resolution guard both video exporters keep, and a frame count below 1 — an empty or
  reversed range would otherwise run no iterations at all and `finish()` a stream with no frames,
  which writes the end-of-stream byte alone (`gifenc` writes the header lazily on the first frame),
  handing back a one-byte file typed `image/gif` after a "complete" report. The video exporters do
  not need that guard: their muxer still finalises a valid, if empty, container. The guard's other
  half is `!Number.isFinite(totalFrames)`, and it is the load-bearing one: `Math.ceil(Infinity)` is
  `Infinity`, which is not `< 1`, so a non-finite range or a clip whose `duration` is non-finite
  (the shape ESCSUITE-97 fixed at the source-metadata level; `JSON.parse` turns a headless job
  spec's `1e999` into `Infinity` past every `typeof === 'number'` check) would otherwise run
  `for (let i = 0; i < Infinity; i++)` and hang the tab.
- **A timeline with no picture in it exports as black, and completes.** `loadElementSources`
  skips an audio-only source — there is nothing to draw from it — so a project whose only clip is
  audio produces its `ceil(seconds x rate)` frames of the raster `openOutputFrame` cleared and
  nothing else: a valid, silent, all-black GIF under a "complete" report. That is intended, not
  incidental (final review, NIT 6, pinned by `exportGIF.test.ts`): a GIF has nowhere to put the
  sound, and refusing would refuse a timeline both video formats export happily.
- **Frame rate and resolution are their own presets.** `GIF_FPS_OPTIONS` is 10/15/20 and
  `gifFrameRate(options.fps)` is the only reader of `ExportOptions.fps`, so `undefined` (every
  caller that predates the format), a stale saved setting and a hand-built headless job spec all
  land on `DEFAULT_GIF_FPS` (15) rather than encoding at whatever they carried. A GIF stores each
  frame's delay in **centiseconds**, so 10 fps (100 ms) and 20 fps (50 ms) are exact while 15 fps
  (67 ms -> 7 cs) really plays at about 14.3 fps — written down beside the constant rather than
  left to be found. `GIF_RESOLUTIONS` is 720p/480p/360p with `DEFAULT_GIF_RESOLUTION` 480p;
  `'360p'` is one entry on the **shared** `ExportOptions['resolution']` union (one union, one
  `getResolution`, one headless `RESOLUTIONS` list) and `resolutionForFormat(format, resolution)`
  is the pure function that keeps it GIF-only, in both directions — to GIF from `'project'` or
  `'1080p'` lands on 480p, and away from GIF while 360p is selected lands on 480p too.
- **Two size estimates, deliberately.** Before the loop there is nothing written to divide, so
  `estimateGifBytes(width, height, frames)` — pixels x frames x 0.3 — is what the dialog shows,
  exported from `exportGIF.ts` so the two estimates live together. From inside the loop every
  progress report carries `estimatedBytes` = bytes written so far / frames done x frames total,
  which is **only** ever set there: dividing by zero frames would put `Infinity` on screen. The
  field is optional on `ExportProgress` and the two video exporters never set it, so nothing
  about their progress reports changed.
- **The context is `{ alpha: false, willReadFrequently: true }`**, because every frame reads the
  entire raster back and without the hint a browser keeps the backing store on the GPU and each
  read is a stall. And `getImageData` is called **under** the output transform on purpose: it
  reads device pixels and ignores the matrix, so the frame the encoder sees is the whole output
  raster including any letterbox bar. Nothing is saved, restored or re-transformed around it,
  which is why `exportGIF.perf.test.ts` can still assert one `setTransform` per frame.
- **`exportGIF.perf.test.ts`** is the third per-frame ceiling file, over the same scene and the
  same `openOutputFrame` splitter as its two twins, at 15 fps. Its own laws, all exact: one
  full-raster read-back per frame, one encoded frame per read-back, one writer for the whole
  export, and **no `VideoFrame` created anywhere** — that last one is what would quietly break
  the no-WebCodecs browser if it ever moved.
