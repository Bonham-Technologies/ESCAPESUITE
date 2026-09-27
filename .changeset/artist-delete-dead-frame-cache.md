---
'@escapesuite/artist': patch
---

Removed the preview's frame cache and its Clear Cache button, and the export scheduler — both were dead code that nothing in the app ever exercised

The frame cache was built to make scrubbing instant by replaying previously-rendered frames, but nothing in ESCAPEARTIST ever populated it, so it always missed and the media library's "Clear Cache" button never actually appeared (it only showed once frames were cached). The export scheduler was built to chunk export work in the background, but no exporter ever called it. Deleting both is invisible except for that Clear Cache button, which is now gone because it never had anything to clear.
