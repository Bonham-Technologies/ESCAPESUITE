---
'@escapesuite/artist': patch
---

The headless render path's `options.timeRange` is now clamped to the project's own timeline before it ever reaches the exporter or the verification manifest. An `end` past the end of the timeline, or a `start` before 0, used to reach the encoder and the manifest untouched — a one-second project asked to render `{start: 0, end: 600}` encoded roughly 599 seconds of black and the signed manifest reported `durationSec: 600` for it, describing the request rather than the bytes. A requested range is now pulled back into `[0, timelineDuration]` first, `durationSec` is derived from that clamped range, and a request whose clamped intersection with the timeline is empty fails the render naming `options.timeRange`, rather than encoding nothing or the un-clamped request.
