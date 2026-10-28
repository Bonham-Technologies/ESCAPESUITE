<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Testing

- **Unit tests**: Vitest with Testing Library, fake-indexeddb for storage mocking
- **E2E tests**: Playwright with Chromium; CI runs the whole suite on every PR and push
- **Journey tests** (`apps/e2e/tests/journeys/`, also in the normal `e2e` job): `01-record-edit-export` covers record → edit → export across ESCAPECRAFT and ESCAPEARTIST; `02-cut-pauses` (ESCSUITE-351) cuts the pause out of the A/V fixture through the UI (razor, Delete, drag to close the gap), saves, reopens in a fresh context, exports WebM and decodes the export's audio: its length must be the original minus the cut (±1 frame), with no silence over 100 ms and tone on both sides of the join. It runs on the WebM fixture and on its MP4 twin. The timeline, save/reopen, export and audio-analysis helpers it uses live in `apps/e2e/utils/timeline.ts`.
- **E2E retries** (ESCSUITE-352): CI retries a failing test twice, except in the `chromium-strict`
  project, which runs `tests/journeys/**/*.spec.ts`, the ARTIST soaks
  (`tests/escapeartist/*soak.spec.ts`: `soak` and `import-soak`) and
  `tests/regressions/**/*.spec.ts` once with `retries: 0`, keeping the trace and video of a
  failure (the `chromium` project ignores those paths, so each spec runs exactly once). Those specs exist to catch intermittent failures, so a
  pass-on-retry there must fail CI rather than hide. Anything that passes only on retry elsewhere
  is listed in the job summary, as a `::warning` annotation and in the `e2e-flaky` artifact
  (`apps/e2e/scripts/report-flaky.mjs`; details in `ci-cd-pipeline.md`). Running one of those
  specs locally with `--project=chromium` finds nothing: use `--project=chromium-strict`, or no
  `--project`. A new regression spec goes under `tests/regressions/` and is strict automatically.
- **Nightly-only specs** (`@nightly`): a spec too long for the per-PR `e2e` job carries
  Playwright's `{ tag: '@nightly' }` and skips itself unless `E2E_NIGHTLY=1`, so the plain
  `playwright test` CI runs never starts it. The nightly workflow (ESCSUITE-353, not built yet)
  runs them with `E2E_NIGHTLY=1 pnpm --filter=@escapesuite/e2e exec playwright test --grep @nightly
  --project=chromium-strict`. Today: `tests/regressions/ESCSUITE-368.spec.ts`, two 120 s CRAFT
  takes (WebCodecs under CPU ×4, composited PiP through MediaRecorder) and an ESCAPEARTIST export
  of the PiP take, each file's A/V offset read in the browser by `apps/e2e/utils/avSync.ts`
  (`decodeAudioData` beeps against the Mediabunny-decoded frame timecodes of
  `mockSyntheticMedia(..., { markers: true })`); first-to-last beep must move under 50 ms.
- **Production-layout tests**: `apps/e2e/tests/production/` runs against the combined
  `dist/` from `pnpm build:deploy`, served on ONE port by `apps/e2e/scripts/serve-dist.mjs`
  (which mirrors `vercel.json`'s rewrites, and — since ESCSUITE-121 part 2 — reads and sends
  `vercel.json`'s `headers` block too, so the suite runs under the real hosted
  Content-Security-Policy and `X-Frame-Options` rather than none at all; `tests/production/csp-media.spec.ts`
  is the regression test, proving a `blob:` video source survives that CSP in both apps).
  ESCSUITE-240: `vercel.json` gives the hub's content-hashed `/assets/*` chunks
  `Cache-Control: public, max-age=31536000, immutable` (the server keeps a Cache-Control the
  `headers` block sets instead of forcing `no-store`; the craft/artist single files and the
  artist worker chunk live outside `/assets/` and keep Vercel's default), the catch-all excludes
  `favicon\.ico` so that path is a real 404 rather than the hub page (the hub's icon is a `data:`
  URI; no `.ico` ships), and the sitemap lists `/craft/` and `/artist/`. Since
  ESCSUITE-196, `serve-dist.mjs`'s rewrite table is *derived* from `vercel.json`'s `rewrites`
  array (walked in order through the same `source`-pattern matcher the `headers` block already
  used), not a hand-coded copy of it — `tests/production/spa-fallback.spec.ts` and
  `serve-dist.test.mjs`'s drift-guard test are the regression coverage, proving a genuine miss
  reaches `dist/404.html` with a real 404 instead of the hub SPA or a plain-text fallback. That
  is the only setup where CRAFT (`/craft/`) and ARTIST (`/artist/`) share `video-editor-db`,
  so the cross-app IndexedDB tests live there: `pnpm build:deploy && pnpm test:e2e:production`.
  ESCSUITE-234: `vercel.json`'s `redirects` precede its `rewrites` (and the filesystem), and
  `serve-dist.mjs` derives them the same way (308 for the bare paths, query string kept). `/craft` and `/artist` redirect
  to the slashed document instead of being rewritten to it, because the single-file bundle resolves
  its worker chunk against the document URL; a deep extensionless path (`/artist/foo/`) redirects to
  the one document too (temporary, 307, so no browser caches it and a future real sub-route stays reachable), since neither app has client-side routes. Paths ending in a file extension
  are excluded so `/artist/decodeWorker-<hash>.js` is still served as itself
  (`tests/production/slashless-redirect.spec.ts`).
- **Property-based tests**: ESCAPEARTIST's timeline edit logic has a model-based fast-check suite
  (ESCSUITE-349): random edit sequences with invariants checked after every step. What it checks
  and how to add an operation: `apps/artist/docs/reference/testing.md`. PR CI runs 200 sequences on
  a fixed seed; the nightly runs 5,000 on a seed from the run id (`ARTIST_FUZZ_RUNS`,
  `ARTIST_FUZZ_SEED`; ESCSUITE-353).
- **Cross-browser and `@nightly` e2e**: CI runs Chromium only. `E2E_CROSS_BROWSER=1` adds the
  Firefox and WebKit projects under `CI`, and specs tagged `@nightly` run only when `E2E_NIGHTLY=1`.
  The nightly workflow sets both (ESCSUITE-353, `ci-cd-pipeline.md`).
- **Standalone tests**: See [Standalone Test Battery](docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists

Test counts change frequently as coverage grows; run `pnpm test` for the current numbers rather than relying on a count documented here.

## Media-health assertions (ESCSUITE-348)

A visible waveform `<canvas>` with nothing on it, or a preview canvas that stopped repainting,
passes every "is it visible" check. Tests of user-visible media behaviour (waveforms, preview
playback, audio editing, save/load) assert that the media is *alive* instead.

**A/V fixture.** `apps/e2e/fixtures/av/tone-gap.webm` (VP9/Opus) and its H.264/AAC twin
`tone-gap.mp4`: 5 s of 640×360 `testsrc2` at 30 fps (every frame differs) over a 440 Hz tone at
0–2 s, digital silence at 2–3 s and the tone again at 3–5 s. `fixtures/av/make-fixture.sh`
regenerates both. Import them through `AV_FIXTURE_WEBM` / `AV_FIXTURE_MP4`; `AV_FIXTURE_TIMING`
and `AV_FIXTURE_SILENCE` describe the layout; `AV_FIXTURE_SILENCE` is for an untrimmed clip, so a
trimmed clip's window has to be recomputed from its source range. The Chromium Playwright pins
decodes both; the older headless shell (build 1194) preinstalled in some cloud containers has no
H.264/AAC decoder, so there only the WebM can be verified (`tests/media-health/av-fixture.spec.ts`
runs both).

**Helpers** (`apps/e2e/utils/mediaHealth.ts`):

| Helper | Fails unless |
|---|---|
| `expectWaveformDrawn(canvas, { silence? })` | the waveform canvas has pixels drawn and, given a silent window as fractions of the clip's width, draws under a third as much there as in the tone |
| `expectPreviewAlive(page, { forMs })` | while playing, a media element's `currentTime` and presented-frame count (`requestVideoFrameCallback`) advance, the preview canvas repaints, and an unmuted element decodes audio. The caller starts playback |
| `expectPreviewFrameChangesOnSeek(page, seek)` | the seek puts a different picture on the preview canvas within the timeout |

`expectPreviewAlive` needs `installMediaHealthProbe(pageOrContext)` before the page loads: the
preview's `<video>`s are never attached to the document, so the probe records every media element
`createElement` makes. ARTIST plays preview sound by unmuting the element itself, with no Web Audio
graph, so "the audio is running" is checked on the element: playing, unmuted, volume above zero,
decoded audio bytes growing. Chromium decodes a muted element's audio too, so this proves sound is
playing, not that it is the right clip's. `previewCanvas(page)` and
`waveformCanvas(page, clip?)` locate the canvases.

Each helper is pinned by `tests/media-health/self-test.spec.ts` to fail on the case it guards (a
blank canvas, a paused video, a stalled frame callback, a frozen canvas, muted playback, a seek
that paints nothing) beside a healthy control. Change a helper, keep those passing. "Project Save
and Reload" in `tests/integration/workflows.spec.ts` uses the fixture and the helpers on the
reopened project.

## Resource probe and the ARTIST soak (ESCSUITE-350)

A preview that freezes after a while, and recovers on a reload a few times before it stops
recovering, is an exhausted resource. `apps/e2e/utils/resourceProbe.ts` counts the page's scarce
media resources so a test can assert they stay flat.

**Probe.** `installResourceProbe(pageOrContext)` (before the page loads) wraps `AudioContext`,
`OfflineAudioContext`, `VideoDecoder`, `AudioDecoder`, `Worker`, `URL.createObjectURL` /
`revokeObjectURL`, and media elements made by `document.createElement` or `new Audio()`. It
composes with `installMediaHealthProbe`: each wraps whatever `createElement` is when it runs.
`readLiveCounts(page)` forces a full GC through the DevTools protocol (Chromium only) and returns
`{ live, created, liveSites }`, each live resource with the first app stack frame that made it
(line numbers are of the module Vite served, so read the function name). Live means:

| Kind | Live while |
|---|---|
| audio contexts, decoders | reachable and `state !== 'closed'` |
| `worker` | reachable and not `terminate()`d |
| `objectUrl` | not yet revoked |
| `mediaElement` | reachable, with a non-empty `src` attribute or a `srcObject`, and `networkState` not `NETWORK_EMPTY`. Attachment does not matter: ARTIST's preview `<video>`s are never in the DOM. `src = ''` or `removeAttribute('src')` + `load()` releases one |

`installMediaHealthProbe` holds every media element strongly, so with both installed a dropped but
unreleased element keeps counting; that errs towards reporting a leak. `describeGrowth(baseline,
snapshot, allowed)` names each kind past its allowance with its creation sites.
`tests/media-health/resource-probe.spec.ts` pins the probe: every kind counted live, then gone once
released, and a dropped decoder gone once collected.

**Blind spots.** The probe sees the window's globals only. Decoders and blob URLs made inside a
worker are invisible except as that worker's own count, and the app's only `VideoDecoder` is made
in `workers/decodeWorker.ts`. Media elements made by `cloneNode`, `innerHTML` or parsed markup are
not tracked. A worker that ends itself with `self.close()` stays counted live.

**Soak.** `tests/escapeartist/soak.spec.ts` (Chromium) puts the A/V WebM on the timeline twice, on
two tracks at 0 s, so the preview needs the source's own `<video>` and a second-slot one
(ESCSUITE-313). It then runs 25 cycles of {scrub the playhead across the clip, click the ruler at a
seeded random point (`SEED`), play 1 s, pause, Go to start, Undo ×2 and Redo ×2}. The scrub, click
and seek each assert the playhead landed where aimed and no clip moved. The undo/redo takes every
clip off the source, so `usePreviewMedia.ts` revokes its blob URL and empties both elements, and the
redo makes them again: each cycle makes one blob URL and two `<video>`s and releases as many.
After cycle 1 and every 5th cycle it checks `expectPreviewAlive`, then that each live count is at
most its cycle-1 value plus `ALLOWED_GROWTH` (1 per kind; measured growth was 0). Dropping
`video.src = ''` from `releaseExtraVideos` fails it at cycle 5 naming `createPreviewVideoElement`.
A second test reloads 10 times, restores the session from the "Resume Previous Session?" prompt
each time, checks the waveform is drawn and the preview plays, and asserts live counts and every
IndexedDB store's record count stay flat across the reloads. The two run in the normal e2e job,
under 2 minutes together. `SOAK_CYCLES` and `SOAK_RELOADS` raise the counts (the time budgets scale
with them); unset, they are 25 and 10. The nightly (`.github/workflows/nightly.yml`, ESCSUITE-353)
runs 200 and 30; see `ci-cd-pipeline.md`. A failure message lists every count since cycle 1 and where the leaked
resources were made; rerunning replays the same clicks.

**Import soak (ESCSUITE-365).** `tests/escapeartist/import-soak.spec.ts` (Chromium, ~35 s) covers
the way in: 10 cycles of {import the A/V WebM and `fixtures/av/undecodable-opus.webm` as
`audio/webm`, put both on the timeline, Delete both clips, Remove media both files}. The undecodable
file is a sound 2 s WebM whose every Opus packet is invalid (`make-undecodable.mjs` regenerates it),
so its import reads a duration, then the streamed waveform decode errors and the
`decodeAudioData` fallback in `utils/waveform.ts` opens an `AudioContext` that must be closed on the
failure (the ESCSUITE-339 class of leak); each cycle asserts that one was opened. Cycles 5 and 10
also wait for this cycle's autosave (newer than the import), reload with both clips on the timeline
and restore the session before deleting. After cycle 1 and every 2nd cycle every live count must be
at most its cycle-1 value plus 1 (measured: 0 at every check); after a restore cycle it must equal
its cycle-1 value exactly, polled for up to 5 s, since a reload restarts the counts and a
once-per-restore leak would otherwise sit inside the +1. Dropping that `close()` fails it at cycle 4 naming `decodeWholeFileWaveform`.
