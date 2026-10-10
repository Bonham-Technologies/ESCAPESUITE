---
'@escapesuite/artist': patch
---

Importing a file is no longer an undo step

Importing a file is no longer an undo step — undo could remove the file from the library while its bytes stayed in storage with nothing able to reclaim them; use Remove in the media library to take an import out. Undo after a recording handoff removes the placed clips and leaves the sources in the library.
