---
'@escapesuite/artist': patch
---

Remove silences and Split no longer repeat a clip's Transition Out at every cut. Before, each piece kept the clip's fade or wipe, so a take with 20 cuts played it 20 times; now only the piece at the clip's real end keeps it, and the cuts play straight through. Undo gives the clip back with its transition.
