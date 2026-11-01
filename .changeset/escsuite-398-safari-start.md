---
'@escapesuite/craft': patch
---

Recording in Safari no longer hangs at Start. The recorder now reads the picture from a video
element Safari will actually play (falling back to the on-screen preview), and if no picture
arrives within a few seconds the take fails with a notice instead of waiting forever.
