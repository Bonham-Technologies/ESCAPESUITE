# Sparse-key-frame fixtures

Used by `tests/regressions/ESCSUITE-359.spec.ts`. `node make-fixtures.mjs` regenerates both (needs
`ffmpeg` on PATH and `pnpm install`; the committed files were made with ffmpeg 6.1.1 and
Mediabunny 1.61.6). About 740 KB together.

| File | What it is |
|------|------------|
| `long-sparse.webm` | 60 s of `testsrc2` at 160x120, 15 fps, VP8, plus a 440 Hz Opus tone. One key frame (0 s) and no Cues (`-live 1`), like a MediaRecorder take. |
| `long-sparse-reindexed-before-359.webm` | The same packets copied through Mediabunny's muxer as the ESCSUITE-305 import re-index did before ESCSUITE-359: a Cluster forced at ~32.8 s that starts on a delta frame, with a video cue on it. What a library row stored between 2026-10-17 and the fix holds. |
