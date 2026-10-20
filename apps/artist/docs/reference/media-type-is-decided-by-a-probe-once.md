<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Media type is decided by a probe, once (ESCSUITE-255)

A browser guesses `file.type` from the extension, and an ESCAPECRAFT microphone-only take
downloads as `.webm` (`video/webm`) with no picture in it. Typed by that guess it became a 0x0
"video" whose Fit to Canvas divided by the zero dimensions and wrote `scaleX: Infinity`; the
autosave kept it, the saved `.veditor` serialised it as `null`, and reopening was refused with
"has an invalid transform".

- **One decision, every entry path.** `core/videoProcessor.ts`'s `processMediaFile(file)` is the
  only place a file's type is chosen. `image/*` goes to `processImageFile`; `audio/*` goes
  straight to `processAudioFile` with no `<video>` probe; anything else loads in a `<video>`
  through `extractVideoMetadata` (so `loadMediaDuration`'s duration probe, and for a picture the
  ESCSUITE-276 frame-rate probe), and a picture (`videoWidth > 0 &&
  videoHeight > 0`) finishes as video while no picture falls back to `processAudioFile`
  (`mediaType: 'audio'`, 0x0, the waveform strip), whatever the MIME type says. The media
  library's uploader and both host paths (`LOAD_VIDEO` and `?video=` in
  `app/useHostIntegration.ts`) call it; the uploader reports `metadata.mediaType` to analytics.
  `?loadVideo=` is untouched — it carries CRAFT's own `mediaType`.
- **Fit to Canvas guard.** `fitToCanvasScale` returns `1` ("nothing to fit") for a drawn size
  with a non-positive dimension. The Transform section (and with it Fit) is already gated on
  `isAudio` in `ClipEditor.tsx`; `ClipEditor.test.tsx` pins that.
- **The store refuses a non-finite transform.** `store/transformGuard.ts`'s
  `isSaneTransformWrite` is checked by `updateClipTransform` (and by `updateClip` when the update
  carries a `transform`, the crop gesture's writer) in front of the `set`: `false`, no write, no
  undo entry (the ESCSUITE-87 contract) for any non-finite `x`/`y`/`rotation`/`opacity` or a
  `scaleX`/`scaleY` that is not finite and above zero — the rule `isValidTransform` applies to a
  file.
- **Repair versus refuse.** The app's own state is repaired, untrusted input is refused.
  `ensureTimelineHasTracks` (every `setProject`, the session restore included) replaces a bad
  scale with `1` and a non-finite `x`/`y`/`rotation`/`opacity` with the `DEFAULT_TRANSFORM` value,
  with one `console.warn` naming the clip, so a session saved before this fix restores usable.
  `parseProject` runs **before** the migration and still refuses a `.veditor` or host payload
  with a bad transform exactly as ESCSUITE-173 ruled (`scaleX: null` is still refused), so the
  repair adds no new acceptance there.
