---
'@escapesuite/artist': patch
---

A cleared media library is no longer offered back after a reload

Emptying a project through Clear All, Clear Unused or removing its last file left the session saved from before the clear in place, so the next reload offered "Resume Previous Session?" and brought back tiles whose files had just been deleted — they could not be played, placed on the timeline or exported. A clear that leaves the project with no files and no clips now removes that saved session too. And a restore that finds one of its files no longer in storage — deleted from another tab, or by ESCAPECRAFT — now leaves that file and its clips out and says how many were left out, instead of restoring a tile that does nothing.
