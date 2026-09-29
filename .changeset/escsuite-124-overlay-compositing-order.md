---
"@escapesuite/artist": patch
---

An overlay (text or shape) placed on a track below a video clip is now hidden behind that clip in an MP4 or WebM export, exactly as it already was in the preview — and a blur shape now only blurs the media on tracks below it in an export too, instead of blurring everything.

Both exporters drew every media clip first, then drew every overlay clip afterwards, unconditionally on top — regardless of which track the overlay was actually on. The preview has always drawn media and overlays interleaved, in track order, so a lower-track overlay is covered by a higher-track video on screen. That mismatch meant an overlay could look invisible while editing and then show up, on top of everything, in the exported file — reachable with no deliberate effort, since a new text or shape overlay is placed on the first empty track, which is often one below existing video. It also meant a blur shape drawn one track below a video blurred that video in an export, when the preview never would have. Both exporters now composite media and overlays in one pass, in the same track order the preview uses, so what you see while editing is what you get in the file. The headless render service shares these same exporters, so it is fixed too.
