# Roadmap

What ESCAPE Suite is working on. It is written from the project's own tracker each week, so it
changes often. Nothing here is a promise of a date.

## Now

- ESCAPEARTIST: Remove silences says when overlays, captions or markers on other tracks will not move with the cut.
- ESCAPEARTIST: a transcription that is still running when you open another project no longer adds its captions to that project.
- ESCAPEARTIST: transcribing a long timeline uses far less memory, and a timeline that is too long is refused with a clear reason.

## Next

- ESCAPEARTIST: Remove silences ignores muted and hidden tracks, keeps keyboard focus in the review list, lets you jump to and play a pause before cutting it, and reads better in the light theme.
- ESCAPEARTIST: Stop works while a transcription is still preparing the sound, transcribing again asks whether to replace the captions, and you can pick the spoken language.
- ESCAPEARTIST: confirmation prompts move into the app's own dialog, so they also work inside sandboxed embeds.
- ESCAPECRAFT: the floating recorder controls show the countdown and announce recording state to screen readers.
- The README, the hub and CRAFT's help mention Remove silences, captions and floating controls.
- Steadier tests: a flaky export test, the new transcription code's coverage, and a check that the export recovery path is no longer needed.

## Recently shipped

- ESCAPEARTIST: Remove silences finds the pauses in a recording and cuts them in one undoable step.
- ESCAPEARTIST: transcribe a timeline to captions with the browser's on-device speech recognition.
- ESCAPECRAFT: recorder controls can float in a small always-on-top window while you record another app.
- ESCAPEPLAN: a Known limitations page explains what each browser can and can't do, and how to check nothing leaves your device.
- Release downloads will carry SHA-256 checksums and build-provenance attestations.
- ESCAPEARTIST: exports recover when a recording's seeks stop landing, and the waveform lines up with the sound on long clips.
- ESCAPECRAFT: every recorded frame gets its own timecode, and a take's stored duration is never short of its end.
- ESCAPEARTIST: a clear notice when browser storage is blocked, and on screen guidance when a timeline is too long to export.
- Accessibility: readable light-theme text, progress bars, warnings and buttons; a labelled toolbar; larger player controls and better layouts in narrow windows.
- The project is now licensed under Apache-2.0.
