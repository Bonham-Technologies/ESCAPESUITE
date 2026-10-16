---
"@escapesuite/artist": minor
---

Import captions from an .srt or .vtt file, burn them into the video, and export them as a sidecar file

Drop or pick an `.srt` or `.vtt` file in the media library and its captions land on a "Captions" track at the top of the timeline, one ordinary text clip per caption — white on a translucent black box, centred near the bottom, sized to the project, long lines wrapped at word boundaries — and the whole import is one undo step. Because they are ordinary text clips they show in the preview and are burned into every MP4, WebM and GIF export and every headless render exactly as drawn, and they can be edited, moved, restyled or deleted like any other text. A later import adds to the same track. What a caption file can say that a text clip cannot hold — positioning, styling, regions, notes and speaker names — is left out, and one notice says which; a file that cannot be read is refused with a sentence naming the line. When the Captions track holds captions, the export dialog offers them as their own `.srt` or `.vtt` file beside the video (hide the track to keep captions off the picture and have only the file). There is no automatic captioning, and captions are not carried inside the video file.
