---
'@escapesuite/artist': patch
---

A damaged older project file is now refused with a reason instead of a bare "Failed to load project"

Opening a `.veditor` saved by an older ESCAPEARTIST (the JSON kind, with its videos written into it as text) that had been cut short, hand-edited or otherwise damaged used to fail with the browser's own JSON or type error, and the notice said only "Failed to load project". It now says what is wrong, the way a damaged current-format file already did: "Failed to load project: the file is not valid JSON", "… videos must be a list", "… videos[1].data must be a string", "… videos[0].data is not base64" and so on. Nothing is stored from a refused file, and a video that was stored before the damaged one is removed again.
