---
'@escapesuite/artist': patch
---

An imported video's real frame rate is measured at import and stored

An imported video's real frame rate is measured at import and stored, so the in-page decoder's seek window and anything else that reads it no longer assume 30 fps. The measurement plays the file at half speed, so a 120 fps file on a 60 Hz screen still shows every frame, for at most eight frames or half a second, and is labelled as measured; a file it cannot measure is still stored at 30 and labelled as assumed, and reopening a saved project keeps whatever rate the project carries without measuring again.
