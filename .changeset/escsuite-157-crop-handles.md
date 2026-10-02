---
'@escapesuite/artist': minor
---

Crop a clip on the canvas, not just in the inspector

Press "Crop on canvas" in the clip inspector's Crop section and the preview
shows the whole of the clip's source dimmed, with the part you are keeping
bright and eight handles on its corners and edges. Drag one and the picture
crops from that side while the other edges stay exactly where they are (on a
clip whose position or scale is animated, the picture shrinks about its centre
instead, so the keyframes stay in charge); hold
Shift to keep the shape you already had. The handles are real buttons, so Tab
reaches them, the arrow keys move one pixel of the source at a time (ten with
Shift), and every nudge is read out. Escape leaves crop mode, and so does
selecting another clip. On a locked track you can still look, and the handles
say so by greying out. The frame sits on the picture even mid-transition,
where a clip with a slide or pop Animate Out preset is drawn somewhere other
than its preset says.
