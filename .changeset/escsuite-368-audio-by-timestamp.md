---
'@escapesuite/artist': patch
---

Long recordings now export with sound in step with the picture. When the browser's recorder dropped bits of audio, ESCAPEARTIST closed the holes, so sound ran further ahead of the picture the longer the take went (about 0.17 s after two minutes). Audio is now placed by its timestamps: a hole stays silent and the rest stays in sync. Waveforms line up the same way.
