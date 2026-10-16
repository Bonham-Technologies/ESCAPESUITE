---
'@escapesuite/artist': minor
'@escapesuite/headless-artist': minor
---

Exports now measure their loudness, and can normalise it to −14, −16 or −23 LUFS

Every MP4 and WebM export measures its mix the way broadcasters and streaming services do (ITU-R BS.1770-4 / EBU R128 integrated loudness and true peak) and, when it is done, says so: "Export complete! Measured −18.3 LUFS". A new **Audio loudness** choice under Advanced options — Off by default, −14 LUFS (streaming), −16 LUFS (podcast/mobile) or −23 LUFS (broadcast) — turns the mix up or down to that target before it is encoded, holding its peaks under −1 dBTP with a limiter, and the completion line adds the gain it applied ("gain +4.3 dB") and "limited" when the limiter had to step in. The choice is remembered with your other export settings. In the headless kit, a job spec can ask for the same thing with `options.loudnessTarget` (`-14`, `-16` or `-23`, MP4 and WebM only), and the verification manifest gains a `loudness` record — the measured loudness and true peak, the gain applied and the target — whenever the render had sound to measure.
