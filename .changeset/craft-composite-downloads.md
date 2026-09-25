---
'@escapesuite/craft': minor
---

**"Download as MP4" on a recording made with "Record webcam as a separate track" now gives you
one file with the webcam in it** — the screen with the camera back in the corner, at the size
and in the shape it was recorded in, circle or rounded rectangle. It is the same picture the
preview showed you while you were recording, drawn by the same code, so the two cannot come
out differently.

The note that used to sit under such a take — "MP4 and M4A cover the screen track only — the
webcam track is not included yet" — is gone, because it is no longer true. **M4A was never
missing anything**: the mixed sound has always been on the screen recording, so the audio-only
download has always been the whole take, byte for byte.

Each part is still downloadable on its own as WebM from its own row, and MP4 and M4A are still
the whole take's downloads, on the take's first row.

If the webcam's own file cannot be read — cleared, deleted by hand, or unreadable — you still
get an MP4 of the screen rather than nothing at all, and ESCAPECRAFT says the webcam is not in
it instead of letting you find out by watching the file.

**For pages that embed ESCAPECRAFT:** `UPLOAD_RECORDING` may now carry an extra
`payload.parts` — every file of the take at once, the screen part included, each with its own
id, role, name, bytes and start offset. `payload.id`, `payload.name` and `payload.blob` are
unchanged and are still the screen part, so **a host that ignores `parts` needs no change and
behaves exactly as it does today**. A host that wants the whole take reads `payload.parts`
when it is there and falls back to `payload.blob` when it is not — it is absent for a
recording that is a single file. The message does not get bigger in any way that matters: the
files cross as references, not as copies. A single part's row still has its own "Upload to
host" button, which posts that part alone, for hosts that would rather ask for one thing at a
time.
