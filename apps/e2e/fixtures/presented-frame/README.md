# Presented-frame fixture

Used by `tests/regressions/ESCSUITE-454.spec.ts` (`frame-barcode.webm`, about 48 KB) and
`tests/regressions/ESCSUITE-495.spec.ts` (`frame-barcode-30fps.webm`, about 32 KB), through `utils/frameBarcode.ts`.

| File | What it is | Made with |
|------|------------|-----------|
| `frame-barcode.webm` | 5 s, 50 fps, 640x360 VP8, no audio, a key frame every 50 frames. Each frame shows its own index (0-249) as an 8-bit barcode: eight full-height stripes, stripe k from the left white when bit k of the index is set, black when not. A frame read back from anything made from it names the source frame it came from, whatever the codec noise. 50 fps puts every frame start on a whole millisecond, which is all a WebM timecode can hold. | `ffmpeg -f lavfi -i "nullsrc=s=640x360:r=50:d=5,format=yuv420p,geq=lum='16+219*mod(floor(N/pow(2,floor(X*8/W))),2)':cb=128:cr=128" -c:v libvpx -b:v 1M -g 50 -an frame-barcode.webm` (ffmpeg 6.1.1) |
| `frame-barcode-30fps.webm` | The same barcode, 5 s at 30 fps (frames 0-149), a key frame every 30 frames. At 30 fps a frame starts every 33.33 ms, and the WebM timecode rounds each start to the nearest millisecond: frames 2, 5, 8, … are stored a third of a millisecond after their nominal start (66.67 ms is stored as 67 ms), which is what ESCSUITE-495 needs. | `ffmpeg -f lavfi -i "nullsrc=s=640x360:r=30:d=5,format=yuv420p,geq=lum='16+219*mod(floor(N/pow(2,floor(X*8/W))),2)':cb=128:cr=128" -c:v libvpx -b:v 1M -g 30 -an frame-barcode-30fps.webm` (ffmpeg 6.1.1) |
