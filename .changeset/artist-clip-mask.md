---
'@escapesuite/artist': minor
---

**Any video or image clip can now be masked to a circle or a rounded rectangle, and given a
border.** Select a clip and open the new **Mask & Stroke** section of the inspector: pick a
shape, set how round the corners are, and set the border's width and colour. Both show up
everywhere the clip does — in the preview, in an exported MP4 or WebM, and through a
transition — because they are drawn by the one renderer all of those share.

**A webcam clip handed over from ESCAPECRAFT now arrives with its circle and its white
border.** Before this release, "Record webcam as a separate track" gave you the camera in the
right corner at the right size but as a bare rectangle, so the clip on the timeline did not
look like the recording you had just watched. It does now — and because the shape and the
border are ordinary clip properties, you can change either one, or take them off.

Two details worth knowing. The corner radius is a proportion of the clip rather than a number
of pixels, and the border's width is a proportion of the frame, so changing a project's
resolution keeps a masked clip looking the way you left it instead of quietly restyling it.
And neither can be animated: a mask that changed shape halfway through a clip is not a thing
this release does.

The mask and the border are drawn on the clip's picture only. The selection box and the click
target in the preview stay rectangular; the timeline shows no picture of a clip yet, masked or
otherwise; and the thumbnail in your media library — which belongs to the source file rather
than to any one clip of it — is unmasked.
