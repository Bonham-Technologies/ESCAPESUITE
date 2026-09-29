---
'@escapesuite/artist': patch
---

A hidden track no longer sneaks its audio into an export, and looping playback no longer parks a clip at the wrong source position.

ESCSUITE-127: hiding a track with the eye icon already made the preview silent for it, but the export's audio mixer only checked whether a track was muted or deleted — a hidden track's audio was still mixed into the exported file. The mixer now skips a hidden track's clips the same way it already skips a deleted or muted one, so what you hear in the editor is what ends up in the export.

ESCSUITE-129: when looping playback reached the loop point, every video and audio element was seeked straight to that timeline time — correct only by coincidence for a clip that starts untrimmed at timeline position 0. For a trimmed clip, or one that starts later on the timeline, this parked the element at the wrong spot in its source (or past the end of a shorter source, which the browser clamps to its last frame) for one frame before the playback loop's own repair logic corrected it. The loop-back now only pauses each element and lets that repair logic do the seeking on the next frame, so a loop never touches the wrong position at all.
