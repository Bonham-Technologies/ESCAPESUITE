# Changelog

Notable changes to ESCAPE Suite, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each app's release notes are in its own
`CHANGELOG.md` under `apps/`, written by Changesets when a version ships.

## Unreleased

- ESCAPEARTIST: Keep in Remove silences moves keyboard focus to the next pause (or the previous one, or Cancel) instead of dropping it to the page (ESCSUITE-441).
- ESCAPEARTIST: transcribing again asks whether to replace the existing captions or add to them, instead of stacking a second copy of every caption (ESCSUITE-442).
- ESCAPECRAFT: the Float controls window shows the 3-2-1 countdown in place of the timer, announces the take's state to screen readers, and prints why Record is unavailable (ESCSUITE-440).
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
