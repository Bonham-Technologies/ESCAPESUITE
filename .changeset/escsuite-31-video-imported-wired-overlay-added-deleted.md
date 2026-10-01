---
'@escapesuite/artist': patch
---

Importing media now reports a "Video Imported" analytics event (hosted build
only) with its type — video, image or audio. The event was already declared
and unit tested, but nothing in the uploader ever called it, so every import
was invisible in the dashboard. The unrelated "Overlay Added" event, also
declared and tested but never called from anywhere that adds an overlay, was
deleted along with its test rather than wired — a covered-but-uncalled event
is worse than no event, and adding an overlay wasn't judged a critical enough
path to instrument.
