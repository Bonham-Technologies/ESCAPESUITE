---
'@escapesuite/craft': patch
---

A webcam track whose thumbnail could not be saved is no longer reported as lost

A webcam track whose thumbnail could not be written is still listed in the library (with the placeholder tile) and still deleted with its take, instead of being reported as lost while its bytes stayed in storage.
