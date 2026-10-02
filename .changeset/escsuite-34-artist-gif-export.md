---
'@escapesuite/artist': minor
---

Export a GIF: 10/15/20 fps, 720p/480p/360p, a live size estimate, and the section you have in/out points on

GIF is now a third choice under Export → Advanced options, beside WebM and MP4. Pick a frame rate
(10, 15 or 20 — a GIF's size goes up roughly in step with its frame count) and a size (720p, 480p
or 360p, all following your project's own shape), and if you have in and out points set, "Export
Section" makes a GIF of just that part, exactly as it does for a video.

You get a size estimate before you start and a real one, counted from the bytes actually written,
while it runs — which is the number you want when you are deciding whether a clip is short enough
to paste into a chat. Past thirty seconds there is a note suggesting WebM instead; it is only a
note, and nothing stops you.

A GIF has no sound, and it needs the tab to stay visible while it encodes. But it needs nothing
else: GIF export does not use WebCodecs at all, so it is the one format that works in a browser
where WebM and MP4 cannot be exported — and in that browser the dialog now says so instead of
telling you there is nothing you can do.
