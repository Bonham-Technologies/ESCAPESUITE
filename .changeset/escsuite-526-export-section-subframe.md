---
'@escapesuite/artist': patch
---

"Export Section" no longer offers a section shorter than one frame. When the in point sits less than a frame before the end of the timeline, which can happen after speeding a clip up (at 1.5× a 5 second clip ends between two frames), the section can't be exported and the export dialog says why, just as it does for a section that starts after the end. It used to offer "Export Section (0:03 - 0:03)" for a file with almost nothing in it.
