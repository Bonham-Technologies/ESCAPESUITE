---
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

- A transition with media on only one side now runs as the transition it is: a wipe clips that side to the region it should occupy and a slide moves it, instead of every type fading.
- A dissolve blurs in the preview the way it already did in an export, so what you see on the canvas is what the exported file contains.
- The inspector no longer reads an opaque fill whose colour happens to end in `00` — pure red `#ff0000`, black `#000000` — as "no fill": the fill button, the colour picker and the fill-opacity slider all go by the colour's alpha channel now.
- A clip whose media has not loaded no longer takes transform handles or counts as a video in the preview.
- A recording that is cancelled stays cancelled: a recorder that flushes its last chunk after you cancel no longer saves that take to the library.
