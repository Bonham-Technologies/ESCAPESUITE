---
'@escapesuite/artist': patch
---

Cancelling an MP4 export now stops it at once, even while it is loading your videos

Cancelling an MP4 export while it was loading your videos, or waiting on a slow frame, used to close the dialog but keep loading every remaining video and keep the background decoder (up to 512 MB of memory) busy until it finished on its own; the export now stops and frees that memory the moment you press Cancel.
