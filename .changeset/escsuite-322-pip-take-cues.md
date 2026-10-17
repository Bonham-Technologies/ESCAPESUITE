---
'@escapesuite/craft': patch
---

A screen-plus-webcam recording now carries a real seek index

A screen-plus-webcam recording saved by ESCAPECRAFT now carries a real seek index, so Firefox and other players can scrub it and ESCAPEARTIST on Firefox can export it. Before this, the repair ESCAPECRAFT runs over such a recording when it saves it wrote an empty index, because Chrome stores that kind of recording's frames in a form the repair did not look at; Chrome could still scrub it, Firefox could not. The same applies to any recording made through the browser's own recorder. Recordings saved before this need to be re-recorded or re-imported through ESCAPEARTIST's fix.
