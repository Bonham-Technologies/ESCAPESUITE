---
'@escapesuite/artist': patch
---

If the editor crashes while an export is running, the export is stopped and its decoder and encoders released, instead of running on behind the error panel until Reload.

An MP4, WebM or GIF export owns a decode worker, its encoders and a muxer, and until now only finishing, failing or Cancel let them go. A crash anywhere else in the editor replaces it with the error panel but never reached the export, so it kept encoding — and keeping the CPU busy — until the page was reloaded. The error panel now stops the export in flight the same way Cancel does, once, and does nothing when no export is running.
