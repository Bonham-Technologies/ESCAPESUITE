---
'@escapesuite/craft': patch
'@escapesuite/shared': patch
---

The offline ESCAPECRAFT disables its editor buttons wherever it is opened — from disk or from a plain web server — unless it was built with an address for ESCAPEARTIST.

Opened from a web server instead of from disk, the offline recorder used to offer "Open Editor" at an address that does not exist there and send you to a 404. It now disables both editor buttons with the same reason it gives from disk, unless the build was given an absolute address for ESCAPEARTIST. Shared gains `editorUrlIsRelative()`, the check behind it.
