<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# WebM Export Reliability (`src/core/exportWebM.ts`, `src/core/exportTypes.ts`)

ESCSUITE-29 Mechanism 1 closed the error-tracking asymmetry the paragraph above used to describe:
a VP9 encoder error used to be only `console.error`-ed, where MP4 tracked `videoEncoderError` and
checked it every frame, and the exporter never probed a codec at all — `videoEncoder.configure()`
was called with a hard-coded `'vp09.00.10.08'`, with no `isConfigSupported()` call anywhere in the
file and no fallback. WebM's shape now matches MP4's:

- **Codec ladder, shared with MP4's.** `exportTypes.ts`'s `findSupportedVideoConfig()` — try each
  `VideoEncoderConfig` in order, skip one whose probe throws, return the first one
  `VideoEncoder.isConfigSupported()` answers `supported: true` for — is the one function both
  ladders walk: `exportMP4.ts`'s ten-entry H.264 ladder (five profiles × two
  hardware-acceleration passes) and `exportWebM.ts`'s two-entry one, `webMVideoCodecConfigs()`:
  VP9 (`vp09.00.10.08`) first, VP8 as the fallback every Matroska-capable browser still has. The
  probe and the real `configure()` call ask about the **same** configuration — width, height,
  bitrate, framerate, all the export's own — so there is no gap between what was asked and what
  gets encoded. Neither VP9 nor VP8 supported throws an `ExportError` before any encoder is
  constructed at all, not partway through building one. It returns `{ config, candidate }`
  (review round 1, MINOR 3) rather than `config` alone: `config` is what `.configure()` is called
  with — the browser's own normalised answer when it offers one — and `candidate` is the exact
  entry from the input list that was found supported, never touched by the browser. A caller that
  needs to know *which* configuration it asked about — `exportWebM.ts` labelling its muxer track
  `'vp9'` or `'vp8'` — reads `candidate`, because nothing guarantees `config.codec` still looks
  like the string that was asked about once a browser has normalised it.
- **Opus, probed independently of video** — through the same `isAudioCodecSupported()` the MP4
  exporter's AAC check calls: no Opus support drops the audio and still produces a working, silent
  WebM, never refuses the export outright. **And it says so** (ESCSUITE-175 fix round): the two
  `console.warn`s this used to hide behind became one `onProgress` report of
  `noAudioNote('webm')`, and the result carries `audio: false` — before that, a browser with VP9
  and no Opus encoder handed back a silent WebM with nothing before, during or after to say so,
  which is the exact defect ESCSUITE-175 fixed on the MP4 side and had left standing here. The
  probe itself stays where it always was, just before the muxer starts, because unlike the MP4
  side there is nothing expensive after it to protect.
- **Firefox 155's VP9 and VP8 encoders mislabel their colour matrix, and the exporter corrects it
  (ESCSUITE-279 found it, ESCSUITE-284 measured and fixed it, 2026-10-11).** Firefox's
  `VideoEncoder` converts a canvas-built `VideoFrame` with the **BT.601** matrix — the encoded YUV
  matches a BT.601 conversion of the drawn RGB within 1.1 code values for VP9 and 2.1 for VP8, where
  BT.709 would be 17.3 out — but reports `decoderConfig.colorSpace` as
  `{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }`. Its own VP9
  keyframe headers say `color_space` 0, "unknown" (a bare encoder probe, at 1920x1080 and 160x120
  alike); the `color_space` 2 ESCSUITE-279 found in an exported file's headers was **mediabunny's**
  write, not Firefox's: mediabunny's `fixVP9ColorSpace` rewrites every VP9 keyframe header's colour
  field from the reported matrix, as well as writing the WebM Colour element from the whole report.
  So one wrong report became two wrong labels, and every player honoured one of them — a Firefox WebM
  read back with colours up to about 25/255 off (a drawn (228,61,99) read (241,80,96)), and a
  nearest-colour match landed on a neighbouring palette entry for 9–10 of 45 frames, which is the
  "10 of 45 frames off by 6–14" the ESCSUITE-265 probe saw. **Frame placement was always exact**: a
  luma-coded fixture reads back 0 of 45 frames misplaced in every reader.

  **Which label each reader trusts** — the same Firefox VP9 export (ESCSUITE-279's `percolour.mp4`
  fixture, 1920x1080, 45 frames), each label patched by hand to BT.601 (Colour element matrix 6;
  keyframe header `color_space` 3, SMPTE 170M), each variant read back against the RGB the exporter
  drew. Mean / max absolute channel difference, out of 255, then frames a nearest-colour match
  misreads:

  | Variant | ffmpeg 9 | Chromium 153 `<video>` | Firefox 155 `<video>` |
  |---|---|---|---|
  | As exported (both BT.709) | 5.68 / 25, 10 of 45 | 5.49 / 25, 9 of 45 | 5.49 / 25, 9 of 45 |
  | Colour element only (6 / 6 / 6) | 5.68 / 25, 10 of 45 | **0.92 / 3, 0** | 5.49 / 25, 9 of 45 |
  | Keyframe header only (3) | **0.81 / 2, 0** | 5.49 / 25, 9 of 45 | **0.92 / 3, 0** |
  | Both (6 / 6 / 6 and 3) | **0.81 / 2, 0** | **0.92 / 3, 0** | **0.92 / 3, 0** |
  | Both, matrix only (6 / 1 / 1 and 3) | **0.81 / 2, 0** | **0.92 / 3, 0** | **0.92 / 3, 0** |

  Chromium reads the container; Firefox and ffmpeg read the VP9 header (ffmpeg's decoder takes the
  matrix from the bitstream and only primaries and transfer from the container). Primaries and
  transfer made no measurable difference in any reader. **VP8** (the ladder forced to VP8 in Firefox,
  the same fixture): the same BT.601 pixels under the same BT.709 report; VP8's keyframe header has no
  matrix field and Firefox and ffmpeg decode VP8 as BT.601 whatever the container says (1.2 / 5 and
  1.11 / 4 as exported), so only Chromium misread it (5.49 / 25), and a corrected Colour element alone
  fixes it (1.2 / 5). Chromium's own encoders are the control: they convert and label BT.709 full
  range consistently.

  **The fix** is the smallest one the table allows. `exportWebM.ts`'s video `output:` callback hands
  the muxer `relabelFirefoxVpxMeta(meta)` (`core/vpxColorLabel.ts`) in place of the encoder's own
  metadata, on Firefox only — `isFirefoxEngine` in `core/workerDecodeEngine.ts`, the same `Gecko/` and
  `Firefox/` test the decode worker's allow-list uses, decided once per export. The helper changes
  only the matrix, `'bt709'` → `'smpte170m'`, and only when the report is **exactly** the one Firefox
  155 was measured giving every time, for VP9 and VP8 at every size probed: `primaries`, `transfer`
  and `matrix` all `'bt709'` and `fullRange` `false` (review M1 narrowed it from the matrix alone).
  Any other report passes through by reference. Primaries, transfer and range stay as reported,
  because Firefox converted sRGB pixels with the BT.601 *matrix*, not into BT.601 primaries. Mediabunny then writes Colour matrix 6 and, for VP9, header
  `color_space` 3 on every keyframe — no keyframe-byte patching of our own. A Firefox export from the
  patched exporter is byte-identical to the hand-patched "both, matrix only" row (VP9) and to its VP8
  twin, and reads back at 0.81–0.92 / 3 in all three readers (VP8 1.11–1.2 / 5), 0 of 45 misread.
  `vpxColorLabel.test.ts` runs the **real** mediabunny muxer over Firefox keyframe bytes and pins both
  writes, so a mediabunny upgrade that stopped rewriting the VP9 header turns red rather than
  silently re-breaking Firefox and ffmpeg. No per-frame work: delta chunks carry no decoder
  configuration and pass through by reference, and `exportWebM.perf.test.ts` is unchanged.

  **Limits.** The gate is the measured engine and the measured report, all four fields of it. A
  Firefox that fixes its encoder and changes its report — converting with BT.709 and reporting sRGB
  transfer at full range the way Chromium does, or reporting the BT.601 matrix it uses — falls out of
  the gate on its own and passes through untouched. One that fixes the *pixels* but keeps this
  identical report would be mislabelled the other way, its colours shifted by the same ~25/255 in the
  opposite direction, with nothing in CI to notice (CI's e2e runs Chromium only); that residual risk,
  and retiring the gate, are **ESCSUITE-288**, the upstream report against Firefox's WebCodecs
  encoder. Upstream the canonical bug is https://bugzilla.mozilla.org/show_bug.cgi?id=2057760 (our
  own report, 2081037, filed 2026-10-12, was closed as its duplicate within hours). It weighs the two
  fixes we identified: change the report to `smpte170m`, in which case the gate falls out on its own;
  or convert with BT.709 and keep the report, in which case the pixels change under an identical
  report and the gate must be removed or version-capped **before** that Firefox reaches release,
  because CI runs Chromium only and would not notice. When 2057760 lands, read which shipped, re-run
  the probe below, and retire or cap the gate accordingly.
  Every measurement here was on **macOS**, with Playwright's Firefox 155 build: Firefox on
  Linux, Windows and Android passes the `Gecko/` + `Firefox/` gate **unmeasured** (Android may hand
  VP8/VP9 to a platform encoder that converts or reports differently).
  WebKit's WebM colour has not been measured and is left alone. Firefox's H.264 (MP4) encoder
  converts and labels BT.709 consistently and needs nothing. The headless kit renders in Chromium and
  is unaffected.
- **Encoder error tracking.** The video encoder's `error:` callback now stores the exception in
  `videoEncoderError`, checked at the top of every frame iteration and inside the backpressure
  wait, exactly where MP4 checks its own; the audio encoder's `error:` callback does the same,
  checked once more before finalising.
- **Backpressure timeout, factored into one `waitForEncoderBackpressure()` (`exportTypes.ts`)
  both exporters call** — not copied inline a second time, and (review round 1, MINOR 1) not left
  as a third copy either: `exportMP4.ts`'s own inline loop was replaced with the same call,
  `threshold: 5` where WebM passes `threshold: 20`, everything else identical — same mid-wait
  error check, same 30-second stuck-encoder timeout, same `ExportError` message. `now`/`sleep` are
  injectable parameters so both the timeout and the error-during-wait paths are direct unit tests
  rather than needing a real encoder double to actually stall for 30 real seconds; MP4's own
  twelve codec tests and both export `*.perf.test.ts` files are unchanged by the refactor, since
  nothing about what gets called or logged differs from the loop they replaced.
- **`ExportError` and `ExportLogEntry` moved to `exportTypes.ts`** (both exporters import them from
  there now; `exportMP4.ts` re-exports them so every existing `from './exportMP4'` import keeps
  working) so `exportWebM.ts` can throw the same diagnosed-failure shape — message, structured
  log, frame index, total frames — without importing the MP4 module just for its error class. A
  WebM failure that is not already an `ExportError` or an `ExportAbortedError` is wrapped in one
  on the way out, the same catch-all `exportMP4.ts`'s own catch block has always done.
