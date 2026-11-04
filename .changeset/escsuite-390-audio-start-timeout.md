---
'@escapesuite/craft': patch
---

Start no longer hangs at 00:00 when the computer has no working sound output. After 5 seconds the recording fails with a message about the audio, and ESCAPECRAFT is ready to try again instead of needing a reload.
