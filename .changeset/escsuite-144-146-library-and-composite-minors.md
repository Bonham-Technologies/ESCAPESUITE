---
'@escapesuite/craft': patch
---

Three library and composite-MP4 fixes from the third finding sweep. The composite MP4 for a separate-tracks take now draws the camera's white border and rounded corners at the same fraction of the frame the live preview and ESCAPEARTIST both show, instead of at two thirds of it on a wider capture (ESCSUITE-144). An orphaned companion row's "Open in Editor" — one whose primary was deleted from ESCAPEARTIST's media library in another tab — now opens with its own id instead of the deleted primary's, which used to answer "Recording not found" for a file that is still in storage and still listed (ESCSUITE-145). Play and Download on a recording whose bytes are gone (most commonly, deleted from ESCAPEARTIST's media library) now say so through the library's notice, instead of doing nothing at all — no dialog, no file, no explanation; nothing is disabled, since a row like that is still deletable (ESCSUITE-146).
