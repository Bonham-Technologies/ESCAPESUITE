---
"@escapesuite/artist": patch
---

Bugs found and fixed while breaking the preview up into testable pieces:

- A shape overlay filled with a six-digit colour ending in `00` — pure red, green, yellow or black — was drawn with no fill at all, in the preview and in exports alike.
- Closing the editor left the object URLs for every loaded video, image and audio file behind, holding their data in memory until the tab was closed.
