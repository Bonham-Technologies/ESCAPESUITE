---
'@escapesuite/artist': patch
---

A video loaded from a URL is named properly and imported once

A video loaded from a URL is named after the URL's own filename with the right extension, a data: URL is named "Loaded media", and a ?video= import no longer happens twice in development.
