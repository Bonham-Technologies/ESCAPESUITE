---
'@escapesuite/craft': patch
---

Removed the unused compatible-WebM re-encode

An internal VP9 + Opus re-encode path that no button ever reached has been deleted. Nothing changes for you: the WebM download is the stored take, already seekable, and MP4 and M4A are unchanged.
