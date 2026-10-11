---
'@escapesuite/craft': patch
---

Clicking Play twice quickly no longer keeps a recording's bytes in memory for the rest of the session.

Two clicks on Play before the screen refreshed each made their own playback link, and only the second was ever released, so the first recording's bytes stayed in memory until the tab closed. The playback link is now tracked in one place: the latest click wins, an earlier click that finishes late releases its link instead of showing it, and closing the player or leaving the app releases whichever link is live.
