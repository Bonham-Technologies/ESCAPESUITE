---
"@escapesuite/artist": patch
---

An Animate In/Out preset on a short clip now stores a duration the clip can hold (ESCSUITE-125), and the keyframe panel's playhead follows the timeline again after a scrub (ESCSUITE-126)

Choosing an Animate In or Out preset on a clip shorter than 1s used to store the preset's carried-over or default 0.5s duration with no bound, even though the panel's own slider caps a preset's duration at half the clip's length. An Animate Out preset longer than the clip then made the clip open already mid-animation — a fade-out on a 0.4s clip opened at 96% opacity instead of 100%, and a slide-left-out on a 0.2s clip opened 30% off-centre — exactly the picture ESCSUITE-110 had already fixed for a trim, but still reachable by picking a preset directly. The four handlers that write a preset's type or easing now clamp the duration the same way a trim does, and the keyframe generator clamps it too as a second line of defence for an older project file.

The keyframe panel's playhead used to freeze at whatever offset its own scrubber was last dragged to: after one scrub, moving the main timeline (playback, a seek, undo) no longer moved the panel's playhead line, its scrubber, or its readout, and pressing Enter to add a keyframe added it at the stale offset instead of where the timeline actually was. The panel's local "preview time" is gone — the timeline's own current time was always available and is now the only thing the playhead reads.
