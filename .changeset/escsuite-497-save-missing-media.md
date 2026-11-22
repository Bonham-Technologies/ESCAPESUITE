---
'@escapesuite/artist': patch
---

In Chrome and Edge, a project with a clip whose media is no longer stored in this browser can be saved again. The first Save, and Save Project As, now save the project to the new file without that media and tell you which media was left out, as saving did before files could be chosen. Saving over the project's existing file still refuses, so the file that may hold the only copy of that media is never overwritten, and it now refuses before asking for anything, so it no longer leaves an empty file behind.
