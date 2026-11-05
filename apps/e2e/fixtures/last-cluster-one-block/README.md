# Last-Cluster-holds-one-block fixture

Used by `tests/regressions/ESCSUITE-395.spec.ts`. `node make-fixture.mjs` regenerates it (needs
`ffmpeg` with libopus on PATH; the committed file was made with ffmpeg 6.1.1). About 13 KB.

| File | What it is |
|------|------------|
| `mic-take-last-cluster-one-block.webm` | 151 Opus packets of a 440 Hz tone, mono 48 kHz, one every 20 ms from 0 to 3000 ms, laid out like a MediaRecorder microphone take: unknown-size Segment and Clusters, no Duration, no Cues, no SeekHead. A Cluster starts every 1000 ms, so the last one, at 3000 ms, holds a single block. |

What is wrong with it: nothing, until `webm-duration-fix` repairs it. The library takes the last
frame's length from the gap between the last two blocks (0 − 980 ms here, because the one before
the last is in the previous Cluster), so it writes a Duration of 2020 ms for a 3 s take. ESCAPECRAFT's
save now floors the Duration at the last block (3000 ms).
