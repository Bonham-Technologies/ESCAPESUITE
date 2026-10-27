<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Headless Render Bundle

`pnpm --filter @escapesuite/artist build:headless` (env `VITE_HEADLESS=true`) builds
`dist-headless/headless.html`: a no-UI single file that loads from `file://` in
headless Chromium and exposes `window.__renderProject(input, onProgress?)`.

- Entry: `src/headless/main.ts`; contract types in `src/headless/types.ts`
  (`RenderInput` → `RenderResult` with base64 bytes + output `RenderMeta`).
- Streaming variant `window.__renderProjectToFile(input, onProgress?)`
  (`RenderFileInput` → `RenderMeta`): sources arrive as `File`s in the hidden
  `<input type="file" id="__sources">` (Playwright `setInputFiles`) and the result
  leaves as a browser download named `<outputName>.<mp4|webm|gif>`, so large media
  never crosses the `evaluate()` boundary. `sourceVideos` entries may carry only
  `id`/`name`/`mimeType`; `seedSources` probes the rest from the bytes.
- `renderProject.ts` validates the input (every media clip must have a source and
  bytes — it fails instead of rendering black), seeds sources into IndexedDB via
  `seedSources.ts`, then calls the **same** `exportToMP4`/`exportToWebM`/`exportToGIF` the
  editor uses. No engine fork. The format decision is a three-way dispatch on
  `options.format` with `'mp4'` as the fallback for an unrecognised value, which is what it has
  always been (ESCSUITE-34: before GIF landed it was `=== 'webm' ? 'webm' : 'mp4'`, so a
  `'gif'` job rendered an MP4 whose `meta.format` agreed with itself and with nothing else).
  That is a claim `services/headless-artist/src/verify.chromium.test.ts` now **tests** rather
  than asserts: a clip masked to a circle and given an outline is rendered through this bundle
  in real Chromium and probed with ffmpeg — the frame's corner comes back black, its centre red
  and a point on the circle's own edge white (ESCSUITE-65). There are **two** edge samples, not
  one. The one centred on the outline straddles the circle, so half of it is the clip's own red
  whatever the stroke does: deleting the stroke leaves that sample's **red** above its floor and
  fails on **green and blue** at 0, which is why the predicate is all three channels and not the
  red one. The second sample sits wholly in the band's *outer* half, outside the circle
  altogether, and it is the one that proves the stroke is drawn **outside** the clip region — the
  inner `restore()` in `core/clipMask.ts`. Moving the stroke inside that region is caught by the
  on-outline sample by 22 counts (128 against a floor of 150) and by the outer one by 150 (0
  against 150), which is the whole reason for the second point. The case patches the loaded
  fixture rather than the file on disk, which is what keeps the two golden single-clip cases as
  its control: they assert the whole frame is red, which a masked frame cannot be.
  `verify.chromium.test.ts` makes the same argument for a **crop** (ESCSUITE-6):
  the fixture clip is patched to show its right half, and the rendered frame
  comes back with the export's black background in the two 16-pixel columns the
  uncropped render fills with red, and the fixture's red in the middle. The
  output raster is unchanged — a crop shrinks the picture inside the frame, it
  does not resize the frame — and, as with the mask, the two golden single-clip
  cases are the control, because they assert the **whole** frame is red.
- `render()` runs the store's `convertLegacyOverlays` on the incoming timeline before anything
  reads it, so a `project.json` carrying the legacy `textOverlays`/`shapeOverlays` arrays
  renders and exports identically with or without the store. A project with neither array is
  untouched (the conversion returns the same `Timeline` object).
- `vite.config.ts`'s single-file-build plugins (shared with the standalone build —
  `isSingleFileBuild`, see "Build Configuration" above) emit workers as classic scripts and
  inline them as blob URLs, because `file://` pages cannot load module or file workers.
- **The two call-site shapes, and the fail-loud contract.** `headlessInlineWorkersPlugin`
  reads each emitted worker `.js`, embeds it as a blob URL in `window.__wb`, deletes the file
  and rewrites the `new Worker(...)` call sites to read that map. Vite has emitted two
  different URL expressions for the same source, so the rewrite treats the leading ` ``+ `
  and the trailing `.href` as optional and handles both — `` new Worker(``+new URL(`w.js`,
  import.meta.url).href, …) `` (vite ≤ 8.2) and `` new Worker(new URL(`w.js`,import.meta.url)
  .href, …) `` (vite ≥ 8.3) — then collapses the decode worker's doubled
  `` new URL(window.__wb[K],[``+]import.meta.url) `` wrapper. Replacements are scoped to the
  filenames actually inlined, never a blanket rewrite of other `new URL(...)` uses. Because
  the files are deleted, a rewrite that silently stops matching is a broken bundle, so the
  plugin **throws** rather than warning: if a discovered worker file is missing on disk, if
  any inlined filename survives inside a `new URL(...)`/`new Worker(...)` expression after the
  rewrite, or if any `.js` file is left behind in the output directory (`dist-headless/` for the
  headless build, `dist/` for standalone). That turns a future
  emission change red early, in CI's `build` job, instead of only in
  `e2e`/`kit-docker`. Vite 8.3 broke exactly this and shipped a
  headless bundle whose workers 404'd from `file://` with
  `SecurityError: Failed to construct 'Worker'`.
- `options.resolution` defaults to `'project'`; `meta` describes the encoded output
  (honours `resolution` and `timeRange`).
- **`meta.audio` says whether the file carries sound, and an mp4 whose sources carry an audio
  track is refused where there is no AAC encoder** (ESCSUITE-312). Linux Chromium — the kit's reference image — has no AAC encoder
  (Chromium's AAC is a platform codec on macOS and Windows). `exportToMP4` already answers that
  the ESCSUITE-175 way: it probes AAC first, skips the mix, reports `noAudioNote('mp4')` through
  `onProgress` and returns `ExportResult.audio: false`. This entry used to read
  `{ blob, framesEncoded, loudness }` and drop `audio`, so every kit mp4 job on Linux came back
  `ok: true`, exit 0, a picture-only file, with any `loudnessTarget` silently ignored. Now
  `RenderMeta.audio: boolean` (required) is the exporter's own flag for every format: `true` means
  the format's audio encoder was available, so the file carries a track when the mix had sound
  (`exportToMP4` adds one only `if (audioData)`, so a silent project's mp4 is `true` with no track);
  `false` means the file has none (every GIF). It is returned by both `__renderProject` and `__renderProjectToFile` and written to
  the kit's verification manifest beside `loudness`. And before any exporter runs, an `mp4` in a Chromium where
  `isAudioCodecSupported(aacEncoderConfig(...))` (the probe `exportToMP4` runs, at the job's own
  quality bitrate) answers `false`, whose project has a source that **carries an audio track in
  its container**, throws an `ExportError` with `code: 'AUDIO_CODEC_UNAVAILABLE'` and
  `NO_AAC_MP4_REFUSAL`. The candidates are `audioCandidateSources(clips, tracks, sourceVideos)` in
  `core/exportTypes.ts` — the sources `projectHasAudio` is true because of, each once — and
  `headless/audioTrackProbe.ts` decides: `anySourceCarriesAudio` counts an `audio` source as
  sounded without reading anything (looked for first), then reads each other candidate's
  container **headers** with mediabunny's demuxer (`containerHasAudioTrack`: an `Input` over a
  `BlobSource` or `BufferSource`, `ALL_FORMATS`, `getPrimaryAudioTrack() !== null`), stopping at
  the first with an audio track; a source whose container cannot be read counts as sounded, with
  one `console.warn` naming it. Headers, never a decode: milliseconds and no memory per source,
  where `decodeAudioData` of a ten-minute source would be a full decode and ~230 MB. That is what
  makes the headless rule exact where the dialog's is deliberately approximate — a video-only
  source (every kit fixture, `examples/clip.mp4`) renders mp4 as before with `audio: false`, and
  the 64x8 case still reaches the exporter's `OUTPUT_SIZE_UNSUPPORTED`. The helper lives in
  `headless/` because only this entry asks: the dialog can show a note, and the exporters decode
  the mix anyway. The message: "This Chromium has
  no AAC encoder, so an mp4 render would have no sound. Render webm, or set options.allowSilentMp4
  to render the picture alone." The code crosses the Playwright boundary as data exactly as
  `OUTPUT_SIZE_UNSUPPORTED` does, and the kit maps it to exit 2 / 400. Each question is asked
  only after the cheaper ones say a refusal is still possible — format, opt-out, candidates, AAC,
  then headers — so the header probe never runs when AAC exists, nor for webm or gif.
  `options.allowSilentMp4?: boolean` (`RenderInput['options']`, so the kit's `JobSpec` too) skips
  the refusal and renders the picture alone with `audio: false`; it is destructured out of the
  options before the spread, so the exporter never sees it. A project with no candidates —
  images, overlays, every track muted or hidden — renders mp4 as before with `audio: false`, without
  any probe. WebM and GIF are never
  refused by this rule. The editor's own export is unchanged: it still offers a silent MP4 with a
  note, because a person is there to read it.
- **`options.timeRange` is clamped to the timeline before the exporter ever sees it**
  (ESCSUITE-191, hunt-j J-9): `render()` clamps `{start, end}` to `[0, timelineDuration]`
  — an `end` past the timeline is pulled in to it, a negative `start` is floored at
  0 — and replaces `options.timeRange` with the clamped pair in place, so the
  `exportToMP4`/`exportToWebM`/`exportToGIF` call below it — and so the frame count the
  `durationSec` is derived from — covers the clamped range, never the caller's raw request. Before this, a
  one-second project asked for `{start: 0, end: 600}` encoded roughly 599 seconds of
  black and the signed verification manifest reported `durationSec: 600` for it — the
  manifest describing the request rather than the bytes. A range whose clamped
  intersection with the timeline is empty (both bounds past the end, or both before 0)
  throws rather than rendering zero frames or the un-clamped request. The kit's own
  `jobSpec.ts` additionally refuses a non-finite or negative bound while parsing, before
  any of this runs (see `services/headless-artist/README.md` §options).
- **A GIF's `meta.durationSec` is its frame delays, not its range.** `options.fps`
  (`10 | 15 | 20`, GIF only, default 15 through `gifFrameRate`) feeds the encoder's
  `ceil(seconds x rate)` frames, and a GIF plays for as long as the delays it **stores** say.
  There are two roundings, not one: `exportGIF.ts` asks the writer for `round(1000 / rate)` ms
  and `gifenc` writes `round(that / 10)` **centiseconds**, so 15 fps asks for 67 ms and stores
  70 — a one-second range is 15 x 70 ms = **1.05 s**, and a "15 fps" GIF really plays at about
  14.3. `gifFrameDelayMs(fps)` in `core/exportTypes.ts` (re-exported through `core/exporter.ts`)
  is the one home for that rule; `headless/renderProject.ts` multiplies it by the frame count and
  nothing re-derives it. 10 fps (100 ms) and 20 fps (50 ms) survive both roundings exactly, so
  `durationSec` is the range rounded up to a whole frame rather than up to a whole frame *and* a
  coarser delay — not the range itself unless `seconds x rate` happens to be a whole number (a
  1.03 s range at 20 fps is `ceil(20.6) = 21` frames x 50 ms = **1.05**). The verification manifest describes the bytes — the kit README tells
  callers to compare `durationSec` against `ffprobe` — so the headless path reports that rather
  than the requested range.
  `exportGIF.ts`'s own `addFrame` argument stays the first rounding (67 ms at 15 fps): `gifenc`
  does the second one, and `gifEncoder.test.ts` decodes the Graphic Control Extension to pin it.
- **Every format's `meta.durationSec` is the encoded length — frames encoded x one frame
  period** (ESCSUITE-238). The two video formats are no exception to the GIF rule above: they
  encode whole frames at `VIDEO_EXPORT_FRAME_RATE` (30, in `core/exportTypes.ts`, the one constant
  both video exporters step by), `ceil(range x 30)` of them, so a 0.75 s range is 23 frames and
  **0.766667 s** of file — what `ffprobe -count_frames` measures. Before this ticket the headless
  path reported the range itself, 0.75, for MP4 and WebM, and a consumer checking `durationSec`
  against the file within a millisecond rejected a valid render. The count is not recomputed in
  `headless/renderProject.ts`: every exporter returns it on `ExportResult.framesEncoded` (its own
  frame loop's `frameCount`, set on the success path of all three), and `encodedDurationSec` there
  multiplies it by `1 / VIDEO_EXPORT_FRAME_RATE` or by `gifFrameDelayMs(fps)`. The field is
  required rather than optional so no reader of it has a fallback arm or a `NaN` to guard.
  **It is the video length.** A consumer may compare it with the file's video stream (counted
  frames x 1/30, or the stream's own duration) within one millisecond, but not with the
  container's `format.duration`: the mix is sliced to exactly the range, and the audio encoders
  write whole frames — AAC 1024 samples (21.3 ms at 48 kHz), Opus 20 ms — so the padded last audio
  frame ends a few milliseconds after the last video frame (a 1 s MP4 with sound: 30 video frames,
  `durationSec` 1, container about 1.0027 s).
- Verified in real Chromium by `apps/e2e/tests/headless/render-bundle.spec.ts`
  (builds the bundle itself in `beforeAll`).
- Design and plans: `docs/superpowers/specs/2026-06-07-headless-artist-design.md`.
- `services/headless-artist` is the packaged CLI + kit that drives this bundle outside the
  browser — one-shot Node process, Playwright-launched Chromium, job JSON in, rendered file
  out. It builds this same `dist-headless/headless.html` (via `pnpm --filter=@escapesuite/artist
  run build:headless`) and calls `__renderProjectToFile` through the file input, never
  `__renderProject`'s base64 path — see `services/headless-artist/README.md` for the job spec,
  sinks, and how to build/pack the kit. Its `.veditor` bundle loader (`loaders.ts`'s
  `loadBundle`, which reads v1 JSON and, since ESCSUITE-260, the v2 container by ranged copies)
  forwards each `videos[]` entry's optional `meta` — the same object
  `projectManager.ts`'s `saveProject` writes — into that source's `SourceVideoInput`, ahead of
  anything `seedSources` would otherwise probe from the bytes (ESCSUITE-150). Without it, an
  ESCAPECRAFT audio-only take (microphone alone, screen and webcam both off) — typed
  `video/webm;codecs=vp9,opus` even though it has no picture, with `meta.mediaType: 'audio'` the
  only thing that says so — would have both exporters build a frame source over a file with
  nothing to show, disagreeing with the editor loading the same file. `MIME_TO_EXTENSION` also
  strips a `;codecs=...` parameter before naming that source's temp file and now knows
  `audio/webm`, so either MIME type still lands on a `.webm` temp file rather than `.bin` or a
  mismatched extension, and that lookup now lower-cases the MIME type first, so `Video/WebM`
  resolves the same way. `loadManifest`'s `ManifestSource` gained the same optional `meta`
  (ESCSUITE-158, a follow-up from the ESCSUITE-150 review): a manifest had no way to say a
  referenced file is audio-only, since its `width`/`height`/`duration` fields have no
  `mediaType` equivalent, so such a source was re-derived as video exactly as a bundle one used
  to be. Both loaders validate `meta` with the one shared `assertSourceMeta` — an unrecognised
  `mediaType` or a non-finite/negative `width`/`height`/non-positive `duration` is rejected
  before Chromium launches — so a malformed `meta` fails identically whichever loader it came
  through.
