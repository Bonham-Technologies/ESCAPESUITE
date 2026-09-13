---
'@escapesuite/artist': patch
---

Moving a track down no longer loses it when the track cannot be found; a second status message now gets its own three seconds instead of being blanked early by the previous one's timer, and a pending message no longer fires after the editor closes; the clip inspector no longer shows a transition-duration slider for a clip that has no transition, and choosing a transition type for such a clip now keeps the default half-second duration instead of leaving it unset; clicking the timeline's track area on an empty project now moves the playhead where you clicked, as the ruler already did; and a recording opened from ESCAPECRAFT no longer leaks its thumbnail's object URL.
