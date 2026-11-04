---
'@escapesuite/artist': patch
---

Exporting a long timeline (a two-hour recording, say) no longer fails part way. The export used to build the whole file and its whole audio mix in memory and hit the browser's 2 GB limit; it now writes the file in pieces and mixes only the range you export. An export longer than 3 hours is refused up front, with a pointer to setting in and out points.
