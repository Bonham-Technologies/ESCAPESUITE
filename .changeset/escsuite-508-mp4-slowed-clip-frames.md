---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

MP4 exports of slowed-down clips no longer repeat the previous frame in place of some frames when the video was imported in Firefox or Safari. A clip slowed to 0.25× or about 0.4× of a 50, 60 or 120 fps video could show a frame twice and skip the next one in an MP4 export that decodes in the page (every MP4 export in Safari, and MP4 exports of WebM videos in Firefox). Every frame of the video now appears in its turn. The same applies to MP4 renders of the headless render kit, which never measures a video's frame rate. Such a clip can now take a little longer to export, about as long as a clip at normal speed.
