---
'@escapesuite/artist': patch
---

A damaged older project file is now refused with a reason instead of a bare "Failed to load project"

Opening a `.veditor` saved by an older ESCAPEARTIST (the JSON kind, with its videos written into it as text) that had been cut short, hand-edited or otherwise damaged used to fail with the browser's own JSON or type error, and the notice said only "Failed to load project". It now says what is wrong, the way a damaged current-format file already did: "Failed to load project: the file is not valid JSON", "… videos must be a list", "… videos[1].data must be a string", "… videos[0].data is not base64" and so on. Nothing is stored from a refused file, and a video that was stored before the damaged one is removed again. A few hand-edited shapes that used to load are now refused, as a current-format file already refuses them: a video whose `meta` is not an object (a list, `false`, `0` or `""`), a thumbnail that is neither text nor `null`, an `id` or `name` that is not text, a missing `mimeType`, and the same video listed twice. ESCAPEARTIST never wrote any of them.
