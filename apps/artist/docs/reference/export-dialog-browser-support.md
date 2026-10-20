<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Export Dialog Browser Support (`src/components/Export/ExportDialog.tsx`, `src/core/exportTypes.ts`)

`isMP4ExportSupported()` and `isWebMExportSupported()` are both real asynchronous probes resolving
the same `ExportFormatSupport` — `{ video, audio }` — since ESCSUITE-175. Before it, MP4's answered
from globals alone and WebM's answered the video half only. GIF is the third format and has **no
predicate at all**:

- **`isMP4ExportSupported(width, height)`** resolves `{ video: boolean; audio: boolean }`
  (ESCSUITE-175). `video` is whether any of `mp4VideoCodecConfigs`' ten H.264 candidates —
  three profiles at Level 4.0/3.1 then two at Level 5.1, each tried `prefer-hardware` first and
  `no-preference` second — can be configured at the output size, asked through the same
  `findSupportedVideoConfig()` walker WebM's probe uses and the same candidate list `exportToMP4`
  itself configures from. `audio` is whether `AudioEncoder.isConfigSupported` accepts AAC-LC
  (`isAudioCodecSupported`, which answers `false` for a missing `AudioEncoder`, a refusal and a throwing
  probe alike, because the caller's next move is the same in all three).

  **Two booleans because the two failures differ in kind.** No H.264 means no MP4 at all; no AAC
  means an MP4 *with no sound in it*, which is still a legitimate thing to export. The measured
  fact behind the split (2026-10-02, Playwright 1.63 browsers, on a secure origin): Chromium 153
  and WebKit 26.6 have H.264, VP9, VP8 and AAC; **Firefox 155 has all three video codecs and no
  AAC encoder**. Before this ticket, exporting MP4 there ran to "Export complete!" and handed back
  a silent file, with a `console.warn` as the only trace.

  **A refusal at the requested size is not yet a refusal by the browser** (ESCSUITE-237).
  `parseProject` accepts any side from 2 to 7680, and Chromium's H.264 encoder refuses some of
  those sizes — 64x8, 64x2, 2x2 and 3840x2 refused, 16x16 and 64x48 encoded, when the ticket
  measured it — while encoding H.264 at every normal size; WebM and GIF rendered 3840x2 fine. So
  when the ladder finds nothing at the requested size, `mp4OutputSizeRefusal()` walks the same
  ladder once more at `MP4_REFERENCE_SIZE` (1280x720). If that passes, the size is at fault:
  the probe resolves `{ video: false, audio, outputSizeReason }` with
  `mp4OutputSizeReason(w, h)`, which picks one of two sentences by the requested size — a side
  under 16: "The output size W×H is too small for H.264 — MP4 needs at least 16×16; WebM and
  GIF are unaffected."; otherwise (8K, say, past the ladder's Level 5.1 ceiling): "The output
  size W×H is too large for H.264 in this browser; WebM and GIF are unaffected." — and
  `exportToMP4` throws an `ExportError` with that message and `code: 'OUTPUT_SIZE_UNSUPPORTED'`
  (the same code either way), before any mix, media load or encoder,
  which the headless kit reads as a permanent input error (exit 2, 400 under `serve`). If the
  reference is refused too, nothing changes: `MP4_NO_CODEC_REASON`, no code. The reference probe
  runs **only on that failure path**, so a normal export and the dialog's probe on a normal size
  still ask one video question and one audio question — the suites count `isConfigSupported`
  calls to hold that. `ExportError.code` is optional and every other throw leaves it unset. The
  16x16 in the sentence is the ticket's measurement, not something a unit-test double can measure.

  `hasMP4EncodeGlobals()` is what is left of the old synchronous check — `VideoEncoder`,
  `VideoDecoder` (MP4, unlike WebM, decodes through WebCodecs) and `VideoFrame`. Three callers:
  this probe's own short-circuit, `exportToMP4`'s door guard, and the dialog's choice between the
  two "neither video format works" sentences (below).
- **`isWebMExportSupported(width, height)`** is a real, asynchronous probe (ESCSUITE-22/29: it
  used to be `return isMP4ExportSupported();`, which could not tell a browser that merely has
  WebCodecs from one that can actually encode VP9 or VP8 — exactly the gap ESCSUITE-29 traced).
  `hasWebMEncodeGlobals()` is the one predicate it and `exportWebM.ts`'s own early guard both
  read: only `VideoEncoder`/`VideoFrame` need to exist, not `VideoDecoder` — WebM never decodes
  through WebCodecs; it seeks `HTMLVideoElement`s directly. From there it asks the same
  `findSupportedVideoConfig()` ladder `exportWebM.ts` configures from, at **the size the export
  will actually use** — `getResolution(advancedOptions.resolution, …)`'s answer, not the raw
  project resolution, so a project whose native size this browser cannot configure but whose
  720p/480p preset it can does not read as unsupported outright (review round 1, MINOR 2) — and,
  since ESCSUITE-175's fix round, Opus through the same `isAudioCodecSupported()` the MP4 probe
  asks AAC through, so `audio` means the same thing for both formats.
  `ExportDialog` calls it — **and MP4's probe, in the same effect under the same `cancelled`
  flag** (ESCSUITE-175: identical dependency lists, so two effects would mean two stale-answer
  guards to keep in step) — in a `useEffect` keyed on `isOpen`, the project's own width/height and
  the *selected resolution preset*, so both re-probe when the preset changes and neither on every
  render. `webmSupport` and `mp4Support` both start optimistically
  `{ video: true, audio: true }` (so the common case — Chrome/Edge, both formats work — never
  flashes a disabled button or a note that appears and vanishes), each flipping only once its own
  probe says otherwise. The effect's `cancelled` flag is the ESCSUITE-98 run-identity shape:
  closing the dialog before a probe resolves, then reopening it before the stale one settles, must
  not let the stale answer overwrite the fresh one.
- **GIF has no support predicate** (ESCSUITE-34). `gifenc` is pure JavaScript and a 2D canvas is
  the only browser capability `exportGIF.ts` uses, so there is nothing to probe and nothing to
  check at the exporter's door either — `exportGIF.ts` has no capability guard at all, which is
  the point (`exportGIF.test.ts` deletes the WebCodecs globals and exports fifteen frames
  anyway). The dialog makes GIF always available by **never passing `disabled` to the GIF
  radio**, not by reading a third predicate. There was briefly an
  `isGIFExportSupported()` that returned `true`, on the argument that the dialog would read all
  three the same way; it never had a caller, so the final review deleted it rather than leave a
  tested function whose docstring described a caller that did not exist. A future reason to
  refuse GIF would be a real predicate with a real reader, written then. Its companion sentence
  `GIF_ALWAYS_AVAILABLE_NOTE` exists because "this browser
  cannot export" stopped being true the moment GIF landed in `core/`, and since ESCSUITE-34
  **the dialog says so**: `neitherFormatSupported` is now `noVideoFormatSupported` (its old name
  stopped being true), the `role="alert"` it gates carries `GIF_ALWAYS_AVAILABLE_NOTE` as a second
  sentence, and the GIF radio is the one control that state leaves enabled. The primary buttons
  stay disabled — they are WebM's.

The dialog's **video-support states** (GIF is in none of them: it is always possible). Since
ESCSUITE-175 there are five, because each video format now has both a refusal of its own and a
state neither had before — possible, but silent:

| State | Shown |
|---|---|
| Both video formats possible, with sound (the common case) | No notice; both are offered as usual |
| Only WebM is possible | MP4's radio is `disabled` with its "Not supported in this browser" hint, **and** `MP4_NO_CODEC_REASON` ("This browser cannot encode H.264, so MP4 export is unavailable here. WebM and GIF are.") is a `role="status"` line in the main body — the ESCSUITE-22 say-it-before-the-click shape, which ESCSUITE-175 finally gave MP4 too. The primary WebM buttons stay enabled, which is what the sentence's second half promises. When the probe traced the refusal to the **output size** (`mp4Support.outputSizeReason`, ESCSUITE-237: H.264 refused at the selected preset, accepted at 1280x720), the line is that sentence instead — "The output size W×H is too small for H.264 — MP4 needs at least 16×16; WebM and GIF are unaffected." for a side under 16, "The output size W×H is too large for H.264 in this browser; WebM and GIF are unaffected." otherwise — and the radio's hint reads "Not supported at this output size" |
| Only MP4 is possible | WebM's primary button is `disabled`, with `WEBM_NO_CODEC_REASON` ("This browser cannot encode WebM video — Chrome or Edge can.") in both a `title` and a visible main-body line, followed by "Choose MP4 under Advanced options to export anyway." |
| A format is possible but has no sound (MP4 in Firefox 155; WebM in a browser with no Opus encoder) | The format stays fully offered and `noAudioNote(format)` — "MP4 export in this browser will have no sound (no AAC encoder). WebM keeps the audio." / "WebM export in this browser will have no sound (no Opus encoder). MP4 keeps the audio." — is a `role="status"` line in the **main body**, beside the background-tab note, read before the format is chosen rather than after. Hidden while GIF is selected (GIF has its own no-sound line) and for a format that is refused outright (there is no silent export to warn about then). A browser with **no `AudioEncoder` at all** makes both formats silent, and then both notes appear with the second sentence dropped (`noAudioNote(format, false)`): "WebM keeps the audio" and "MP4 keeps the audio" cannot both be true, which is the audio-side twin of the trap in the next row. After such an export the completion screen carries `exportedWithoutSoundReason(format)` ("Exported without sound — this browser has no AAC encoder." / "…no Opus encoder."), from the **result's** `audio: false` rather than from the probe — the file just handed over is the authority on its own contents — **and** from the dialog's own `projectHasAudio`, because the sentence asserts a loss (next paragraph) |
| Neither video format is possible | One `role="alert"` row in the dialog's **main body**, not behind "Advanced options", carrying whichever cause actually applies — `EXPORT_NO_WEBCODECS_REASON` ("Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.") when `hasMP4EncodeGlobals()` is false, and `EXPORT_NO_VIDEO_CODEC_REASON` ("This browser cannot encode WebM video or MP4 video — Chrome or Edge can.") when WebCodecs is present and neither codec is (ESCSUITE-175: before MP4 had a real probe this state could only mean the globals were missing, so it said so unconditionally) — **followed by `GIF_ALWAYS_AVAILABLE_NOTE`** ("GIF export needs no WebCodecs — choose GIF under Advanced options to export anyway."). Every download button, primary **and** Advanced, stays on screen, `disabled`, the same say-why-do-not-hide shape ESCAPECRAFT's MP4/M4A buttons and `separateTracksBlockedReason` use (`apps/craft/CLAUDE.md`'s "Download Formats"). Both video radios are `disabled`; the **GIF radio is not**, and choosing it enables an Advanced "Download GIF" button with no `title` — this is the one state where the dialog is still useful, and ESCSUITE-34 is why it is no longer a dead end. The two per-format sentences are **not** shown here: each names the other format as the way out, and with both gone both halves would be lies |

`bothVideoFormatsBlockedReason` is the one expression that decides the last row, and
`webmBlockedReason` / `mp4BlockedReason` each fall back to it (`?? WEBM_NO_CODEC_REASON`,
`?? mp4Support.outputSizeReason ?? MP4_NO_CODEC_REASON`) so a disabled button's `title` and the
body's own line can never disagree about why.

**`projectHasAudio`, and why the completion sentence needs it** (ESCSUITE-175 fix round). The
up-front note says "will have no sound", which is true and harmless for a silent project. The
completion sentence says "Exported **without** sound", which asserts a **loss** — so showing it
for an image-only or all-muted timeline would claim something that did not happen. The exporter
cannot help: `ExportResult.audio` is a statement about the *pipeline* ("this browser has no AAC
encoder"), not about this project, and it cannot be anything else, because knowing whether a
source actually carries an audio track means decoding it — the cost the probe-first ordering
exists to avoid. So the dialog answers the second half itself: a clip whose track is present,
`visible` and not `muted`, whose source `mediaType !== 'image'`. That is `core/audioMixer.ts`'s own
skip clause minus its per-blob `decodeAudioData`, memoised on `clips`/`tracks`/`sourceVideos`.
Since ESCSUITE-312 the rule is one pure `projectHasAudio(clips, tracks, sourceVideos)` in
`core/exportTypes.ts` (true when `audioCandidateSources` is non-empty) rather than an inline
closure in `ExportDialog.tsx`, because the headless render starts from the same candidates before
refusing an mp4 in a Chromium with no AAC encoder — and then makes the answer exact by reading each
candidate's container headers (see "Headless Render Bundle"). The dialog keeps the cheap
approximation: it `useMemo`s a call to `projectHasAudio` and behaves exactly as before.

It is **approximate in one direction only**: a video file with no audio track in it still counts,
so the sentence can appear where strictly nothing was lost. That is the conservative error — it
over-reports rather than staying quiet about a real loss — and the cases it does rule out are the
ones that are *knowably* silent. Making it exact would mean the decode this ticket removed; do not.

Before ESCSUITE-22, the dialog's only "not supported" notice was MP4's, and it lived behind the
collapsed Advanced panel — so a browser with no WebCodecs at all still showed an enabled "Download
WebM" button front and center, which failed the instant it was clicked. Every reason sentence —
the four constants `EXPORT_NO_WEBCODECS_REASON`, `EXPORT_NO_VIDEO_CODEC_REASON`,
`WEBM_NO_CODEC_REASON` and `MP4_NO_CODEC_REASON`, and the two builders `noAudioNote(format,
alternativeKeepsAudio)` and `exportedWithoutSoundReason(format)` — lives in `exportTypes.ts`,
beside the probes, for the same reason ESCAPECRAFT's own disabled-reason constants live beside
their gates rather than in a shared notices file: nothing has gone wrong yet.

The last two are builders rather than constants because the sentence differs **per format** and in
nothing else: one `VIDEO_FORMAT_AUDIO` table holds each format's label, its audio codec and the
other format to point at, so "AAC" can never be said of WebM or "Opus" of MP4. GIF is deliberately
*absent* from that table — its result always reports `audio: false` because the container has no
audio track, and both sentences blame a missing encoder, which would be the wrong explanation; with
no `gif` entry there is nothing to read. They are also the same fact said at two moments, which is
why they sit together: an exporter hands `noAudioNote(itsOwnFormat)` straight to its own
`onProgress` channel while the export runs, and the dialog shows
`exportedWithoutSoundReason(format)` once it is over.

**What the exporter does with the probes (ESCSUITE-175).** `exportToMP4` asks both codecs
**before** mixing the timeline's audio, loading any media or starting the muxer. It used to walk
the H.264 ladder only after all three — so a browser with no H.264 encoder paid for the whole
export and then threw `No supported H.264 codec found` — and probe AAC later still, where a
refusal set `audioData = null` behind a `console.warn` and the export carried on to
"Export complete!" with a silent file. Now:

- No H.264 throws `ExportError(MP4_NO_CODEC_REASON)` before anything is spent, so the refusal
  reads the same sentence before the click and after it, and (being an `ExportError`) reaches the
  dialog's diagnosed-codec-failure path with its log rather than its generic one.
- No AAC reports `noAudioNote('mp4')` through `onProgress` — the channel the no-worker hedge
  already uses — **skips `extractAndMixAudio` entirely** (the most expensive no-op in the
  pipeline) and resolves with `audio: false`. `exportWebM.ts` does the same for Opus
  (ESCSUITE-175 fix round), with its probe left where it always was: there is nothing expensive
  after it to protect, only a muxer to not add a track to.
- All three exporters resolve `ExportResult` (`{ blob, audio }`) rather than a bare `Blob`, so the
  dialog reads one field whichever format ran: MP4 `aacSupported`, WebM `!audioDropped`, GIF always
  `false` (no audio track at all). **`audio: false` is a statement about the pipeline, not about
  this project**: "this browser could not carry sound in this format". A silent timeline in a
  no-AAC browser also reports `false`, because the exporter would have to decode every source to
  know better — which is the cost the probe-first ordering removed. The dialog therefore pairs the
  field with its own `projectHasAudio` before claiming a loss (above), and gates on
  `format !== 'gif'` as well, since a GIF's `false` is the container's doing and no encoder's.

**The Advanced "Download {format}" button gates AND labels from the format the click will
actually run, not the one selected in the radio** (review round 1, MAJOR 1; the label itself,
ESCSUITE-182). `handleExport` already falls back from `'mp4'` to `'webm'` whenever MP4 is
unsupported — the intentional behaviour behind a restored `{format:'mp4'}` setting in a
now-MP4-less browser still exporting, as WebM, when the Advanced button is clicked — so
`effectiveAdvancedFormat` recomputes that same fallback, the button disables exactly when *that*
format is blocked (with the blocking reason as its `title`), and its text reads
`effectiveAdvancedFormat` too: a restored `{format:'mp4'}` in a browser whose H.264 probe says no
shows an enabled "Download WebM", not an enabled "Download MP4" that silently writes a `.webm`
— the MP4 *radio* still stays checked and disabled with its own reason (ESCSUITE-175), since the
ticket is about what the button under it promises to produce, not about hiding the user's saved
choice. Since ESCSUITE-34 it is three-way, and **GIF short-circuits the fallback entirely**: a
`'gif'` selection is its own effective format, so `advancedBlockedReason` is `null` whenever GIF
is chosen and nothing can disable that button but an empty timeline.

**The GIF controls (ESCSUITE-34).** GIF is a third radio under Advanced options, beside MP4 — not
a fourth primary button: WebM stays the default and GIF is a deliberate choice, like MP4. Four
things appear only while it is selected, and two disappear:

- **A frame-rate `<select>`** (`id="export-gif-fps"`, label "Frames per second"): `GIF_FPS_OPTIONS`
  rendered as "10 fps (smallest file)" / "15 fps" / "20 fps (smoothest)", read back through
  `gifFrameRate`. It is absent for the two video formats, which always encode at 30.
- **A per-format resolution list.** GIF offers exactly `GIF_RESOLUTIONS` (720p/480p/360p); the
  video formats offer `VIDEO_RESOLUTIONS` (project/1080p/720p/480p). Every format radio's
  `onChange` runs the current selection through `resolutionForFormat`, so a 1080p selection becomes
  480p on the way *into* GIF and a 360p selection becomes 480p on the way *out* — the user never
  sees a `<select>` whose value is not in its own list.
- **Two size estimates, at the two moments there is something to say.** Before the export,
  `estimateGifBytes(gifOutput.width, gifOutput.height, gifFrames)` beside the output dimensions and
  the frame count, where `gifFrames` is `Math.ceil(gifSeconds × gifFps)` — the same expression
  `exportToGIF` itself uses, derived from frames and never from seconds. During the export,
  `progress.estimatedBytes`, gated on `!== undefined` because the exporter sets it only from inside
  the frame loop, so the up-front heuristic is what shows until the first frame lands. Both render
  through `formatFileSize`, the formatter the media library already uses.
- **A 30-second warning that never refuses.** `gifSeconds > GIF_LONG_RANGE_SECONDS` renders
  `GIF_LONG_RANGE_WARNING` as a `role="status"` line. `gifSeconds` is the in/out section's length
  when there is one and the timeline's otherwise, because that is what will actually be encoded. No
  button is disabled by it.
- **The MP4-vs-WebM background-tab note is hidden; GIF gets its own line instead.** The hidden one
  is about the two video formats' decoders and GIF has none; in its place GIF names the two things
  it actually surprises people with: it needs the tab visible, and it has no sound. "Needs the tab
  visible" is one shared constant, `TAB_VISIBLE_NOTE` (`core/exportTypes.ts`) — WebM and GIF both
  drive `core/elementFrames.ts`'s `requestAnimationFrame` readiness poll, which the browser
  throttles once the tab is hidden, unlike MP4's worker-backed decode path (ESCSUITE-153) — read
  by three JSX blocks so the two formats' notices cannot drift apart (ESCSUITE-173): the combined
  "MP4 … WebM {TAB_VISIBLE_NOTE}" sentence when `mp4Supported`; a WebM-only sentence gated on
  `!mp4Supported && webmSupported && effectiveAdvancedFormat === 'webm'` (the EFFECTIVE format,
  not the selected one, so a restored `{format:'mp4'}` setting that actually exports as WebM still
  gets the note, and `webmSupported` keeps it off when WebM itself cannot run either — that is
  `noVideoFormatSupported`'s alert to carry, not this note's); and the GIF sentence above.
- **The Quality `<select>` is hidden** (final review, MAJOR 1). It is a video/audio bitrate knob:
  `exportGIF.ts` never reads `options.quality`, so for GIF the three options would promise a
  "faster export" / "slower export" trade-off that does not exist, which is exactly the
  say-why-don't-pretend rule the rest of the suite follows. Gated on the selected format the same
  way the frame-rate select is, and the *value* stays in `advancedOptions` and in
  `lastExportSettings` — switching back to WebM or MP4 restores what was chosen, the same ruling
  `fps` gets in the other direction. The headless kit is deliberately **asymmetric** here: it
  rejects `fps` on a video job but *accepts* `quality` on a GIF job and ignores it, because
  `parseOptions` always fills a default in, so rejecting it would refuse specs doing nothing
  wrong — `services/headless-artist/README.md`'s `options.quality` row says so.

The GIF radio's accessible name and hint — "GIF (256 colours, no audio)" and "No WebCodecs needed" —
contain neither the word "WebM" nor "MP4" on purpose: `ExportDialog.test.tsx` finds the other two
radios by exactly those words in a dozen places, and this is a constraint on the copy, not a
stylistic preference. `LastExportSettings` gained an optional `fps`, carried in and out through
`gifFrameRate`, so a setting saved before this ticket restores at the default rather than at
`undefined`. A failed GIF export is reported inline like a failed WebM one but is offered no "Try
MP4 Instead" (next paragraph): that button exists because a WebM `ExportError` is a diagnosed codec
problem another codec might not have, and a GIF failure is not.

**A WebM failure can offer MP4 as a retry, the mirror of MP4's own "Try WebM Instead."** MP4's
failure has always replaced the dialog with a dedicated recovery screen (`mp4FailedError`) offering
WebM as the alternative, regardless of what kind of error it was — gated on `webmSupported`
(review round 1, MINOR 5: the browser the WebM probe exists to catch — WebCodecs present, no
usable codec — is exactly the one where a failed MP4 export used to still offer a WebM retry that
could not work either). WebM's failure stays inline — the usual `error` alert above the
still-present primary button — because WebM is already this dialog's own default/fallback format;
but when the failure is specifically an `ExportError` (a diagnosed codec problem: the ladder found
nothing, or the encoder failed mid-export) *and* MP4 is actually available, a "Try MP4 Instead"
button appears beside the alert, running `exportToMP4` with the same quality/resolution settings.
A plain `Error` (an abort, a generic crash) or MP4 being unavailable offers nothing further — there
is nothing more useful to suggest.

**The asymmetry ESCSUITE-22/29 left behind is closed.** That ticket upgraded only WebM's probe,
and named the rest as follow-up: "a browser that has WebCodecs globals but no H.264 encoder still
reads `mp4Supported: true` up front and only discovers otherwise at export time… Giving MP4 the
same up-front treatment is unclaimed follow-up work." ESCSUITE-175 is that work, and it found the
worse half of the same shape on the way: the AAC probe, which did not refuse anything at all but
quietly threw the soundtrack away. MP4's `mp4FailedError` recovery screen is still there and still
offers WebM — it is now for failures the probe could not have predicted (an encoder that dies
mid-export), not for a codec that was never going to work.

What is still asymmetric, on purpose: the probes are per-*codec*, not per-*configuration*. Both
ask at the output size and at a representative bitrate/frame rate, because `quality` only scales
the bitrate and no browser has been observed to accept a codec at one bitrate and refuse it at
another. A browser that did would pass the probe and fail at `configure()`, which is what the
recovery screen is for.

**The progress view speaks (ESCSUITE-215).** It used to be visual only: the bar was a styled
`<div>` with a width on it and no role, and the per-frame "Encoding frame N/M" line and the
percentage were text on screen and nothing more — so an export that can run for minutes reported
nothing at all to a screen reader. The bar is now `role="progressbar"` with
`aria-label="Export progress"`, `aria-valuemin="0"`, `aria-valuemax="100"` and an `aria-valuenow`
rounded the way the percentage beside it already is (a fractional value is read out digit by
digit). Beside it sits **one** `role="status"` (`aria-live="polite"`, `aria-atomic="true"`),
rendered for the whole of the progress view and empty until there is something to say — a live
region a reader first meets already populated is not a change, and is not announced. What it says
is throttled by `components/Export/progressAnnouncement.ts`'s pure
`shouldAnnounceProgress(previous, next, nowMs)`: the first report of a run, then each new
ten-percentage-point band (`ANNOUNCE_STEP_PERCENT`) or every five seconds
(`ANNOUNCE_INTERVAL_MS`), whichever comes first — the band keeps a fast export from interrupting
itself once per encoded frame, the clock keeps a slow one from going silent inside a band. The
completion report is the one exception that always speaks, because a throttle that swallowed it
would leave the last thing heard being a frame count part-way through; the failure sentence is
unchanged and still the `role="alert"` it has always been, so there are two channels and not
three. The announced text is the progress message with the percentage appended
(`Encoding frame 90/300 (30%)`), which makes each announcement a self-contained sentence and —
deliberately — never the exact text of a visible node; the visible message keeps updating per
frame and carries `aria-hidden="true"`, so the same words are not met twice. The throttle's
bookkeeping and the announced text are **refs**, written immediately before the `setProgress`
every report already makes: there is no second piece of state and so no extra render per encoded
frame. Two consequences outside this file: a Playwright `getByText` of "Encoding frame N/M" or
"Export complete!" now matches twice and needs `.first()` (four call sites carry that note), and
`apps/e2e/tests/accessibility/screen-reader.spec.ts` › "ESCAPEARTIST announces export progress"
is the end-to-end pin, driving a real MP4 export.
