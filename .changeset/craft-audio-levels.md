---
'@escapesuite/craft': patch
---

Lower CPU use while recording: the audio meters now update about 12 times a second instead of on every frame, and a recording with no microphone or system audio no longer runs a meter at all.
