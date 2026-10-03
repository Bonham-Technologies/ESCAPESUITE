---
'@escapesuite/artist': patch
---

An MP4 export says when it will have no sound — before and after — and H.264 is checked before the work is done

Exporting MP4 in a browser with no AAC encoder used to run all the way to "Export complete!" and hand back a silent file, with nothing on screen to say so. Firefox is that browser today: it has WebCodecs and encodes H.264, VP9 and VP8, but has no AAC encoder at all. The export dialog now says so before you choose the format — "MP4 export in this browser will have no sound (no AAC encoder). WebM keeps the audio." — reports it again while the export runs, and tells you afterwards that the file came out silent. MP4 is still offered: a silent MP4 is a reasonable thing to want, and now you know that is what you are getting. A browser that cannot encode H.264 at all has MP4 refused up front with its own reason rather than being offered a button that fails, and the check happens before the whole timeline's audio is mixed and every video loaded, so a refusal is instant instead of arriving at the end of a long wait.
