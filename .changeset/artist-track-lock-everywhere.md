---
'@escapesuite/artist': minor
---

A locked track is locked for everything

Locking a track used to stop clips being dragged, trimmed or cut on it and nothing else: Delete removed them, paste put clones back on the track, the inspector edited them, split and duplicate worked, the keyframe panel wrote keyframes, a new clip could land on an empty locked track, and the track itself could be deleted. Every one of those now refuses — all of it or none of it for a selection — so a locked track holds exactly what it had when it was locked. Removing media a locked track's clip uses is refused too — both the per-item Remove and "Clear All" in the media library, which say why they are disabled. The inspector greys out for a clip on a locked track and says why, while still letting you open its sections, jump to the clip and open the keyframe editor to read it; the track's own delete button is disabled; and double-clicking a locked track's text no longer opens an editor that would throw the typing away. The track's name, mute, volume, visibility and order are still yours to change. A keyboard shortcut that would have edited a locked track says "Track is locked" instead of pretending it did.
