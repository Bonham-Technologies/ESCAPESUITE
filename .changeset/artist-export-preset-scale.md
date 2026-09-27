---
'@escapesuite/artist': patch
---

Export → Advanced → Resolution now rescales the project instead of letterboxing or cropping it

Every setting but the default was wrong. A 1080p export of a 720p project drew the picture at its original size in the middle of a 1920x1080 frame, pillarboxed and letterboxed in black; a 480p one drew it at full size into an 854x480 frame, cropping everything outside the middle. Only "Project" came out right, which is why it went unnoticed. The frame is now scaled onto the output the same way the editor's preview scales it onto the canvas — one shared mechanism rather than one pipeline remembering what another does — so a preset export is the whole picture at the size you asked for. A preset's shape follows the project too: 720p of a 16:9 project is 1280x720, where before it took its aspect ratio from whichever clip happened to be on the bottom track and could come out 960x720. The one case that still puts black bars on a frame is an "Original" export whose source really is a different shape from the project, where the picture is centred inside the output rather than stretched. Blur radii scale with the output as well, so a blur looks the same in the file as it does in the preview. The headless render kit shares the exporters and gets all of it, manifest included.
