---
'@escapesuite/craft': patch
---

Lower CPU use while recording: only the audio meters redraw when levels change. The rest of the recorder — the header, the recordings list, the preview stage and the transport bar — is no longer redrawn a dozen times a second for the length of a take.
