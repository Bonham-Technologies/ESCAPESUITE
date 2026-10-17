---
'@escapesuite/artist': patch
---

A saved project file no longer carries a source length the headless kit would refuse

Saving a project now leaves a source's duration, width or height out of the file when it is not a usable number, instead of writing `null`. A file with the length left out opens as before, with the length read from the video itself.
