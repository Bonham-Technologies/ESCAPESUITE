---
"@escapesuite/craft": patch
---

MP4 downloads no longer freeze the tab on an old recording, and no longer fail on the shape of a screen

ESCSUITE-135: converting a recording that was saved before its file was repaired for seeking (every MediaRecorder take from a couple of ESCAPECRAFT versions back, and any take whose repair failed at save time) could lock the whole tab: the converter read the recording's length as unknown and, believing it had unlimited frames left to encode, kept drawing and encoding the same last frame forever once playback ended. Cancel did nothing, because the tab had stopped responding. Converting to MP4 now recovers the original recording length from what was saved alongside it, and if that isn't available either, it refuses the conversion with a plain message instead of running away.

ESCSUITE-136: a screen recording made with the camera overlay on could fail to convert to MP4 with "H264 only supports even sized frames" — a real recording, with nothing wrong with it, just refused. This hit by default on every current MacBook Pro, because the camera-overlay compositor's own math produces a screen height that comes out odd at those screens' resolutions. MP4 conversion now trims at most one extra row or column of pixels (invisible in the output) so the video encoder always gets a size it accepts.
