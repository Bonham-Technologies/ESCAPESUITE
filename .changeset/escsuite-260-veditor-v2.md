---
'@escapesuite/artist': minor
'@escapesuite/headless-artist': minor
---

Saved projects are no longer capped by the file format; the only limits are your browser's download size and the storage it has free.

A saved project (`.veditor`) used to hold every video as text inside one huge string, which capped a whole project at about 192 MiB of media and read every video into memory on save. Projects are now saved in a new format that copies the videos into the file as they are, without reading them, and reopening one copies each video straight into the browser's storage. Measured 2026-10-12 on macOS: a project of about 2 GiB saved and reopened in Chromium 153 and Firefox 155 with the heap flat. A project too big for the storage you have free is refused before anything is written, with a sentence saying how much it needs and how much is free. A project file that is damaged or cut off, or whose project cannot be read (one edited by hand, or saved by a newer ESCAPEARTIST), is refused with the reason before any of its videos is copied, and a load that fails partway removes what it had already copied. Projects saved by earlier versions still open, but a project saved by this version cannot be opened by an older ESCAPEARTIST, which reports "Failed to load project". The headless render kit reads both the old and the new format, and reads the new one without loading the whole file into memory.
