---
'@escapesuite/artist': patch
---

An imported video's real frame rate is measured at import and stored

An imported video's real frame rate is measured at import and stored, so the in-page decoder's seek window and anything else that reads it no longer assume 30 fps. The measurement plays the file at half speed, so a file of up to twice the screen's refresh rate (120 fps on a 60 Hz screen) can still be sampled, and a frame the screen drops while it does so does not change the reading; it runs for at most eight frames or half a second and is labelled as measured; a file it cannot measure is still stored at 30 and labelled as assumed, and reopening a saved project keeps whatever rate the project carries without measuring again.
