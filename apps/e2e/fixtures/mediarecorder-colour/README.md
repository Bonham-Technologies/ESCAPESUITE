# MediaRecorder colour fixtures

Used by `tests/regressions/ESCSUITE-504.spec.ts`. Each is three seconds of eight solid colour
patches drawn on a 640x360 canvas, recorded through `canvas.captureStream(30)` by the browser's own
`MediaRecorder` (the spec's `recordPatches` made them, on 2026-11-23, in Playwright's headless
builds on Linux). The patches, left to right and top to bottom: (228,61,99), (40,180,80),
(50,90,200), (220,200,40), (150,60,180), (40,190,200), (128,128,128), (200,120,60).

| File | What it is |
|------|------------|
| `firefox-159-vp8.webm` | Firefox 159, `video/webm;codecs=vp8` (its MediaRecorder records no VP9). No Cues, no Colour element. 4.3 KB. |
| `chromium-159-vp9.webm` | Chromium 159, `video/webm;codecs=vp9`. BT.709 full range in its key frame headers (`color_space` 2, `color_range` 1) and its Colour element (matrix 1, range 2, transfer 13, primaries 1), and a Cues index, which the spec empties in place so the import repairs it. 9.3 KB. |

To remake one, run the spec's fresh-recording case in that browser: it writes `recording.webm`
(as made) into its test output folder.
