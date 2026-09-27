---
'@escapesuite/artist': patch
---

The toolbar's Delete button greys out for a selection that touches a locked track

It used to look live and do nothing, because the store refuses to delete a clip on a locked track. It is now disabled and says "Track is locked" until the track is unlocked; Mute and Unmute still work on such a selection, since a track's mute is not what the lock freezes.
