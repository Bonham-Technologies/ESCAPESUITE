---
'@escapesuite/artist': patch
---

An export says when it will have no sound — before and after — and the codecs are checked before the work is done

Exporting MP4 in a browser with no AAC encoder used to run all the way to "Export complete!" and hand back a silent file, with nothing on screen to say so; WebM did the same where Opus was missing. Firefox is that browser for MP4 today: it has WebCodecs and encodes H.264, VP9 and VP8, but has no AAC encoder at all. The export dialog now says so before you choose the format — "MP4 export in this browser will have no sound (no AAC encoder). WebM keeps the audio.", and the mirror sentence for WebM and Opus — reports it again while the export runs, and tells you afterwards that the file came out silent, naming the codec your browser turned out not to have. It only says that last part when there was sound to lose: an image-only or fully muted timeline is not told it lost anything. Both formats are still offered: a silent MP4 is a reasonable thing to want, and now you know that is what you are getting. A browser that cannot encode a format's picture at all has that format refused up front with its own reason rather than being offered a button that fails, and for MP4 the check happens before the whole timeline's audio is mixed and every video loaded, so a refusal is instant instead of arriving at the end of a long wait.
