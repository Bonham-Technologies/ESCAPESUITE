---
'@escapesuite/headless-artist': minor
'@escapesuite/artist': patch
---

The headless kit's mp4 render says whether it carries sound, and refuses a sounded project when it cannot

The reference image's Linux Chromium has no AAC encoder, so every kit mp4 job there used to come back `ok: true` with a picture-only file and any `loudnessTarget` silently ignored. The verification manifest now carries `audio` (whether the delivered file has an audio track — always `false` for a GIF), and an mp4 job whose project has sound is refused on such a Chromium with `"code": "AUDIO_CODEC_UNAVAILABLE"` — exit 2 from `render`, 400 from `serve` — naming the two ways out: render webm, or set the new `options.allowSilentMp4: true` to render the picture alone. "Has sound" is ESCAPEARTIST's own rule (a clip on a present, visible, unmuted track whose source is not an image), so a video source with no audio track in its file still counts and needs `allowSilentMp4`; a project with nothing that could carry sound renders mp4 as before.
