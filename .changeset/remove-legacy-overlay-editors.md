---
'@escapesuite/artist': patch
---

Internal: the unreachable overlay editor and the old inline keyframe editor are removed, along with the legacy overlay store actions, selection state and preview draw loops they were the last readers of. Legacy overlays in old project files still load — they become ordinary overlay clips.
