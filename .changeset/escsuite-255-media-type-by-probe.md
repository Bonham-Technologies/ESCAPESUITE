---
'@escapesuite/artist': patch
---

Audio-only files imported with a video extension are now treated as audio

An audio-only file imported with a video extension is now treated as audio, so it cannot become a 0×0 video whose Fit to Canvas writes an infinite scale and makes the saved project unopenable.
