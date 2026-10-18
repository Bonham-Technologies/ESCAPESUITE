---
'@escapesuite/artist': patch
---

A WebM with no length or seek index imports on Firefox instead of failing

A WebM recorded by another app, with neither a duration nor a seek index, could make Firefox fail the import with "Could not determine the duration of" the file, because the seek that measures its length never finished. ESCAPEARTIST now repairs the file first, so the import measures, thumbnails and stores the fixed copy.
