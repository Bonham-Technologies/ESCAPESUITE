---
'@escapesuite/artist': patch
---

A WebM with no length or seek index imports on Firefox instead of failing

A WebM recorded by another app, with neither a duration nor a seek index, could make Firefox give up with "Could not read" before ESCAPEARTIST had repaired the file. The repair now runs first, so the import measures, thumbnails and stores the fixed copy.
