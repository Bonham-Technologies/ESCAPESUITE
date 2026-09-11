---
"@escapesuite/artist": patch
---

Bugs found and fixed while breaking the preview up into testable pieces:

- A shape overlay filled with a six-digit colour ending in `00` — pure red, green, yellow or black — was drawn with no fill at all, in the preview and in exports alike.
- The preview now releases the object URLs for its loaded media when it unmounts instead of holding them for the life of the document (a hygiene fix; the editor's preview never unmounts while the tab is open).
