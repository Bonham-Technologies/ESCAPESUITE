---
'@escapesuite/headless-artist': patch
---

A bundle's audio-only source renders as audio, not as a silent video

Rendering a `.veditor` bundle that holds an ESCAPECRAFT audio-only take (mic alone, screen and webcam both off) now treats that source as audio, the way ESCAPEARTIST itself does, instead of decoding it as a video with nothing to show. Temp files for a WebM source also keep a `.webm` extension, including `audio/webm` and a `video/webm` MIME type carrying a `;codecs=` parameter, where they used to fall back to `.bin` or the wrong extension.
