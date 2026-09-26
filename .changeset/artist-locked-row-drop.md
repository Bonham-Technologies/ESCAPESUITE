---
'@escapesuite/artist': patch
---

A clip cannot be dropped onto a locked track

Locking a track stopped clips on it from being dragged, but not clips from
being dragged *onto* it: a single clip could be dropped on a locked row, and a
multi-selection that included a clip on a locked row could carry it off. Both
drops are now refused — the clips spring back, like any other refused drop —
so a locked track takes no clip it did not already have.
