---
'@escapesuite/artist': patch
---

"Export Section" now stops at the end of the timeline. After an edit that shortens the timeline, such as speeding a clip up, in and out points can be left past its new end: a section that runs past the end now exports only up to the end (the button shows that range), and one that starts after the end can no longer be exported, with a line saying why and suggesting you move the in point or export the full video. Before, these exported seconds of black with no sound and still said "Export complete!". The chapter list for YouTube also leaves out markers past the end.
