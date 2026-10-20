<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# A take can be several files

**Storage.** `SourceVideo` (`packages/shared/src/types`) carries five optional fields for this
(ESCSUITE-14): `takeId`, `role: 'screen' | 'webcam' | 'mic' | 'system'`, `startOffset` (seconds),
`hasWebcam`, and — on the primary only — `overlayPlacement: { position, size, shape }` copied from
the `RecordingConfig` at save time, which is the geometry ARTIST seeds the webcam clip's
transform from (slice 2) and the composite MP4 draws through (slice 4, see
"The composite MP4" under "Download Formats"). All optional, so
**`DB_VERSION` stays 1** and a take stored before this keeps behaving as a single file. **The take
is named by its primary**: the primary's `takeId` is its own id, so grouping is one equality and
the cascade delete is `takeId === deletedId` minus the row already being deleted. A plain take is
stored with *no* companion keys at all — absent, not `undefined`, because `buildSourceVideo`
spreads each one in only when it is given it — so a reader cannot mistake one for the other. `hasAudio` is per part, and since slice 3 it genuinely differs across one take: the primary
carries the mix (`true` whenever the take had any sound), the webcam part is `hasAudio: false`
because the whole mix stays on the primary output, and each audio part is `hasAudio: true` with
`hasWebcam: false`. An audio part is stored as **audio** — `mediaType: 'audio'`, `frameRate: 0`,
`width`/`height` 0, `mimeType 'audio/webm'` — which is the same shape ESCAPEARTIST's own audio
importer writes (`core/videoProcessor.ts`), so a part that arrived from a recording is
indistinguishable from one that arrived from a file everywhere the editor branches on
`mediaType`. It gets **no thumbnail**: there is nothing to decode, so `getThumbnail` resolves
`undefined`, the library draws its own empty placeholder, and ARTIST already treats a missing
picture as cosmetic. **Its duration is its own, not the take's** (ESCSUITE-318), because the
parts of a take are not necessarily the same length: a companion whose track ends mid-take — a
microphone unplugged, a system-audio share stopped — is finalised early and its file stops there.
`WebCodecsRecorder` tracks, per audio pipeline, where the last `AudioData` it encoded ends (its
stamp plus its length, `encodedEndUs`) and delivers that on the part as `CompanionPart.duration`,
in seconds. Both capture paths stamp *recorded* time — the AudioWorklet from the render position
of each recorded span, cut at `stop()` or at the track's end; the ScriptProcessorNode fallback
from the samples it counted while recording, plus any silence ESCSUITE-296's gap filler encoded —
so a pause is out of the figure exactly as it is out of the primary's, at the context's own rate
(a 44.1 kHz context is pinned). A part that ran to the end is cut at the render frame where
`stop()` was entered, while the primary's `recordedDuration` is read from `getDuration()` only
after the encoders have flushed and the outputs finalised (`onStop` in
`useRecordingController.ts`), so a full-length audio part is stored a little *shorter* than the
primary — by the stop-and-flush latency, tens to a few hundred milliseconds — and never longer;
its figure is the length its file holds. `useRecordingSave` stores `companion.duration ?? recordedDuration`: the recorder
reports one, always positive, for every audio part it delivers (a pipeline that encoded nothing
is never delivered), and the take's length is the fallback for a caller that hands a part over
without one. Which part carries which figure: the **primary** is stored at the take's
`recordedDuration` (or its probed file length, as ever); a **mic or system part** at its own
encoded length; the **webcam part** at its probed file length, falling back to the take's — it
carries no `duration` from the recorder, because its file is decoded for its thumbnail anyway.
Before this, every audio part was stored at the take's wall-clock length, so ESCAPEARTIST (which
trusts the stored figure, `app/takeImport.ts`) placed a clip of the take's length over a shorter
file and the library row showed the take's length — measured, a microphone that went at ~1.5 s of
a 6.5 s take was stored at 6.51 s over a 1.48 s file. Pinned by
`core/webcodecsRecorder.companionDuration.test.ts` (both capture paths: an unplugged microphone,
a whole take, a paused take; the fallback at 44.1 kHz too), `useRecordingSave.test.ts`, ARTIST's `takeImport.test.ts`, and the
Playwright `escapecraft/separate-tracks-companion-duration.spec.ts`. Since ESCSUITE-143 the *primary* of a take recorded with
no picture at all — Screen and Webcam both off — is stored the same way, with no role and no
companions: `mediaType: 'audio'`, `frameRate: 0`, 0x0, no thumbnail, the recorder's own duration
(see "the same boolean" under "Choosing a recorder"). The one field that does *not* match a
companion's is `mimeType`: this take still goes through MediaRecorder, whose container mime is
`getSupportedMimeType()` — `video/webm;codecs=vp9,opus` (`core/permissions.ts`) — whatever tracks
are actually in the stream, where a mic/system companion is written by Mediabunny as `audio/webm`.
Harmless — nothing in either app branches on `mimeType` to decide audio-vs-video, ARTIST reads
`mediaType` — but worth naming so "stored the way a companion already is" is not read as true of
every field.

A webcam part's thumbnail write is cosmetic as well (ESCSUITE-224): if it rejects (a quota error right after the video write), the part is still listed with the placeholder tile and still deleted with its take; `SEPARATE_TRACK_NOT_SAVED` is reserved for a part whose bytes were not stored.

Each part's stored `name` is the take's name with its part named: `Recording <date> — webcam`,
`— microphone`, `— system audio`. That is what its own WebM download is called and what ARTIST
shows as the source's name. Those nouns, and every sentence that can be said about a part going
wrong, come from `utils/companionParts.ts`.

`hasWebcam` is the field that retired the `hasWebcam: false // TODO` in `loadRecordings`: nothing
stored said whether a take had a camera in it. It is written from the config by `buildSourceVideo`
exactly as `hasAudio` has been since ESCSUITE-60, and read back as `m.hasWebcam ?? false` for
records saved before it. Nothing is gated on it, so the fallback costs a legacy row nothing.

**Library.** `loadRecordings` mints one thumbnail object URL per recording, and revokes the
outgoing set once the read has actually resolved and the new set exists to replace it
(so a failed reload does not revoke URLs the library is still showing); `removeRecording`
revokes the one URL a deleted recording carried, the same way (ESCSUITE-103) — neither used
to, and a URL outlived the recording it named for the life of the tab. `loadRecordings`
orders through `orderTakes` (`utils/takeOrder.ts`): newest take
first, a take's companions directly under its primary (placed by the primary's date, never by
their own — every part of a take is saved with one `now` and the companions are written first, so
by date alone a webcam row would float above the screen row it describes) and **ranked by role**
rather than by date — webcam, then mic, then system, with an unrecognised role last — because
three companions sharing one millisecond would otherwise come out in whatever order storage
returned them, which is uuid order. Date is the second key and the id the third, so the answer
never depends on what the engine's sort happened to do. An orphan companion is still shown,
because a row nobody can see is a file nobody can delete. Within the session that recorded it the
same order comes out of the save path instead: the companions are `addRecording`ed **first and in
reverse role order**, and `addRecording` prepends, so the list ends up
`[primary, webcam, mic, system]` either way.

Every companion row's meta line is prefixed with the track it is: `Webcam track • `,
`Microphone track • `, `System audio track • `. Each is playable, WebM-downloadable and deletable
on its own, and carries **no** MP4 and **no** M4A — not even M4A on an audio row, because that
row's own bytes are already an audio file and a per-part conversion would be the take's own
composite pretending to exist. "Open in Editor" on any row hands over `takeId ?? id`, i.e. the
take — unless a row's `takeId` names no row actually in the list (ESCSUITE-145): the primary can
be gone, deleted from ARTIST's media library in another tab, while an orphaned companion is still
shown here (a row a user cannot see is a file they cannot delete). `RecordingsList` checks the
whole list rather than trusting a row's own `takeId`, and an orphan falls back to its own id — the
same degradation `takeImport` already gives a non-primary id: imported and placed alone. Play and
Download on any row whose bytes are no longer in storage do something rather than nothing — see
`RECORDING_UNAVAILABLE` under "Errors and notices" (ESCSUITE-146), which is not specific to a
companion row. Deleting the
primary deletes its companions (`useRecordingLibrary.handleDeleteRecording`);
deleting the companion alone **demotes the primary by construction** — its own `takeId` stays,
and with nothing grouped under it the row renders as a plain take, so no stored metadata is
rewritten on a delete.

**MP4 and M4A cover the whole take.** MP4 re-composites it (see "The composite MP4" under
"Download Formats") and M4A always did, because the mix is on the primary. The interim note
that said otherwise — `SEPARATE_TRACKS_MP4_NOTE`, "MP4 and M4A cover the screen track only
— the webcam track is not included yet." — is **retired**, along with the per-row
`aria-describedby` target it needed and the per-render set of takes-with-a-camera that was its
only reader, because both halves of that sentence became false. The conversion buttons are
described by the app-wide `mp4Note` alone again (`MP4_NOTE_ID`, one id rather than a
space-separated list). The one case where a file really is missing the camera is a fact about a
file the user already has and goes through the notice channel as `MP4_SAVED_WITHOUT_WEBCAM`, not
as a standing claim on a row. Its four tests were **converted rather than deleted**: three assert
there is no such note on exactly the rows that used to carry one, and the one that pinned two
`aria-describedby` ids now pins the single id. Nothing about the buttons' placement changed: MP4
and M4A are still the take's downloads and still live on the primary row only, and every part is
still reachable on its own through Download WebM on its row.

**`UPLOAD_RECORDING` carries the take.** The primary row's message gains
`payload.parts` — `[{ id, role, name, blob, startOffset }]` for every file of the take, the
primary included, primary-first then camera then sound (`utils/takeParts.ts`
`loadTakeParts`). `payload.blob`, `payload.id` and `payload.name` are still the **primary's**,
so a host that knows nothing of takes receives exactly the `{ id, name, blob }` it always
did, and `role`/`takeId` are still added only when the row has them. The trigger is
`part.takeId === id`, which is precisely "this row *is* the take" — a primary carries its own
id as its `takeId` — so `RecordingsListPanel` needed no change and a **companion** row still
posts itself alone, with no `parts`. `parts` is **omitted** for a take that is one file: a
one-element list holding the same Blob as `payload.blob` names nothing the host does not
have. A part whose bytes are gone is left out rather than listed empty. The primary's bytes are
read **once** — `uploadToHost` already holds them to decide there is anything to post at all, and
hands them down as `loadTakeParts(id, { primaryBlob: blob })`, so `payload.blob` and `parts[0].blob`
are one `Blob` object in two places rather than two deserialisations of the take's largest file.
A `loadTakeParts` that throws downgrades the message to the one slice 1 sent, with a
`console.warn` and no notice: a companion never costs the primary the upload the user asked for.
The companion rows keep their Upload button: redundant for a host that adopted `parts`, and the
only way one that has not can be handed a single part. The adoption note for embedders is in the
root `CLAUDE.md` Integration API and in `apps/artist/src/utils/integration.ts`; the ESCAPEPOD
upstream-requests page has its own row.
