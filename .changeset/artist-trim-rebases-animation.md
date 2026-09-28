---
'@escapesuite/artist': patch
---

Trimming a clip on the timeline no longer leaves keyframes past its new end, and no longer lets a fade-out preset start before the clip does

Shortening a clip from either handle used to touch nothing about its animation: a keyframe past the new end sat there as dead weight (still listed in the keyframe panel, never played), and a preset longer than the trimmed clip could make the out-preset compute a negative start time — the clip opened already part-faded, and the keyframe panel plotted that keyframe off the left edge. A trim now rebases the clip's animation onto its new, shorter duration with the same arithmetic the Split tool already uses to divide a clip in two: a keyframe past the new end is dropped and replaced with one synthesised at the cut holding the value the animation already had there, a keyframe removed from the front is shifted back so the clip's own timeline still starts at 0, and each of the in/out presets' own duration is capped to whatever the inspector's sliders would allow for the clip's new length (a preset that isn't active is left alone). Lengthening a clip back out is unaffected — nothing about its animation changes.

A same-day fix: dragging a trim handle in past a keyframe and then back out to where it started now restores that keyframe exactly, however many times the pointer changed direction along the way. The rebase always measures from what the clip's animation looked like when the drag began, not from whatever the previous frame of the same drag had already cropped it to — so an overshoot-and-return can no longer lose a keyframe or a preset's authored duration for good.
