---
'@escapesuite/artist': patch
---

A very old project whose text or shape overlay has no usable start and end time now opens with that overlay repaired, instead of failing at export

Projects from early ESCAPEARTIST versions kept text and shape overlays in a list of their own, each with a start and end time on the timeline. If one of those times was missing or not a number, the project still opened, but the overlay became a clip with no length and the export refused the whole project. The overlay is now repaired when the project opens: it starts at its start time if that one is usable, otherwise at the beginning, and lasts 5 seconds, the length a new overlay gets. A note in the browser console says how many were repaired. Overlays whose times were fine open exactly as before.
