---
'@escapesuite/artist': patch
---

Stopping "Transcribe to captions" while it listens, or the speech recogniser failing part-way, no longer throws away what it heard: the captions heard so far are added to the Captions track, and the notice says how many and where it stopped (for example "Transcription stopped at 1:23. Added 12 captions heard before then to the Captions track."). If you chose Replace, only the captions before that point are replaced; the ones after it stay. Press Ctrl+Z to take them off again. Stopping while the sound is still being prepared, or before anything was heard, adds nothing, as before.
