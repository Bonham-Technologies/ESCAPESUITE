# Seek-wedge fixture

Used by `tests/regressions/ESCSUITE-412.spec.ts`. 227 KB.

| File | What it is |
|------|------------|
| `craft-take-shared-key-timestamp.webm` | A real ESCAPECRAFT WebCodecs take: the one the record → edit → export journey recorded in CI run 41122168065 (2026-10-30), taken byte for byte from that run's trace. 2.92 s, VP9 640x360 at 30 fps plus Opus, from the suite's synthetic screen and microphone. Written by Mediabunny 1.62.1. |

What is wrong with it: the key frame at 2.033 s has the same block timecode as the delta frame just
before it (`ffprobe -select_streams v -show_entries packet=pts_time,flags -of csv` lists
`2.033000,___` then `2.033000,K__`). ESCAPECRAFT declares 30 fps to Mediabunny's
`addVideoTrack`, which snaps every timestamp to that grid, so two frames captured inside one 33 ms
slot land on one timecode. Mediabunny will not start a Cluster at a timecode the current Cluster
already holds, so that key frame sits in the middle of the Cluster that starts at 1.02 s,
with no cue. Chromium (153 locally, 156 in CI) then never finishes a seek to any
time from 2.067 s on: no `seeked`, `seeking` stays true, `readyState` stays 1. A fresh `<video>`
over the same bytes does the same. A fresh `<video>` over the same packets, copied through
Mediabunny again with that key frame moved 1 ms later, seeks every frame.

It cannot be regenerated: it is one take whose frame timing happened to collide on a key frame
(ESCSUITE-412 measured 1 of 5 local journey runs, and 0 of 12 bare takes). New takes cannot:
since ESCSUITE-417 the recorder gives every frame a 30 fps slot of its own
(`apps/craft/src/core/frameTiming.ts`), and `tests/regressions/ESCSUITE-417.spec.ts` forces this
collision on a real take every second. Takes recorded before that still exist, which is what
ARTIST's reload from a remux is for.
