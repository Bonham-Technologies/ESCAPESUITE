<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# ESCAPEARTIST (apps/artist)
- Zustand store in `src/store/projectStore.ts`
- Core modules in `src/core/`: `storage.ts`, `videoProcessor.ts`, `exporter.ts`, `projectManager.ts`, `videoDecodeManager.ts`, `frameSource.ts`
- Video decode worker in `src/workers/decodeWorker.ts` for background-capable MP4 exports
- Keyframe animation system in `src/utils/animation.ts`
- Static per-clip picture properties in `src/core/`: `clipMask.ts` (a circle or rounded mask and its stroke) and `clipCrop.ts` (a crop — four insets as fractions of the source frame, set from the inspector or, since ESCSUITE-157, by dragging eight handles in the preview's crop mode). Never keyframed, media clips only, and read by the preview, both exporters, both transition paths and the headless bundle from the same two draw functions; a crop also resizes the clip's rectangle, so the selection box, hit test, marquee and drag seed read it too
- Audio waveform visualization in `src/utils/waveform.ts`
- WebCodecs API for encoding/decoding. No longer Chrome/Edge only: Firefox 155 and WebKit 26.6
  both expose `VideoEncoder`, and both encode H.264, VP9 and VP8 — but Firefox has **no AAC
  encoder**, so an MP4 exported there has no sound (ESCSUITE-175 made the dialog and the
  exporter say so, before and after, instead of handing back a silent file; a browser with no
  Opus encoder gets the same treatment for WebM). Measured 2026-10-02; see the Key Constraints
  bullet below

  exporter say so, before and after, instead of handing back a silent file). Measured
  2026-10-02; see the Key Constraints bullet below

- Export formats: WebM (VP9+Opus), MP4 (H.264+AAC) and GIF (`gifenc`, 256 colours per frame, no
  audio, no WebCodecs — 10/15/20 fps, 720p/480p/360p; see `apps/artist/CLAUDE.md`'s "GIF Export")
- Background tab export: MP4 exports run at full speed even in background tabs via Web Worker
  (ESCSUITE-254: before this, the worker threw on every source and the export silently decoded in
  the page). Only in **Chromium and Firefox** — an allow-list (`core/workerDecodeEngine.ts`) of the
  engines whose worker output was measured against their own `<video>` (Chromium: export MAD
  0.000/255 at every compared frame across untagged, BT.709-tagged, full-range, matrix-only,
  `colr`-only and trimmed sources; Firefox: 0.000–0.379 on the same sources, rotated sources
  refused to `<video>` — both since ESCSUITE-265, below); WebKit is not admitted (ESCSUITE-285:
  its `VideoDecoder` ignores `colorSpace`, 6.5–8.0/255 mean off its own `<video>` as ESCSUITE-262
  measured, and the fix would be a per-frame copy — it keeps the in-page path), and nor is any
  engine not yet measured. H.264 MP4 sources only; a source the worker refuses, or gives up on mid-export, is
  decoded by a `<video>` element instead and the export says "Decoding in the page; keep this tab in
  the foreground" once. Follow-ups: a WebM source still decodes in the page with no such notice
  (ESCSUITE-261); the `<video>` path's own seek-skip within 1/30 s, which repeated about every other frame, is fixed by
  ESCSUITE-263 (half a frame; the parity oracle is re-run for it); and its seek to a frame's exact start, which both
  Chromium and Firefox resolved to the previous frame on one start in three (their microsecond rounding), now goes
  0.1 ms past it in the MP4, WebM and GIF element paths alike (`core/elementSeek.ts`, ESCSUITE-265). A worker killed outright, which may never fire `error`,
  is caught by a 15 s main-thread deadline on each frame request (ESCSUITE-266). See `apps/artist/CLAUDE.md`'s

  (ESCSUITE-261); the `<video>` path's own seek-skip within 1/30 s can repeat a frame, and fixing it
  moves the parity oracle (ESCSUITE-263). A worker killed outright, which may never fire `error`,
  is caught by a 15 s main-thread deadline on each frame request (ESCSUITE-266) — 15 s with no sign of
  life on that request, since ESCSUITE-272 the worker posts `FRAME_PROGRESS` on each decoder output
  for the requests waiting on that decoder and the deadline restarts, so a healthy worker still working
  through one hard request is not terminated — and a source load by a size-scaled deadline
  (ESCSUITE-273). See `apps/artist/CLAUDE.md`'s
  "Video Decode Worker"
