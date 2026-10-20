<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# WebM Handling
- MediaRecorder produces WebM without proper seek metadata
- `webm-duration-fix` library adds Duration, SeekHead, and Cues elements — but its Cues index
  only video **SimpleBlocks** (one CuePoint at the first video SimpleBlock of each cluster,
  keyframe or not), so `fixWebMMetadata()` follows it with **`core/webmCues.ts`'s
  `writeKeyframeCues()`**, which replaces that Cues element with **one CuePoint per video
  keyframe** (ESCSUITE-322). Why it matters: Chrome's MediaRecorder writes every frame of the
  compositor's alpha-VP9 canvas stream as a **BlockGroup** (the alpha plane rides in
  BlockAdditions), so the library alone stored every composited-PiP take with an **empty** Cues
  element (`1c53bb6b 80`). Chromium's `<video>` scans such a file and seeks it anyway; Firefox's
  seek into a cluster that does not open on a keyframe never fires `seeked` — Chrome starts a
  cluster about every second whatever the keyframes — so an ESCAPEARTIST export of the take on
  Firefox drew black frames and its import thumbnail hung (ESCSUITE-305, whose own half is
  ARTIST's). ESCSUITE-305 measured the cure: the same bytes with a keyframe index written into
  the same place seeked 48/48 on Firefox, and that index is what this step writes. It is pure
  bytes, once per save: one forward pass over the Segment, read in 1 MiB windows
  (`CUES_READ_WINDOW_BYTES`). Frame payloads are not parsed, only element and block headers, but
  they are still read, so the pass costs about one 1 MiB read per MiB of file (a 56 MB take is
  about 56 reads). It notes each keyframe — a SimpleBlock with the keyframe flag, or a BlockGroup
  with no ReferenceBlock — walking an unknown-size Cluster until the next level-1 (four-byte) ID,
  not only the next Cluster, which is the spec's rule — then rewrites the Cues element in place (CueTime, CueTrack,
  CueClusterPosition, CueRelativePosition, each at a fixed 8-byte width) and hands every other
  byte, alpha included, on as a `slice()` of the input. It leans on `makeMetadataSeekable`'s fixed
  output shape — an unknown-size Segment, the Cues ahead of the first Cluster, and every SeekHead
  entry pointing at or ahead of the Cues — so growing the Cues moves every Cluster by exactly its
  growth and nothing else; **each of the three is checked**, and a file that breaks one is
  refused rather than given silently wrong positions. A take with no video track (microphone
  only) is handed back as the library left it. A video file with no Cues element, one in which no
  keyframe is found (which would otherwise be stored with the very empty index this replaces), or
  one with an invalid EBML element header (an ID over four bytes or a size over eight) throws too;
  every such refusal is reported by the save as `NOT_SEEKABLE` like any other failed repair. Mediabunny's packet-copy remux was the other
  option and was not taken: it would rebuild every block, and whether it keeps the alpha
  BlockAdditions byte for byte is exactly what a rewrite of the Cues alone never has to prove.
  Takes stored before this carry the empty Cues; nothing repairs them in place
- Thumbnails captured from live preview (more reliable than from blob)
- Metadata extraction has fallbacks for problematic WebM files
- **The repair runs on MediaRecorder output only**, once, at save time.
  `useRecordingSave` branches on `recorderTypeRef`: a `'webcodecs'` take is written through
  untouched, because `WebCodecsRecorder` muxes with Mediabunny, which already emits Duration
  and Cues. Everything else — composited PiP takes, audio-only takes, and any browser without
  WebCodecs
  — goes through `fixWebMMetadata()` first. Either way what reaches storage is seekable, but
  only one of the two paths repairs anything; a take that will not scrub is a question about
  *which recorder produced it* before it is a question about the repair
- The playback dialog fixes nothing either. It passes the saved duration to `VideoPlayer` as
  `knownDuration`, which the player falls back to when `video.duration` is `Infinity` or 0
- A repair that fails still saves the raw blob, and raises the `NOT_SEEKABLE` notice. That
  path exists only for MediaRecorder takes, for the same reason
- **The import of `webm-duration-fix` is resolved by hand**, and has to be. The library is
  CommonJS: `lib/index.js` ends `exports.default = fixWebmDuration` and sets `__esModule`, so
  what a default import binds to is a toolchain decision — esbuild's `__toESM(mod, 0)` (Vite 7
  and earlier) honours `__esModule` and binds the **function**, while Vite 8, which moved both
  dep optimization and the build to Rolldown, follows Node and binds the whole **`module.exports`
  object** (its `legacy.inconsistentCjsInterop` flag is the opt-out, documented against
  "pre-Vite 8" behaviour — i.e. this arrived with the **7 → 8 major**, commit `7c40710`,
  2026-03-14, first released here as craft 2.1.0; 8.3.0 is merely what it was found and fixed
  under, so every craft release 2.1.0–2.5.1 shipped it). It turned every MediaRecorder save into
  `TypeError: fixWebmDuration is not a function`, caught by `useRecordingSave`, `NOT_SEEKABLE`
  raised and the take stored unrepaired — in the dev server *and* in the shipped build; takes
  already saved that way are not repaired retroactively. `converter.ts`'s exported
  `resolveFixWebmDuration()` unwraps **one** level of `default`, which is every shape a *default*
  import produces; it is not a general interop shim (Vite's namespace helper double-wraps, so an
  `import * as` here would need a loop). No unit test can see the problem: they all
  `vi.mock('webm-duration-fix')`, and vitest's own pipeline resolves the default the old way.
  The guard is therefore a browser test — `apps/e2e/tests/escapecraft/pip-seekable.spec.ts`
  against the dev server and `apps/e2e/tests/production/pip-seekable.spec.ts` against the
  combined `dist/` — which records a real **composited PiP** take (the only mode that reaches
  MediaRecorder in Chromium, and still what a PiP take is unless the separate-tracks toggle is
  on) and requires the stored blob to report a finite `duration` in a `<video>`.
  `src/core/converterInterop.test.ts` imports the real module and pins both arms of the
  resolver; `src/core/webmRepair.test.ts` runs the real library over hand-built containers
  (`src/test/webmFixture.ts`) and then the keyframe Cues step, on Node's Blob with Node's
  `Buffer` pool switched off — jsdom's Blob cannot stream, and under Node the library's output
  head is the `.buffer` of a pooled `Buffer`, which a browser's `buffer` polyfill never pools. The
  same specs also read the stored take's Cues in the page: present, non-empty, and one CuePoint per
  video keyframe found walking its clusters
