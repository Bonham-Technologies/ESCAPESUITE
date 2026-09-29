---
'@escapesuite/artist': patch
---

A transition's incoming clip now animates against the same clip time as the frame it is drawn onto, instead of a negative one.

ESCSUITE-133: when a transition's incoming clip starts at or after the outgoing clip's end — the ordinary case for two clips placed back to back on one track — its animated opacity, transform and blur were evaluated at a negative clip time for the whole transition, while the frame drawn underneath them was already clamped to the clip's own first frame. The two renderers (and the preview, which shares them) now clamp the animated state to the same clip time as the frame, so both halves of the draw agree on which instant of the incoming clip they are showing.
