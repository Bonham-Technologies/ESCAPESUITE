---
'@escapesuite/artist': patch
---

An export of a timeline with no length is refused with a sentence instead of failing with a raw browser error.

A timeline whose clips add up to no length, or a selected section with none, used to fail an MP4 or WebM export with a message from the browser about audio contexts or typed arrays. Now the export dialog greys out the download buttons and says why, the exporters refuse with the same sentence before doing any work, and a project file or host payload whose clip has no positive duration is refused when it is opened.
