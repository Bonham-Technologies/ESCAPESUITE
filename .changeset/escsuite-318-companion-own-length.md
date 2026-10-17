---
'@escapesuite/craft': patch
---

A microphone unplugged mid-recording no longer stretches its track to the whole take

When a screen-plus-webcam recording keeps the microphone (or the system audio) as its own track and that source goes away part-way through — the microphone unplugged, the audio share stopped — its file always stopped there, but ESCAPECRAFT saved it as if it lasted the whole take. The library showed the take's length for it, and ESCAPEARTIST placed a microphone clip as long as the whole recording over the shorter sound. The track is now saved at its own length, so the library shows how long it really is and ESCAPEARTIST places it at that length. Recordings saved before this keep the length they were saved with.
