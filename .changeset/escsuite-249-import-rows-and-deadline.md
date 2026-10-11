---
'@escapesuite/artist': patch
---

Two imports with the same filename get their own progress rows, a .VEDITOR in upper case opens as a project, an unsupported file is refused through the editor's own notice instead of a browser alert, and a file the browser never finishes reading fails after 15 seconds instead of staying on "Processing…" forever.

Import rows were matched by file name, so dropping two files called `clip.mp4` made them share one row's progress, one error and one Dismiss; each accepted file now has its own row. The project-file check ignored case, so `PROJECT.VEDITOR` was refused as "not media" with a blocking alert; it now opens like any project, and a genuinely unsupported file says so in the editor's notice. A video or audio file whose header the browser neither decoded nor rejected used to sit on "Processing…" with no way out; it now fails after 15 seconds and can be dismissed.
