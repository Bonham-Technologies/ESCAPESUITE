---
'@escapesuite/artist': patch
---

The timeline's waveform now lines up with the sound on long clips. It used to drift away from the audio by about 0.2 % of the clip (more than half a second five minutes in at 48 kHz, more for lower sample rates), so a quiet spot you trimmed at could land in speech. Its quiet stretches now also line up with the pauses Remove silences finds.
