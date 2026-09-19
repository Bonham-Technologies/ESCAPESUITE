# ESCAPEPOD upstream requests — the three open rows

**Goal:** land the three ESCAPEPOD asks that still need SUITE code, so POD can delete its
`suite-patches/03`, `05` and `07` on its next `make suite-sync`.

**Spec:** the POD `UPSTREAM-REQUESTS — ESCAPESUITE` table (operator-supplied, 2026-09-18).
Its rows, and their status in this repo as of main 16a4043:

| # | App | Ask | Status here |
|---|-----|-----|-------------|
| 1 | artist | `EXPORT_COMPLETE {blob, format, name}` to `window.parent` after export | **Landed** in #320 (4ef632c, 2026-09-08): `ExportDialog.tsx` sends it via `sendMessage`; proved by `apps/e2e/tests/integration/host-embedding.spec.ts`. POD's row is stale — no work. |
| 5 | shared | `editorUrl` + `hostMode: 'embedded'` in shared config | **Covered**: `isEmbedded()`, `editorUrl()`, `parseHostOrigin()` exist in `packages/shared/src/config`. The row itself says it may not be worth chasing; no `hostMode` constant is added — two call sites doing `parseHostOrigin() ?? '*'` is not yet a pattern. No work. |
| 6 | craft | Per-recording "Upload to host" posting `{type:'UPLOAD_RECORDING', payload:{id,name,blob}}` when embedded | **Task 1** |
| 8 | craft | `WebCodecsRecorder` stamps frames with recorded wall-clock time, not `frameCount × 33333 µs` | **Task 2** |
| 9 | artist | `extractVideoMetadata` seek-to-end fallback when `video.duration` is `Infinity` / `0` | **Task 3** |

## Global constraints

1. **Each task is its own branch and PR** (`feat/craft-upload-to-host`, `fix/craft-recorder-wall-clock`,
   `fix/artist-duration-fallback`), each with its own changeset (`.changeset/<slug>.md`;
   craft/artist/plan are linked, so one bump moves all three — that is expected).
2. **Coverage floors only go up**: craft 100/99/96/99, artist 99/98/93/98. Every new line and
   branch is executed by a test. Run the package's `test:coverage` and read the summary.
3. **Red-then-fix for behaviour changes**: the test that pins the new behaviour is written and
   seen failing before the code changes. Existing tests that pinned the OLD behaviour (e.g.
   `frameCount × 33333`) are updated, with a comment saying what they pin now.
4. **Docs in the same PR**: the protocol doc comment at the bottom of
   `apps/artist/src/utils/integration.ts` (the one file describing the whole cross-app protocol),
   `apps/craft/CLAUDE.md`, `apps/artist/CLAUDE.md`, root `CLAUDE.md` "Integration API" — whichever
   the task touches.
5. Lint + typecheck clean for the package (`pnpm --filter @escapesuite/<pkg> lint`, `typecheck`).
6. Commit trailers on every commit (given in the dispatch). No push, no PR — the controller does that.

## Task 1 — CRAFT: "Upload to host" (row 6)

**What:** an embedded-only, per-row action in the recordings library that hands the stored
blob to the host page. Standalone CRAFT never shows it (a host is the only thing that could
receive it).

- `apps/craft/src/utils/uploadToHost.ts` (new), mirroring `sendToEditor.ts`:
  `uploadToHost(id: string, name: string): Promise<'posted' | 'missing'>` — `getVideoBlob(id)`
  from `core/storage`; `null` → `'missing'`; otherwise
  `window.parent.postMessage({ type: 'UPLOAD_RECORDING', payload: { id, name, blob } }, parseHostOrigin() ?? '*')`
  and `'posted'`. The blob goes by structured clone (a `Blob` is cloneable; no `arrayBuffer()`
  copy). No analytics event.
- `RecordingsList` gets an optional prop `onUploadToHost?: (id: string, name: string) => void`.
  The button renders only when the prop is present — the component stays props-only (its test
  asserts that; do not import `isEmbedded` there). Button: `className={styles.iconButton}`,
  `title="Upload to host"`, `aria-label={`Upload ${recording.name} to host`}`, a new
  `UploadIcon` in `components/icons.tsx` (add it to `icons.test.tsx` like its siblings), placed
  between the MP4 button and "Open in Editor".
- `RecordingsListPanel` decides: `const embedded = isEmbedded()` (from
  `@escapesuite/shared/config`, computed once per render — it is a cheap comparison) and passes
  `onUploadToHost` only when embedded. The handler awaits `uploadToHost`; `'missing'` raises the
  app's one notice channel: new constant in `utils/notices.ts`,
  `UPLOAD_UNAVAILABLE = 'That recording could not be read from your library — nothing was sent to the host.'`
  (follow the file's doc-comment convention). `setNotice` is already selected in the panel.
- Tests: `uploadToHost.test.ts` (posts the blob with the id and name; addresses `?hostOrigin=`
  when valid, `'*'` otherwise; `'missing'` and no post when the blob is absent);
  `RecordingsList.test.tsx` (no button without the prop; button with it, labelled by name, calls
  the prop with id and name); a panel-level test (mock `isEmbedded` from
  `@escapesuite/shared/config` the way the existing `sendToEditor` tests do — find them with
  `grep -rn "isEmbedded" apps/craft/src --include='*.test.*'`): embedded → button present and a
  click posts; not embedded → absent; `'missing'` → notice set.
- e2e: `apps/e2e/tests/integration/host-embedding.spec.ts` gains one test next to the
  `SEND_TO_EDITOR` one: after recording a take in the framed CRAFT, click
  `Upload <name> to host`; the host receives `UPLOAD_RECORDING` whose payload has the id, the
  name and a `Blob` with `size > 0` (the harness's `waitForHostMessage` records messages —
  extend the host page's listener to report `payload.blob instanceof Blob` and `payload.blob.size`
  if it does not already serialise them). Standalone absence is covered by the unit test.
- Docs: the CRAFT → host list in `integration.ts`'s doc comment; `apps/craft/CLAUDE.md`
  "Embedding" section (the button is the third and last host-routed action; "Open Editor" stays
  un-routed); root `CLAUDE.md` Integration API bullet after `CRAFT → host`.
- Changeset: `@escapesuite/craft` **minor** — "Recordings can be uploaded to an embedding host".

## Task 2 — CRAFT: wall-clock frame timestamps (row 8)

**Why (from the row):** `getDisplayMedia` does not guarantee 30 fps — window and screen capture
often deliver 5–15 fps. Counter-based timestamps make N frames span N × 33.3 ms regardless of
when they were captured, so a 60 s take at 15 fps produces a 30 s video track against a 60 s
audio track: playback at 2×, audio lagging.

**What:** in `apps/craft/src/core/webcodecs-recorder.ts`, every encoded `VideoFrame`'s
`timestamp` is the recording clock at capture — elapsed since `start()`, paused time excluded —
on all three capture paths (`startTrackProcessorCapture`, the `requestVideoFrameCallback` loop,
the `setTimeout` loop). One private helper decides timing for all three:
`private nextFrameTiming(): { timestamp: number; keyFrame: boolean }`.

- **Clock:** `performance.now()` throughout — `startTime`, `pauseStartTime`, `pausedDuration`
  move off `Date.now()` so `getDuration()` and the timestamps read one monotonic clock.
  `timestamp = Math.round((performance.now() - startTime - pausedDuration) * 1000)` µs.
- **Monotonic guard:** if the computed timestamp is `<=` the previous frame's, use previous + 1.
  Mediabunny requires strictly increasing timestamps and a frozen or coarse clock must not
  break the mux.
- **Keyframes by time, not count:** `keyFrame = timestamp >= nextKeyFrameUs`, then
  `nextKeyFrameUs = timestamp + 1_000_000`. First frame is a keyframe (initial `nextKeyFrameUs = 0`).
  The old `frameCount % frameRate === 0` gave one keyframe per 30 frames, which at 10 fps is one
  every 3 s.
- Keep the fallback paths' `duration: frameDurationUs` on the `VideoFrame` (nominal; the muxer
  derives packet durations from timestamps). Keep `frameCount` for the perf ceilings and stats.
- The `MediaRecorder` path (`recorder.ts`) is untouched — MediaRecorder stamps its own frames.
- Tests (`webcodecs-recorder.test.ts` spies `performance.now` to a frozen `now`; advance it
  per test): the test "advances the frame timestamp by one frame duration each time" becomes
  "stamps each frame with the recording clock" (advance `now` 33.33 ms per tick → 0, 33333,
  66667 — note the rounding); NEW: a 15 fps source (advance 66.67 ms per frame → 0, 66667,
  133333: the frames span wall time, the row's bug); paused time is excluded (pause, advance
  5 s, resume, next frame continues from where it left off); keyframes once per elapsed second
  (frames at 0, 400, 800, 1200 ms → key at 0 and 1200 only); strictly increasing under a frozen
  clock (0, 1, 2); `getDuration()` reads the same clock. The track-processor test that pins the
  0.8× throttle stays as is. `webcodecsRecorder.perf.test.ts` (encodes/frames/flushes per take)
  must not move.
- Docs: `apps/craft/CLAUDE.md` — wherever the recorder's timestamps or keyframe cadence are
  described (`grep -n "keyframe\|33\|timestamp" apps/craft/CLAUDE.md`); root `CLAUDE.md` has no
  line on this.
- Changeset: `@escapesuite/craft` **patch** — "WebCodecs recordings keep A/V sync at capture
  rates below 30 fps".

## Task 3 — ARTIST: duration fallback (row 9)

**Why (from the row):** a WebM without a Duration/Cues element (raw MediaRecorder output, or a
CRAFT take whose `fixWebMMetadata` failed) reports `Infinity` on `loadedmetadata`, so ARTIST
accepts the file but the `SourceVideo` and every clip built from it carry `duration: Infinity`.

**What:** in `apps/artist/src/core/videoProcessor.ts` `extractVideoMetadata`, when
`loadedmetadata` reports a duration that is not finite or is `<= 0`, seek to the end to make the
browser discover it: set `video.currentTime = Number.MAX_SAFE_INTEGER` (browsers clamp; Chromium
scans the container and fires `durationchange` with the real value), listen for `durationchange`
and `seeked`, and resolve with the first finite positive value of `video.duration`, else of
`video.currentTime` after the seek (the clamped end). If neither arrives within 5 s, reject with
`Could not determine the duration of <name>` — a rejection surfaces through the same path a
failed load does today, and is more honest than a clip that is infinitely long. A finite
duration on `loadedmetadata` takes the existing path with no seek (assert `media.seeks` is
empty for that case). Always revoke the object URL, on every path.

- `processVideoFile` passes the thumbnail time explicitly:
  `generateThumbnail(file, metadata.duration * 0.1)` — `generateThumbnail` loads its own element
  and would otherwise compute `Infinity * 0.1` itself.
- Test double: `apps/artist/src/test/doubles/media.ts` gains `VideoScript.durationAfterSeek?:
  number` — when set, assigning `currentTime` updates the element's `duration` to it and
  dispatches `durationchange` before `seeked` (microtask, like the existing `seeked`). Document
  the field in the double's header comment.
- Tests (`videoProcessor.test.ts`): `Infinity` → resolved duration is `durationAfterSeek`, one
  seek requested, URL revoked; `0` → same; `Infinity` with `stallSeek` → rejects after the
  timeout (fake timers) with the message; finite → no seek; the `seeked`-only path (double with
  `durationAfterSeek` unset but `duration` still Infinity → falls back to `currentTime`, which
  the double reports as the assigned value — decide whether that case is reachable in the
  double and either test it or make the double clamp; say which in the report);
  `processVideoFile` passes `duration * 0.1` to `generateThumbnail`.
- Docs: `apps/artist/CLAUDE.md` where media import / `videoProcessor` is described; the
  protocol doc comment needs nothing.
- Changeset: `@escapesuite/artist` **patch** — "Imported WebM files without a duration header get
  their real length instead of Infinity".

## Verification per task

`pnpm --filter @escapesuite/<pkg> test:coverage` (floors hold, read the summary), `lint`,
`typecheck`; Task 1 also `pnpm --filter @escapesuite/e2e exec playwright test host-embedding`
against dev servers (`pnpm dev:craft` + `pnpm dev:artist` — the spec's config starts them).
