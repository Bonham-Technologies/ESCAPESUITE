---
'@escapesuite/artist': patch
---

"Remove silences" now listens only to the tracks you will hear in the export. Muted and hidden tracks no longer hide a pause, so a take whose music or system audio track is muted has its pauses found. Those tracks are still cut along with the rest of the take, so nothing falls out of step. If every track with sound is muted or hidden, the dialog says there is no audible sound to judge.
