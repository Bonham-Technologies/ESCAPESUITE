---
'@escapesuite/artist': patch
---

Exporting a recording that Chrome or Edge could not seek through no longer fails partway with "its seeks never completed". Some ESCAPECRAFT recordings have two frames on the same timestamp, and Chrome and Edge could not seek past that point. ESCAPEARTIST now reloads such a recording from a repaired copy and finishes the export. If a file still cannot be read, the message no longer tells you to switch to Chrome or Edge when you are already using one: it tells you to convert the file to MP4 instead.
