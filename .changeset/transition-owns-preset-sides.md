---
'@escapesuite/artist': patch
---

A transition no longer fights the clip's own fade-in or fade-out. A clip with
its own Animate In preset, arriving under a transition, used to be faded (or
scaled, or blurred) twice — so it stayed invisible until the transition was over
and then snapped in; the clip leaving vanished early for the mirror reason. The
transition now owns the entrance of the clip arriving and the exit of the clip
leaving, in the preview and in both export formats. Keyframes you placed
yourself still play, and a preset outside a transition is untouched.
