---
'@escapesuite/artist': patch
---

The media library no longer asks storage to rebuild a thumbnail for an audio source — a
microphone-only take, or one of a take's microphone/system-audio companions — which never had a
picture to begin with. Every audio clip's "image" tile was quietly costing an IndexedDB read on
every editor load for a lookup that could only ever come back empty; nothing else about how
audio clips look or behave changes.
