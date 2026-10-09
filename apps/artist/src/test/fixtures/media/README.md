# Media fixtures

Real MP4 bytes for the decode worker's demux tests (`src/workers/mp4Demux.test.ts`).
Each is a few kilobytes.

| File | What it is | Made with |
|------|------------|-----------|
| `h264-bframes.mp4` | 1 s, 25 frames, 64x48 solid red, H.264 High with B-frames, one IDR, `moov` after `mdat`, an edit list starting at media time 1024/12800 | a copy of `apps/e2e/fixtures/headless/source.mp4` |
| `h264-faststart.mp4` | the same stream with `moov` before `mdat` | `ffmpeg -i h264-bframes.mp4 -c copy -movflags +faststart h264-faststart.mp4` |
| `h264-rotated.mp4` | 1 s, 30 frames, 320x180 coded (red left half, blue right half), display matrix `[0, -1, 1, 0]` — shown as 180x320 with blue on top | `ffmpeg -display_rotation 90 -i plain.mp4 -c copy h264-rotated.mp4` (ffmpeg's counter-clockwise 90, WebCodecs' clockwise 270) |
