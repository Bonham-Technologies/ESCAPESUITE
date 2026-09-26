---
'@escapesuite/artist': patch
---

**An audio waveform on a timeline clip is no longer cut off at the bottom.** The waveform was
being drawn a few pixels taller than the clip it sits in, and a clip hides anything that
overflows it — so the bottom of the waveform was cropped away and what was left sat slightly
low in the clip, its quiet middle line a touch below centre. On a standard track it was five
pixels too tall. The waveform is now drawn at exactly the height of the clip, so the whole
shape is visible and it is centred where it should be.

Nothing about the waveform's colours, position or data changed, and a track dragged shorter
than a clip's minimum height keeps a waveform that still fills the clip.
