---
'@escapesuite/headless-artist': minor
---

Render a job as an animated GIF

`options.format` now takes `"gif"` alongside `"mp4"` and `"webm"`, with a new `options.fps`
(`10`, `15` by default, or `20`) and a new `options.resolution` of `"360p"`. The output is written,
delivered and hashed exactly like a video — `<jobId>.gif` through the volume sink, `image/gif`
through S3 and the webhook, and a manifest whose `format` says `gif`.

`options.fps` applies to GIF only and a job that sets it on an MP4 or WebM render is rejected
before Chromium launches, rather than quietly encoding at 30. Note that a GIF stores each frame's
delay in hundredths of a second, so 10 and 20 fps are exact while 15 fps plays at about 14.3.

Two validation messages widened and are now API surface, not just log text: a bad
`options.format` reads `options.format must be one of "mp4", "webm", or "gif"`, and a bad
`options.resolution` reads `options.resolution must be one of "project", "1080p", "720p", "480p",
or "360p"`. A caller or broker that matches either message's old, two- or four-value text will
stop matching.
