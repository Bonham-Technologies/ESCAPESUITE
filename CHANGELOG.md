# Changelog

Notable changes to ESCAPE Suite, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each app's release notes are in its own
`CHANGELOG.md` under `apps/`, written by Changesets when a version ships.

## Unreleased

- ESCAPEPLAN: the Known limitations page now lists the browser limits of Transcribe to captions and Float controls (ESCSUITE-445).
- ESCAPEARTIST: Transcribe to captions has a language list beside its button, starting on the browser's language and remembered, so a recording in another language can be transcribed; the language-pack notice names the language (ESCSUITE-444).
- ESCAPECRAFT: the Float controls window shows the 3-2-1 countdown in place of the timer, announces the take's state to screen readers, and prints why Record is unavailable (ESCSUITE-440).
- ESCAPEARTIST: each pause in Remove silences has Go to and Play, so you can hear a pause, with a second either side, before deciding to keep or cut it (ESCSUITE-443).
- ESCAPEARTIST: Keep in Remove silences moves keyboard focus to the next pause (or the previous one, or Cancel) instead of dropping it to the page (ESCSUITE-441).
- ESCAPEARTIST: transcribing again asks whether to replace the existing captions or add to them, instead of stacking a second copy of every caption (ESCSUITE-442).
- Tests: on-device transcription and the repair of WebM seek indexes are tested on more of their edge cases, and the shared package's branch-coverage floor rises to 93% (ESCSUITE-439).
- ESCAPEARTIST: exports no longer sometimes repeat a frame after a cut or trim; WebM and GIF exports, and MP4 exports in Safari, wait for each video frame to be shown before drawing it (ESCSUITE-454).
- ESCAPEPLAN: a link to a page that doesn't exist shows a "Page not found" page, with links home, to ESCAPECRAFT and to ESCAPEARTIST, and the hosted site answers it with a real 404 instead of the home page (ESCSUITE-455).
- Tests: the test tooling is updated to Playwright 1.65, Vitest 5.1 and jsdom 31, with a workaround for a Firefox 159 crash that stopped the cross-browser accessibility checks from running.
- ESCAPEARTIST: Remove silences says how many clips on other tracks and markers it will leave where they are, before the cut and in the message after it.
- ESCAPEARTIST: Remove silences can move everything after each cut (on by default), so overlays, captions, markers and in/out points stay in step with the take; one undo puts it all back.
- Repository: the secret scanner no longer reports a test marker word in the analytics privacy test as a leaked key.
- Releases: each offline build and the headless render kit now ship with an SPDX SBOM (`.spdx.json`) listing the open-source packages inside them, and an attestation tying it to the build. [Verify your download](docs/VERIFY.md) shows how to check it.
- ESCAPEPLAN: the Privacy Policy now lists exactly what the hosted site's analytics records, including the approximate city Vercel works out from your IP address, which Vercel says it does not store.
- ESCAPEARTIST: Remove silences no longer listens to muted or hidden tracks, which the export leaves out, so their sound no longer hides a pause; they are still cut in step with the take.
- ESCAPEARTIST: transcribing to captions shows how much of the sound is prepared, and no longer gets stuck after the sound has played when the browser's speech recognition does not finish.
- ESCAPEARTIST: in the light theme, Remove silences' "Nothing was cut" message and the red border around a setting that is out of range are a darker red, so they are easier to read and to spot.
- ESCAPEARTIST: transcribing to captions uses far less memory (about 230 MB for an hour of timeline), and a timeline over 3 hours is turned down at once with a message that names the limit and suggests a section.
- ESCAPEARTIST: starting a new project, opening one, or a host page loading one while a transcription runs now stops it, so the old project's captions are no longer added to the new one.
- ESCAPEARTIST: the media library's Clear All, Clear Unused and Remove buttons are easier to read, at rest and when you point at them, in both themes.
- ESCAPEARTIST: in the light theme, the warning that browser storage is nearly full is a darker orange, so it is easier to read.
- ESCAPEARTIST: in the light theme, progress bars and slider handles are a darker blue, so they stand out from their tracks.
