---
'@escapesuite/craft': patch
---

New ESCAPECRAFT screen and webcam recordings now seek reliably frame by frame in Chrome and Edge, even when the capture stutters. A take could hold two frames at the same instant, which Chrome could never seek past; editing such a take in ESCAPEARTIST then needed a slow recovery during export, adding seconds per affected clip. Recordings made from now on never have this problem.
