---
'@escapesuite/craft': patch
---

The MP4 button now checks the browser can encode H.264 before offering the download, instead of failing partway; if it cannot encode AAC the MP4 is offered without audio and says so, before the conversion and again after it. It reads "Checking..." for the moment that check takes, and where H.264 is missing it stays on screen, disabled, saying why.
