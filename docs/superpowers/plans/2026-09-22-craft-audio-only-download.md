# ESCAPECRAFT: audio-only download (ESCSUITE-9, rescoped)

**Goal:** a third download per recording — **M4A** (AAC in an MP4 container, `audio/mp4`,
`.m4a`) carrying only the take's audio — so a mic-only take, or the sound of a mixed take,
comes out as a file audio tools recognise. Today a mic-only take downloads as an audio-only
WebM, which plays but is not an "audio file" to most tools, and `convertToMP4` refuses a take
with no video.

**Spec:** Jira ESCSUITE-9 as rescoped in its 2026-09-17 comment. This plan is the working
authority. The original ticket's second half (mic and system audio as *separate* tracks handed
to ARTIST) is NOT in scope — it needs the recorder to write two audio tracks and is ESCSUITE-14's
shape; say so in the PR.

## Global constraints

1. One branch (`feat/craft-audio-download`), one PR, changeset `@escapesuite/craft: minor`.
2. Coverage floors craft 100/99/96/99 hold; every new line and branch executes in a test.
3. Red-then-fix; pre-existing tests byte-unchanged where the change is a pure move (the audio
   encode loop lifted out of `convertToMP4` — `converter.test.ts` must show additions only for
   the MP4 half, and `converter.perf.test.ts`'s existing MP4 ceilings must not move).
4. Mirror the MP4 download exactly in shape: same "say why, do not hide" gating, same one-at-a-
   time slot, same progress row and Cancel, same notice channel, same `aria-describedby` note.
   Nothing new is invented where the MP4 path already has an answer.
5. Docs in the same PR: `apps/craft/CLAUDE.md` "Download Formats" (two options → three), root
   `CLAUDE.md`'s ESCAPECRAFT "Two downloads per recording" bullet, and the protocol doc comment
   needs nothing (no host message). Lint + typecheck clean (craft, e2e).
6. Commit trailers as given in the dispatch. No push, no PR.

## Task 1 — converter: `convertToM4A`

`apps/craft/src/core/converter.ts`:
- **Pure move first** (own commit, `refactor(craft):`): lift the AAC encoding loop out of
  `convertToMP4` (the `samplesPerChunk = 1024` loop that builds planar `AudioData`, encodes,
  checks abort every 100 chunks, then flushes) into a private
  `encodeAudioChunks(audioData, audioEncoder, signal, onProgress)`; `convertToMP4` calls it. The
  MP4 unit tests and `converter.perf.test.ts` are byte-unchanged and green at that commit.
- **`convertToM4A(webmBlob, onProgress: ProgressCallback, signal?): Promise<Blob>`** (own commit):
  `extractAudio` → `null` ⇒ throw `new Error(M4A_NO_AUDIO_MESSAGE)` where
  `export const M4A_NO_AUDIO_MESSAGE = 'This recording has no audio track'`; AAC unsupported per
  `AudioEncoder.isConfigSupported(MP4_AUDIO_ENCODER_CONFIG)` ⇒ throw with `MP4_NO_AUDIO_REASON`'s
  text (the probe's sentence — one wording); otherwise `Output` with
  `new Mp4OutputFormat({ fastStart: 'in-memory' })`, ONLY `addAudioTrack(new
  EncodedAudioPacketSource('aac'))`, encode via the shared loop with progress mapped 15→95,
  `finalize`, `new Blob([target.buffer], { type: 'audio/mp4' })`. Abort: `checkAborted(signal)`
  before encoding and inside the loop as today; `ConversionAbortedError` on cancel; encoder closed
  in `finally`. Progress phases: `preparing` ("Extracting audio…"), `encoding` ("Encoding
  audio…"), `finalizing`.
- Tests (`converter.test.ts`, red first): produces a Blob of type `audio/mp4` with an audio track
  and NO video track added (`output.addVideoTrack` never called — the Mediabunny double records
  it); one `encode` per 1024-sample chunk and one `flush`; throws `M4A_NO_AUDIO_MESSAGE` when
  `extractAudio` yields null; throws the AAC reason when unsupported; rejects with
  `ConversionAbortedError` on an aborted signal; progress reaches 100.
- `converter.perf.test.ts`: a new `describe` for M4A — exact conservation: one `encode` per
  1024-sample chunk for a 2 s stereo buffer (⌈96000/1024⌉ = 94), one `flush`, zero
  `VideoEncoder`s constructed, zero `drawImage`.

## Task 2 — hook, UI, e2e, docs

- `hooks/useMp4Download.ts` gains a format: `startMp4Download(id, name, format: 'mp4' | 'm4a' =
  'mp4')`; `Mp4Conversion` gains `format`; the one-at-a-time slot is shared (an M4A running
  blocks MP4 and vice versa, `MP4_BUSY_REASON` for both). For `'m4a'`: call `convertToM4A`,
  download as `<name>.m4a`, on success `setNotice(null)`, failure → `mp4ConversionFailed(...)`
  (rename to a neutral wording? NO — keep the constant, but its text becomes
  `Conversion failed: <message>`; update its test). An M4A on a browser with no AAC is BLOCKED
  (unlike MP4, where AAC is optional): expose `m4aBlockedReason` = `MP4_CHECKING_REASON` while
  checking, `mp4Support.reason` when `!mp4Support.audio` (the probe's AAC sentence), else the
  shared busy reason. Keep every existing export and its behaviour; existing tests unchanged
  (additions only).
- `RecordingsList`: a third button `M4A` (class `mp4Button`, `title` "Download audio only
  (M4A)" or the blocked reason, `aria-label` `Download <name> as audio (M4A)`), between MP4
  and Upload/Editor; `disabled` when `converting !== null || m4aBlockedReason !== null ||
  !recording.hasAudio` — for a take with no audio the `title` is
  `'This recording has no audio'` (export the constant from the component file or `notices`?
  — it is a button reason, so beside the gate: export `NO_AUDIO_TRACK_REASON` from
  `useMp4Download.ts`). New props `m4aBlockedReason`, `onDownloadM4a`. The progress row is the
  same row; its message comes from the converter. `aria-describedby` points at the same note
  when the note applies to M4A too (the AAC sentence does).
- `RecordingsListPanel` wires `onDownloadM4a={(id, name) => void startMp4Download(id, name,
  'm4a')}` and `m4aBlockedReason`.
- Tests: `useMp4Download.test.ts` (m4a path: calls `convertToM4A`, downloads `.m4a`, blocked
  reasons, shared slot), `RecordingsList.test.tsx` (button present, labels, disabled for
  `hasAudio: false` with the reason, disabled while converting), `RecordingsListPanel.test.tsx`
  (wiring). `App.mp4rerender.test.tsx` must still pass unchanged.
- e2e `apps/e2e/tests/escapecraft/m4a-download.spec.ts`, mirroring `mp4-download.spec.ts`:
  record a take (mic is on by default → `mockSyntheticMedia`'s oscillator gives it audio),
  click `Download <name> as audio (M4A)`, expect a `.m4a` download; read the file and assert it
  decodes: in-page `new AudioContext().decodeAudioData(bytes)` yields `duration > 1`. Skip via
  `canConvertToMp4`-style probe extended for AAC (add `canEncodeAac(page)` beside it in
  `utils/webcodecs.ts`). A no-audio case: switch the Microphone toggle off before recording (a
  screen-only take with no audio) and assert the M4A button is disabled with the no-audio title.
- Docs: `apps/craft/CLAUDE.md` "Download Formats" → three options, the M4A rules (AAC is a
  hard requirement here, no-audio disables, shared slot); root `CLAUDE.md` bullet. Changeset.

## Verification

craft `test:coverage` (floors), lint, typecheck; e2e lint + typecheck; the two craft e2e specs
(`mp4-download`, `m4a-download`) green against dev servers you start from this worktree
(check `lsof -nP -iTCP:5174 -iTCP:5175 -sTCP:LISTEN` first).
