---
'@escapesuite/artist': patch
---

A handful of crop and export-dialog edge cases from a code sweep are fixed: a headless render now validates a job's project (crop, transform, clip ids) before rendering, instead of silently dropping a clip with a malformed crop; a Shift-locked crop drag that would exceed the 90% inset limit now refuses the move and keeps the last valid, correctly-ratioed crop instead of landing a clamp that breaks the lock; a corrupt zero (or negative) clip scale no longer divides the crop drag's own arithmetic by zero; and the export dialog says "WebM needs this tab visible" even in a browser with no MP4 support, where that note used to disappear entirely.

Two findings turned out not to be bugs and are now pinned with regression tests instead: the crop handles' drag listeners already survive the layer rendering nothing mid-drag (only an actual unmount tears them down), and nothing in this build's render paths reaches the editor's base64 GIF entry point, so the README's memory estimate stands with a clarifying note about which path it describes. The arrow-key crop nudge's documentation is also corrected: it moves a handle's fixed insets in the clip's own (unrotated) frame, not "the way the arrow points" on a rotated clip.
