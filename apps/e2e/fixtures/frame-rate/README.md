# Frame-rate fixtures

Used by `tests/escapeartist/frame-rate-probe.spec.ts` (ESCSUITE-277), which pins ESCSUITE-276's import-time frame-rate probe (`apps/artist/src/core/frameRateProbe.ts`) in a real browser.

Every file is 2 s of ffmpeg's `testsrc` at 160x120, no audio. `node make-fixtures.mjs` regenerates all nine (needs `ffmpeg` on PATH; the committed files were made with ffmpeg 9.0.1). The whole folder, generator and this README included, is 112 KB (`du -sh`).

`ffprobe` column: `ffprobe -v error -select_streams v -show_entries stream=r_frame_rate,nb_frames -of csv=p=0 <file>` (for the WebMs, which carry no frame count, `-count_frames` and `nb_read_frames` instead).

| File | What it is | Made with | ffprobe |
|------|------------|-----------|---------|
| `testsrc-24fps.mp4` | H.264, 24 fps | `ffmpeg -f lavfi -i testsrc=s=160x120:r=24:d=2 -r 24 -c:v libx264 -pix_fmt yuv420p -crf 30 -an testsrc-24fps.mp4` | `24/1,48` |
| `testsrc-30fps.mp4` | H.264, 30 fps | the same with `r=30`, `-r 30` | `30/1,60` |
| `testsrc-60fps.mp4` | H.264, 60 fps | the same with `r=60`, `-r 60` | `60/1,120` |
| `testsrc-120fps.mp4` | H.264, 120 fps | the same with `r=120`, `-r 120` | `120/1,240` |
| `testsrc-29.97fps.mp4` | H.264, 30000/1001 fps | the same with `r=30000/1001`, `-r 30000/1001` | `30000/1001,60` |
| `testsrc-24fps.webm` | VP9, 24 fps | `ffmpeg -f lavfi -i testsrc=s=160x120:r=24:d=2 -r 24 -c:v libvpx-vp9 -pix_fmt yuv420p -crf 40 -b:v 0 -an testsrc-24fps.webm` | `24/1,48` |
| `testsrc-30fps.webm` | VP9, 30 fps | the same with `r=30`, `-r 30` | `30/1,60` |
| `testsrc-60fps.webm` | VP9, 60 fps | the same with `r=60`, `-r 60` | `60/1,120` |
| `testsrc-120fps.webm` | VP9, 120 fps | the same with `r=120`, `-r 120` | `120/1,240` |

A WebM stamps frames in whole milliseconds, so the probe cannot tell a rate from its NTSC neighbour (30 from 29.97, and so on) over eight frames; the spec accepts either for the WebMs and only the exact rate for the MP4s. The 120 fps WebM may also come back refused as 30 `'assumed'` on a busy machine (ESCSUITE-333), which the spec accepts; any other rate is a failure.
