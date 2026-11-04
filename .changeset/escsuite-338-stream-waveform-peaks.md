---
'@escapesuite/artist': patch
---

Waveforms are now built by reading the audio a piece at a time instead of decoding the whole file at once, so importing a long recording no longer needs memory for its entire decoded audio and large files stop failing or slowing the tab while their waveform draws.
