---
'@escapesuite/artist': patch
---

Reopening a project is faster when it holds silent sources or sources stored before waveforms were saved. ESCAPEARTIST used to decode such a source's whole audio track again on every reopen. It now decodes each one once in this browser and remembers the result, whether it found a waveform or found no audio.
