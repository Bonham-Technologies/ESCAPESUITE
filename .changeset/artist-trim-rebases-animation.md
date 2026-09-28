---
'@escapesuite/artist': patch
---

Trimming a clip on the timeline no longer leaves keyframes past its new end, and no longer lets a fade-out preset start before the clip does

Shortening a clip from either handle used to touch nothing about its animation: a keyframe past the new end sat there as dead weight (still listed in the keyframe panel, never played), and a preset longer than the trimmed clip could make the out-preset compute a negative start time — the clip opened already part-faded, and the keyframe panel plotted that keyframe off the left edge. A trim now rebases the clip's animation onto its new, shorter duration with the same arithmetic the Split tool already uses to divide a clip in two: a keyframe past the new end is dropped and replaced with one synthesised at the cut holding the value the animation already had there, a keyframe removed from the front is shifted back so the clip's own timeline still starts at 0, and each of the in/out presets' own duration is capped to whatever the inspector's sliders would allow for the clip's new length. Lengthening a clip back out is unaffected — nothing about its animation changes.
