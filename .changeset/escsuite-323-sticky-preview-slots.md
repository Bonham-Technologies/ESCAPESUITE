---
'@escapesuite/artist': patch
---

The preview no longer stalls a clip that has not changed when another clip of the same recording starts.

In a picture-in-picture of one recording whose lower clip starts after the upper one, the upper clip now keeps playing smoothly instead of hitching for a moment when the lower clip appears, and a clip split and crossfaded into itself now plays straight through the cut from the frame it was held on, with no stall. Each clip in the preview keeps the video it is playing on for as long as it is on screen; exports are unchanged.
