---
'@escapesuite/craft': minor
'@escapesuite/shared': minor
---

ESCAPECRAFT can record the webcam as its own track. "Record webcam as a separate track" is a
new opt-in in the Webcam Overlay panel, shown only while the screen and the webcam are both on
and **off by default**: a take recorded with it on produces two files — the screen and the
webcam — from one recorder driving two encoders off one clock, so the two are frame-aligned by
construction. The webcam half appears as its own row in the library directly under its take,
playable, downloadable and deletable on its own; deleting the take deletes both, and deleting
the webcam row alone leaves an ordinary single-file take behind.

It costs about **twice the CPU and twice the storage**, which the toggle says before you
choose it, and it is **Chromium/Edge only** — it needs WebCodecs and
`MediaStreamTrackProcessor`. Where a browser cannot serve it, or where there is not enough
room for two tracks, the toggle stays on screen and disabled with the reason said out loud;
the composited overlay recording is unchanged and is still what every other browser and every
default take gets. The webcam half never costs the take its screen recording: if the camera's
encoder, muxer or save fails, the screen recording is still stored and listed, and the app says
the webcam track could not be saved.

One interim limit, named on the row it applies to: **MP4 and M4A of a separate-tracks take
cover the screen track only for now** — the webcam track is not included yet. Download the
webcam part's own WebM from its row until the composite lands.

For embedders: `UPLOAD_RECORDING` is still one message per library row, and its payload may now
carry optional `role` (`'screen' | 'webcam' | 'mic' | 'system'`) and `takeId` fields — added
only for a row that has them, so a host that knows nothing of takes receives exactly the
`{ id, name, blob }` it received before. A single message listing every part of a take
(`payload.parts`) is planned and will come with its own adoption note.

`@escapesuite/shared`: `SourceVideo` gains five optional fields — `takeId`, `role`,
`startOffset`, `overlayPlacement` and `hasWebcam` — and the `RecordingRole` /
`OverlayPlacement` types beside them. The database version is unchanged and every existing
recording is read exactly as before.
