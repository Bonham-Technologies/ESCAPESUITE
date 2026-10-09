# Decode worker fixtures

Used by `tests/export/decode-worker.spec.ts` (ESCSUITE-254).

| File | What it is | Made with |
|------|------------|-----------|
| `segments.mp4` | 2 s, 30 fps, 160x120 H.264 High, B-frames, 30-frame GOP, an edit list: a left-to-right luma ramp whose colour changes every 8 frames | `ffmpeg -f lavfi -i "nullsrc=s=160x120:r=30:d=2,format=yuv444p,geq=lum='16+X*1.3':cb='128+60*sin(floor(N/8))':cr='128+60*cos(floor(N/8)*1.7)'" -c:v libx264 -pix_fmt yuv420p -g 30 -bf 2 segments.mp4` |
| `rotated.mp4` | 1 s, 30 fps, 320x180 coded (red left half, blue right half), `tkhd` display matrix `[0, -1, 1, 0]`: played as 180x320, blue on top | a red/blue 320x180 clip, then `ffmpeg -display_rotation 90 -i plain.mp4 -c copy rotated.mp4` |
