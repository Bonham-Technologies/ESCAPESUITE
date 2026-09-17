---
'@escapesuite/craft': patch
---

The MP4 button now checks the browser can actually encode H.264 and AAC before offering the download, instead of failing partway. It reads "Checking..." for the moment that question takes to answer, and where the answer is no it stays on screen, disabled, saying which encoder is missing.
