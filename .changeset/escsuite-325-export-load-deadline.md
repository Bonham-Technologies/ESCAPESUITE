---
'@escapesuite/artist': patch
---

An export no longer hangs on a video the browser can neither read nor reject

If a video in your project was one the browser would neither decode nor report an error for, the export sat on "Loading media files…" for ever, and Cancel was the only way out. The export now gives each video 15 seconds to show its first frame. An MP4 export that hits this stops and tells you which file could not be read, rather than quietly leaving the clip out; a WebM or GIF export skips that clip with a warning and finishes the rest.
