# Decode worker fixtures

Used by `tests/export/decode-worker.spec.ts` (ESCSUITE-254).

| File | What it is | Made with |
|------|------------|-----------|
| `segments.mp4` | 2 s, 30 fps, 160x120 H.264 High, B-frames, 30-frame GOP, an edit list: a left-to-right luma ramp whose colour changes every 8 frames | `ffmpeg -f lavfi -i "nullsrc=s=160x120:r=30:d=2,format=yuv444p,geq=lum='16+X*1.3':cb='128+60*sin(floor(N/8))':cr='128+60*cos(floor(N/8)*1.7)'" -c:v libx264 -pix_fmt yuv420p -g 30 -bf 2 segments.mp4` |
| `rotated.mp4` | 1 s, 30 fps, 320x180 coded (red left half, blue right half), `tkhd` display matrix `[0, -1, 1, 0]`: played as 180x320, blue on top | a red/blue 320x180 clip, then `ffmpeg -display_rotation 90 -i plain.mp4 -c copy rotated.mp4` |
| `tagged709-480p.mp4` | the `segments.mp4` picture at 640x480, its VUI tagging BT.709 primaries, transfer and matrix — the size-based guess (BT.601 under 720 lines) would be wrong for it | `ffmpeg -f lavfi -i "nullsrc=s=640x480:r=30:d=2,format=yuv444p,geq=lum='16+X*104/W':cb='128+60*sin(floor(N/8))':cr='128+60*cos(floor(N/8)*1.7)'" -c:v libx264 -pix_fmt yuv420p -g 30 -bf 2 -x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709 -colorspace bt709 -color_primaries bt709 -color_trc bt709 tagged709-480p.mp4` |
| `fullrange-480p.mp4` | the same picture with only `video_full_range_flag` set | the same, with `-x264-params fullrange=on -color_range pc` instead of the colour options |
