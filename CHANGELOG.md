# Changelog

Notable changes to ESCAPE Suite, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each app's release notes are in its own
`CHANGELOG.md` under `apps/`, written by Changesets when a version ships.

## Unreleased

- Repository: the secret scanner no longer reports a test marker word in the analytics privacy test as a leaked key.
- ESCAPEARTIST: Remove silences no longer listens to muted or hidden tracks, which the export leaves out, so their sound no longer hides a pause; they are still cut in step with the take.
- ESCAPEARTIST: transcribing to captions shows how much of the sound is prepared, and no longer gets stuck after the sound has played when the browser's speech recognition does not finish.
- ESCAPEARTIST: in the light theme, Remove silences' "Nothing was cut" message and the red border around a setting that is out of range are a darker red, so they are easier to read and to spot.
- ESCAPEARTIST: transcribing to captions uses far less memory (about 230 MB for an hour of timeline), and a timeline over 3 hours is turned down at once with a message that names the limit and suggests a section.
- ESCAPEARTIST: starting a new project, opening one, or a host page loading one while a transcription runs now stops it, so the old project's captions are no longer added to the new one.
- ESCAPEARTIST: the media library's Clear All, Clear Unused and Remove buttons are easier to read, at rest and when you point at them, in both themes.
- ESCAPEARTIST: in the light theme, the warning that browser storage is nearly full is a darker orange, so it is easier to read.
- ESCAPEARTIST: in the light theme, progress bars and slider handles are a darker blue, so they stand out from their tracks.
