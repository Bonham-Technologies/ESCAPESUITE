---
'@escapesuite/artist': patch
'@escapesuite/craft': patch
'@escapesuite/shared': patch
---

Importing media into ESCAPEARTIST, reopening a project and saving a take in ESCAPECRAFT now work
in Safari Private Browsing. Safari refuses to store files there the usual way, so the suite
stores their bytes instead and reads them back as the same file.
