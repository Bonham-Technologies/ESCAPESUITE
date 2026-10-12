---
'@escapesuite/artist': patch
---

The first custom keyframe on a clip with an Animate In preset no longer erases the fade-in

Adding a property's first keyframe away from time 0 used to store a starting keyframe at 0 that replaced the Animate In preset's own start, so a fade-in clip began at full opacity. That starting keyframe is now skipped when the preset already defines the start, and the fade-in stays.
