---
'@escapesuite/artist': patch
---

Trimming a clip into its neighbour now stops at the neighbour's edge, and pasting onto an occupied spot moves the pasted clip to the next free one

Two clips on one track never play over each other. Dragging a clip's end handle out over the clip in front of it used to stack the two, and so did copying a clip, moving the playhead into it and pressing Ctrl+V — and once a track held two overlapping clips, the preview and both exports drew and mixed both of them at once, and the clip could no longer be dragged anywhere. A trim now stops dead at the clip next to it (dragging the end handle with the ripple tool out still pushes the neighbours along instead, as it always has — that is what the ripple tool is for), and a paste lands at the playhead or at the first free spot after it, carrying a multi-clip paste along as one group so the clips keep their spacing.
