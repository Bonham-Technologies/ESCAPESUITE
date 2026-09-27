---
"@escapesuite/artist": patch
---

The preview's selection handles are the same size on screen whatever the project's resolution. The bounding box, its eight resize handles, the rotation grip and the zones that hit-test them were all sized in project pixels, so they shrank as the project grew relative to the box the preview is shown in — a 4K project in a 700px preview drew handles about a pixel and a half wide, which is a grab target of roughly one pixel. Each of them now scales with the project pixels per CSS pixel of that box, so it is the same 8px under the pointer at 4K as it is at 720p, and the preview measures no layout it was not already measuring to do it.
