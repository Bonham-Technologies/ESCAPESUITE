---
'@escapesuite/craft': patch
---

The composite MP4's camera border matches the preview again (ESCSUITE-144), an orphaned recording opens in the editor instead of failing (ESCSUITE-145), and the library says when a recording's file is gone (ESCSUITE-146)

A separate-tracks take's composite MP4 drew the camera's white border and rounded corners at a flat pixel count of the raw capture, rather than scaling them the way the inset around the camera already scales — so a 1920-wide take's downloaded MP4 showed the border and the corner at two thirds the fraction of the frame the live preview, and ESCAPEARTIST's own import, both agree on. Both are now scaled the same way, and the live preview is unchanged.

"Open in Editor" on a recording's row always sent the take's primary id — correct for an ordinary companion, but wrong for an orphaned one whose primary had been deleted from ESCAPEARTIST's media library elsewhere: the editor was handed an id nothing answered to and reported "Recording not found" for a file that was still in storage and still listed in the library. That row now falls back to its own id, and opens alone in the editor instead of failing outright.

Pressing Play or Download on a recording whose file has already been removed from storage — most commonly, deleted from ESCAPEARTIST's media library in another tab — used to do nothing at all: no dialog opened, no file downloaded, and nothing was said, while the row kept showing its name, duration, size and thumbnail as if it were still there. Both actions now say so through the library's notice. Nothing is disabled: a row like that is still deletable.
