# Zoom-region fixture

Used by `tests/regressions/ESCSUITE-475.spec.ts`. About 34 KB.

| File | What it is | Made with |
|------|------------|-----------|
| `quadrants.webm` | 6 s, 30 fps, 640x360 VP8, no audio. Four flat colours, one per quarter of the frame: red top left, green top right, blue bottom left, white bottom right. A zoomed frame read back from an export says which part of the source fills it, and where its borders landed. | `ffmpeg -f lavfi -i "color=c=0xFF0000:s=320x180:r=30:d=6" -f lavfi -i "color=c=0x00FF00:s=320x180:r=30:d=6" -f lavfi -i "color=c=0x0000FF:s=320x180:r=30:d=6" -f lavfi -i "color=c=0xFFFFFF:s=320x180:r=30:d=6" -filter_complex "[0][1]hstack[top];[2][3]hstack[bottom];[top][bottom]vstack,format=yuv420p" -c:v libvpx -b:v 200k -g 30 -an quadrants.webm` (ffmpeg 6.1.1) |
