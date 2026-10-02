# ESCSUITE-34 — GIF export (v1) — design

**Status:** approved by the operator 2026-10-01 ("all recommended"). Jira: ESCSUITE-34.
**Scope:** ESCAPEARTIST (`apps/artist`) and the headless kit (`services/headless-artist`).

## Goal

A third export format, GIF, for short clips shared in chat tools. It reuses the frame machinery
the WebM exporter already has and swaps the encoder.

## Non-goals (v1)

- Audio (GIF has none).
- Dithering options, global palettes, transparency, looping controls. Per-frame 256-colour
  palettes, no dithering, infinite loop.
- A worker-based encoder (no headless bundling work; low-spec machines stay simple).

## Encoder

`gifenc` (MIT, pure JS, ~10 KB): `GIFEncoder()`, `quantize(rgba, 256)`, `applyPalette(rgba,
palette)`, `writeFrame(index, w, h, { palette, delay })`, `finish()`, `bytes()`. Runs on the main
thread inside the export loop, like the canvas draw does. One new runtime dependency in
`apps/artist/package.json`. The export stays bound to the frame loop, so an abort between frames
stops it (ESCSUITE-98 run identity).

## Pipeline

`core/exportGIF.ts` reuses the WebM exporter's per-frame machinery — the output canvas,
`openOutputFrame`, `syncVideoToTime`, the track-ordered draw loop, transitions — with the encoder
swapped: per frame `ctx.getImageData` → `quantize` → `applyPalette` → `writeFrame(delay = round(1000 / fps))`.
Whatever is shared between `exportWebM.ts` and `exportGIF.ts` is extracted into one helper rather
than copied (frame timing, clip sync, the draw pass); the WebM and MP4 perf ceilings must stay
byte-identical, so the extraction must make the same calls in the same order.

- Reads `timeRange` (the existing in/out points), so "Export Section" works unchanged.
- fps: 10 / 15 / 20 (default 15). Output resolution presets: 720p / 480p / 360p (default 480p);
  the existing `getResolution` rescale path (ESCSUITE-94) applies, with a new `'360p'` preset
  added to the resolution type for GIF only (hidden for WebM/MP4).
- Progress: the same `onProgress` shape (`{ phase, percent, message }`), plus a live size estimate
  (bytes so far ÷ frames done × frames total) shown in the dialog during the export, and a
  heuristic before it starts (pixels × frames × ~0.3 bytes).
- A soft warning above 30 s of range ("GIFs above 30 seconds get large; consider WebM"), never a
  refusal.
- Errors wrap in `ExportError` with the export log, like the other two.

## Dialog

- Format radio "GIF" beside WebM and MP4; selecting it shows the fps control and the GIF
  resolution presets and hides the codec-specific notes; the size estimate line appears.
- `ExportOptions['format']` widens to `'webm' | 'mp4' | 'gif'`; the ESCSUITE-22 support probe
  treats GIF as always supported (no WebCodecs needed), so in a browser without WebCodecs the GIF
  radio is the one enabled format and the no-WebCodecs sentence says so.
- `EXPORT_COMPLETE` posts `format: 'gif'`; file name `${projectName}.gif`.

## Headless kit

- `FORMATS` gains `'gif'`; `RESOLUTIONS` gains `'360p'`; `sinks.ts` extension/MIME maps gain
  `gif` / `image/gif`; `parseOptions` accepts `fps` for GIF (10/15/20, default 15) and rejects it
  for other formats; the job-spec docs and the kit README name the new format. One Chromium parity
  case renders a GIF.

## Tests (red first)

- `core/exportGIF.test.ts` with the existing frame doubles: one `writeFrame` per frame with the
  right delay, `finish` once, the range honoured, abort between frames, `ExportError` on failure.
- `core/exportGIF.perf.test.ts`: one `getImageData`, one quantise, one `writeFrame` per frame,
  balanced save/restore, one `getContext` (ceiling = 2× measured rounded up, dated).
- `ExportDialog.test.tsx`: the radio, fps, presets, the estimate line, the 30 s warning, the
  no-WebCodecs state leaving GIF enabled, `EXPORT_COMPLETE` with `'gif'`.
- `exportWebM.perf.test.ts` / `exportMP4.perf.test.ts` byte-identical after the shared-helper
  extraction.
- Kit: `jobSpec.test.ts` for the new format/fps/360p; a Chromium render case.

## Docs and release

- `apps/artist/CLAUDE.md` export section; root `CLAUDE.md` "Export formats" line; the integration
  protocol comment (`EXPORT_COMPLETE.format`); kit README and job-spec docs.
- Changesets: `@escapesuite/artist` **minor** ("Export a GIF: 10/15/20 fps, 720p/480p/360p, a live
  size estimate, and the section you have in/out points on"), `@escapesuite/headless-artist`
  **minor**.
