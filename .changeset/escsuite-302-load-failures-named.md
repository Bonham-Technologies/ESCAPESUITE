---
'@escapesuite/artist': patch
---

Opening a project that fails partway now says why, and a project with broken trim points is refused by name.

When a `.veditor` file could be read but one of its videos could not be decoded, could not be stored (including when the browser's storage is full), or the file itself could not be read at all, the message used to be just "Failed to load project". It now names the video and the reason — for example `Failed to load project: videos[0] ("clip.mp4") could not be decoded`, or the media library's own "Storage quota exceeded" sentence — and, as before, anything the load had already stored is removed again. A project whose clip has a missing, negative or non-numeric `startTime`, or an `endTime` that is missing or not after its `startTime`, is now refused with a sentence naming the clip instead of opening a clip that plays from a nonsensical point; this applies to project files, a host's `LOAD_PROJECT` message and headless render jobs alike.
