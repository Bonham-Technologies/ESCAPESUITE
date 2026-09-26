---
'@escapesuite/artist': patch
---

**The timeline waveform is drawn at the clip box's own height, no longer squashed by 4 px.** An
audio waveform on a timeline clip was being drawn into a canvas four pixels taller than the box
it appears in, and the browser then scaled that picture down to fit — so on a standard 60 px
track a 56 px waveform was squeezed into 52 px. Every peak was about 7% shorter than it should
have been and the whole shape came out slightly soft. The waveform is now drawn at exactly the
height it is shown at, so the peaks are the height of the sound and the picture is crisp.

Nothing about the waveform's colours, position or data changed, and a track dragged shorter than
a clip's minimum height keeps a readable waveform instead of a stretched one.
