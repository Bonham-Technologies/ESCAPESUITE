<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Data Flow
```
ESCAPECRAFT recordings → IndexedDB → ESCAPEARTIST imports
                          ↓
                    Shared videos, thumbnails, projects
```

A **take** is not always one file. Since ESCSUITE-14 a recording made with "Record webcam as
a separate track" is up to **four** `SourceVideo`s sharing a `takeId` — the screen, the webcam,
the microphone and the system audio — each with a `role`
(`'screen' | 'webcam' | 'mic' | 'system'`) and a `startOffset`, and each part's stored
`duration` is its own — an audio part whose track ended mid-take (a microphone unplugged) is
stored at the shorter length its file holds, not the take's (ESCSUITE-318); the take is named by its
primary (the primary's `takeId` is its own id), and the primary carries both the
`overlayPlacement` the webcam was recorded at **and the mixed audio**, so a consumer that only
knows how to read one file still gets a complete, audible recording. The `mic` and `system`
parts are stored as `mediaType: 'audio'` with no dimensions and no thumbnail. Every field is
optional and `DB_VERSION` stays 1, so a single-file take — which is every recording made before
it and every composited PiP take after it — is read exactly as before. A consumer that resolves
one id should expect siblings: `getAllVideoMetadata()` filtered on `takeId`.
