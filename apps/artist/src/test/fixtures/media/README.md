# Media fixtures

Real MP4 bytes for the decode worker's demux tests (`src/workers/mp4Demux.test.ts`).
Each is a few kilobytes.

| File | What it is | Made with |
|------|------------|-----------|
| `h264-bframes.mp4` | 1 s, 25 frames, 64x48 solid red, H.264 High with B-frames, one IDR, `moov` after `mdat`, an edit list starting at media time 1024/12800 | a copy of `apps/e2e/fixtures/headless/source.mp4` |
| `h264-faststart.mp4` | the same stream with `moov` before `mdat` | `ffmpeg -i h264-bframes.mp4 -c copy -movflags +faststart h264-faststart.mp4` |
| `h264-rotated.mp4` | 1 s, 30 frames, 320x180 coded (red left half, blue right half), display matrix `[0, -1, 1, 0]` — shown as 180x320 with blue on top | `ffmpeg -display_rotation 90 -i plain.mp4 -c copy h264-rotated.mp4` (ffmpeg's counter-clockwise 90, WebCodecs' clockwise 270) |
| `h264-fragmented.mp4` | the `h264-bframes.mp4` stream as a fragmented MP4 (moof/mdat pairs) — the demuxer refuses it | `ffmpeg -i h264-bframes.mp4 -c copy -movflags frag_keyframe+empty_moov h264-fragmented.mp4` |
| `hevc.mp4` | 0.2 s, 2 frames, 64x48 HEVC tagged `hvc1` — carries an hvcC record | `ffmpeg -f lavfi -i color=c=red:s=64x48:d=0.2:r=10 -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p hevc.mp4` |
| `vp9.mp4` | 0.2 s, 2 frames, 64x48 VP9 in MP4 — no codec record the decoder needs | `ffmpeg -f lavfi -i color=c=red:s=64x48:d=0.2:r=10 -c:v libvpx-vp9 -pix_fmt yuv420p vp9.mp4` |
| `audio-only.mp4` | AAC audio and no video track | an audio-only MP4 |
| `h264-tagged709-480p.mp4` | 2 s, 30 fps, 640x480 H.264, VUI colour description BT.709 primaries, transfer and matrix, limited range | `ffmpeg -f lavfi -i "nullsrc=s=640x480:r=30:d=2,format=yuv444p,geq=lum='16+X*104/W':cb='128+60*sin(floor(N/8))':cr='128+60*cos(floor(N/8)*1.7)'" -c:v libx264 -pix_fmt yuv420p -g 30 -bf 2 -x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709 -colorspace bt709 -color_primaries bt709 -color_trc bt709 h264-tagged709-480p.mp4` |
| `h264-fullrange-480p.mp4` | the same picture with only `video_full_range_flag` set (no colour description) | the same, with `-x264-params fullrange=on -color_range pc` instead of the colour options |
| `h264-colr.mp4` | `h264-tagged709-480p.mp4` with an `nclx` `colr` box in its sample entry | `ffmpeg -i h264-tagged709-480p.mp4 -c copy -movflags +write_colr h264-colr.mp4` |
| `h264-partial-tag.mp4` | 1 s, 160x120 H.264 whose VUI tags the matrix as BT.709 and leaves primaries and transfer unspecified — Chromium's `<video>` draws it with its BT.601 guess | `ffmpeg -f lavfi -i "nullsrc=s=160x120:r=30:d=1,format=yuv444p,geq=…" -c:v libx264 -pix_fmt yuv420p -colorspace bt709 h264-partial-tag.mp4` (the `geq` of the row above) |
