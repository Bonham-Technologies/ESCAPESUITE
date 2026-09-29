---
"@escapesuite/artist": patch
---

A rotated left- or right-aligned text overlay's selection box, resize handles and click target now stay on the text (ESCSUITE-128)

The renderer rotates a text overlay about its anchor — the point the text is actually drawn from — but left- and right-aligned text is anchored at its edge, not its centre, so the preview's selection box, handles, hit test and marquee (which all shift that box by half the text's width to account for the alignment) were rotating around the box's own centre instead of the same anchor the picture rotates around. The two drifted further apart as the overlay rotated, a full half-width off at 90 degrees, so the blue selection box and its handles floated beside the glyphs and clicking the text no longer selected it. The alignment offset is now rotated along with the box, so the chrome sits on the text at every rotation. Centre-aligned text, whose anchor and centre already coincide, is unaffected.
