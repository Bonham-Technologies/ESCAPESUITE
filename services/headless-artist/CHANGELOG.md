# @escapesuite/headless-artist

## 0.7.5

### Patch Changes

- 609a627: A render refused because a clip's source has no stored bytes now reports `code: "SOURCE_MISSING"` and is treated as a permanent failure: exit 2, or 400 under `serve`.

## 0.7.4

### Patch Changes

- 3097e54: A headless mp4 job whose video source fails to load now fails by name instead of silently rendering without that clip.

## 0.7.3

### Patch Changes

- 9390587: A recording Firefox cannot seek no longer exports as a black video, and no longer hangs its import
  
  On Firefox, exporting an ESCAPECRAFT picture-in-picture recording to WebM or GIF used to run for minutes and then report "Export complete!" with a black picture, and importing such a recording could sit on "Processing…" for ever. Those recordings were saved with an empty seek index, and Firefox never finishes seeking into one. ESCAPEARTIST now repairs the file when it comes in — from the media library or from ESCAPECRAFT's Send to Editor, where it rewrites ESCAPECRAFT's own stored copy in place, with the same audio and video and a working seek index — so Firefox can seek it. If a recording still cannot be seeked, the export stops after three frames and says so by name ("This browser cannot read … frame by frame") instead of producing a black file — and does not suggest trying the other video format, which would fail the same way — and the thumbnail gives up after five seconds instead of holding the import. The headless kit treats that refusal (`SOURCE_NOT_SEEKABLE`) as a permanent failure of the job: exit 2, or 400 under `serve`.

## 0.7.2

### Patch Changes

- 0d895f6: A bundle or manifest source whose duration, width or height is null is rendered instead of refused
  
  A `null` in a source's `meta` for its duration, width or height now counts as not given, the way it already does for a name or type, and the kit works the value out from the video. A value that is present and wrong, such as a negative or a string, is still refused by name.

## 0.7.1

### Patch Changes

- 7b5de10: Two clips of one recording on screen at once now each show their own moment
  
  A clip split and crossfaded into itself, or the same recording used twice at once — a zoomed copy on a track above, a picture-in-picture of itself — now shows each clip's own frame in the preview and in every export. Before, both clips showed whichever moment was asked for last: the crossfade faded between two copies of the incoming frame, and the zoomed copy and the full picture showed the same instant. An export makes a recording's second player the first time two of its clips overlap and keeps it until the export finishes; the preview makes one the same way and keeps it for as long as the recording is on the timeline. A recording used once costs what it did.

## 0.7.0

### Minor Changes

- 584cf58: The headless kit's mp4 render says whether it carries sound, and refuses a sounded project when it cannot
  
  The reference image's Linux Chromium has no AAC encoder, so every kit mp4 job there used to come back `ok: true` with a picture-only file and any `loudnessTarget` silently ignored. The verification manifest now carries `audio`: `true` when the format's audio encoder was available (the file carries a track when the mix had sound), `false` when the file has none, which is always the case for a GIF. An mp4 job whose sources carry an audio track is refused on such a Chromium with `"code": "AUDIO_CODEC_UNAVAILABLE"` — exit 2 from `render`, 400 from `serve` — naming the two ways out: render webm, or set the new `options.allowSilentMp4: true` to render the picture alone. Whether a source carries an audio track is read from its container's headers, not decoded, and only on that path; a project of video-only files, images and overlays renders mp4 as before, with `audio: false`. `allowSilentMp4` is accepted on any format and ignored on webm and gif.

## 0.6.2

### Patch Changes

- f4b40de: A render job's clips must carry their trim points.
  
  Every clip in a job's project — overlay clips included — must now have a `startTime` that is a number of at least 0 and an `endTime` after it; a clip missing either, or with an inverted pair, fails the job before any frame is drawn with `Invalid project: Clip "<id>" has an invalid startTime` (or `endTime`), the same check the editor runs on a project file. Every clip ESCAPEARTIST writes already carries both; only a hand-built job spec that left them off an overlay clip is affected.

## 0.6.1

### Patch Changes

- 9a53df6: A project whose track carries a `kind` other than `'captions'` is now refused by name
  
  The kit validates projects with the editor's own `parseProject`, which now knows the caption-track marker: a project with a Captions track renders its captions like any text clips, and a track whose `kind` is anything but `'captions'` fails the job with `timeline.tracks[i].kind must be 'captions'` before a render starts.

## 0.6.0

### Minor Changes

- 4e65a6c: Exports now measure their loudness, and can normalise it to −14, −16 or −23 LUFS
  
  Every MP4 and WebM export measures its mix the way broadcasters and streaming services do (ITU-R BS.1770-4 / EBU R128 integrated loudness and true peak) and, when it is done, says so: "Export complete! Measured −18.3 LUFS". A new **Audio loudness** choice under Advanced options — Off by default, −14 LUFS (streaming), −16 LUFS (podcast/mobile) or −23 LUFS (broadcast) — turns the mix up or down to that target before it is encoded, holding its peaks under −1 dBTP with a limiter, and the completion line adds the gain it applied ("gain +4.3 dB") and, when the limiter had to step in, says that it held the peaks so the mix lands below the target. A very quiet mix is turned up by at most 20 dB, so its background noise is not raised with it. The choice is remembered with your other export settings. In the headless kit, a job spec can ask for the same thing with `options.loudnessTarget` (`-14`, `-16` or `-23`, MP4 and WebM only), and the verification manifest gains a `loudness` record — the measured loudness and true peak, the gain applied and the target — whenever the render had sound to measure.

## 0.5.2

### Patch Changes

- 0dfb94b: A damaged project file, host message or render job is now refused with a reason instead of failing with an error
  
  Opening a `.veditor` file, or a host sending `LOAD_PROJECT`, with a broken track list or broken legacy text and shape overlays used to fail with a bare TypeError, and a host got no reply at all; the editor now refuses it and names the field (`timeline.tracks[0] must be an object`, `timeline.textOverlays[0].text must be a string`), and the host gets its `INVALID_PROJECT` error. In the headless kit, a project with a null clip is refused naming the clip's index instead of crashing, a manifest source's `name` and `mimeType` must be non-empty strings when given (`null` still counts as not given; what changes is that an empty `""` is refused, where an empty `mimeType` used to be guessed from the file's extension and an empty `name` used to be kept as the source's name), and a webhook sink's `headers` values must be strings, all refused before a render starts.

## 0.5.1

### Patch Changes

- 3ba3b31: The kit pins Playwright 1.64.0
  
  The kit now pins Playwright 1.64.0 and the reference container moves to the matching `playwright:v1.64.0-noble` base image. Nothing changes for a `render` or `serve` caller.

## 0.5.0

### Minor Changes

- 94968bf: Saved projects are no longer capped by the file format; the only limits are your browser's download size and the storage it has free.
  
  A saved project (`.veditor`) used to hold every video as text inside one huge string, which capped a whole project at about 192 MiB of media and read every video into memory on save. Projects are now saved in a new format that copies the videos into the file as they are, without reading them, and reopening one copies each video straight into the browser's storage. Measured 2026-10-12 on macOS: a project of about 2 GiB saved and reopened in Chromium 153 and Firefox 155 with the heap flat. A project too big for the storage you have free is refused before anything is written, with a sentence saying how much it needs and how much is free. A project file that is damaged or cut off, or whose project cannot be read (one edited by hand, or saved by a newer ESCAPEARTIST), is refused with the reason before any of its videos is copied, and a load that fails partway removes what it had already copied. Projects saved by earlier versions still open, but a project saved by this version cannot be opened by an older ESCAPEARTIST, which reports "Failed to load project". The headless render kit reads both the old and the new format, and reads the new one without loading the whole file into memory.

## 0.4.11

### Patch Changes

- 3208a3f: A render refused because its output size is too small for H.264 exits 2 (400 under serve) as a permanent input error instead of exit 1.
  
  An MP4 job whose output size the H.264 encoder refuses — 64×8, say, or one too large for it — will be refused every time it is run, but it used to exit 1, the code that tells a broker to retry. It now exits 2 from `render` and answers 400 from `serve`, the same as an invalid job spec, and the outcome carries `"code": "OUTPUT_SIZE_UNSUPPORTED"` beside the reason, so it can go straight to a dead-letter queue. Every other failed render is unchanged.
- 3208a3f: The verification manifest's durationSec matches the delivered file to the frame for every format.
  
  For MP4 and WebM the manifest used to report the requested time range — 0.75 s, say — while the file held 23 whole frames at 30 fps, 0.766667 s, so a consumer comparing `durationSec` to the file within a millisecond rejected a valid render. It now reports the frames encoded times the frame period, as it already did for GIF, and the README says a consumer may compare it to the file's video stream within one millisecond (a container with sound runs a few milliseconds longer, because the last audio frame is padded past the last video frame).

## 0.4.10

### Patch Changes

- 681aed0: The reference container installs metric-compatible fonts, so text overlays render as the editor shows them.
  
  The image now carries the Liberation, DejaVu and Croscore font families, which stand in for Arial, Helvetica, Times New Roman, Courier New and Verdana. Georgia and Impact render through the generic serif and sans-serif families, since they have no metric-compatible clone.

## 0.4.9

### Patch Changes

- 9719e7f: WebM and GIF renders no longer repeat one source frame in three in place of the frame that should be there
  
  The kit renders through the same bundle as the editor, and its WebM and GIF outputs are drawn from a video element that was asked for each frame at the exact moment the frame starts; Chromium resolves that moment at microsecond precision and, on one frame start in three, showed the previous frame. Each frame is now asked for a tenth of a millisecond after its start. MP4 renders of an H.264 source, which the kit's Chromium decodes in the background worker, were already correct; an MP4 render of a WebM source, or of a source the worker refuses, goes through the same video element and is fixed with the rest.

## 0.4.8

### Patch Changes

- ad7cbca: Reference container: Chromium helper cleanup, correct uid, and an up-front output check
  
  The reference container reaps Chromium's helper processes under `serve` (tini is PID 1), every document says the image runs as uid 1001 rather than 1000, and a job whose output directory the container cannot write to is refused before the browser starts (exit 2 / 400) instead of after a full render.

## 0.4.7

### Patch Changes

- e0e6efb: `options.timeRange` now rejects a non-finite bound (`NaN`, `Infinity`) and a negative `start` while the job spec is parsed, instead of letting either through as a plain "number" and only surfacing downstream as an inflated or nonsensical render. Each fails with a message naming the field — `POST /render` answers 400, `render` exits 2 — before Chromium ever launches, the same as every other spec error. This is the validation half of ESCSUITE-191; the render engine's own clamp (ARTIST, released alongside this) handles the other half, a range that is well-formed but falls outside the project's timeline.

## 0.4.6

### Patch Changes

- 83e163c: A volume delivery's video and manifest each publish atomically, a bad sink config or a missing s3 SDK is refused before the render, the webhook sink never follows a redirect and reuses its connection, a wedged browser binary fails within the configured timeout, and an s3 upload has a budget of its own.
  
  The `volume` sink publishes its video and manifest sidecar-first: each is staged at a private, unique temp name inside the target directory and published with one same-directory rename, so a reader watching the directory never sees a half-written file, and a failed delivery never leaves a finished-looking video with no manifest beside it. A render is also never a byte-level blend of two concurrent deliveries' bytes, which the old cross-filesystem fallback could produce — the `fs.copyFile` path is gone outright; a cross-filesystem move now streams into the same private temp name instead of writing straight to the shared destination path. Atomicity is per file, not per delivery: two deliveries of the same jobId overlapping in time can still publish one job's manifest beside the other's video, so a broker must not start a retry while a previous attempt may still be delivering (see the README for the exact window).
  
  A sink's own config (`config.dir`, `config.command`, `config.url`, an s3 `prefix` that names no bucket, a non-string `region`/`endpoint`) is validated while the job spec is parsed, so a config that could never work answers 400 (`serve`) or exits 2 (`render`) before Chromium ever launches instead of after a full render. The s3 SDK's presence is checked the same way. The reference Docker image, which never has the optional `@aws-sdk/client-s3` dependency, now advertises and accepts only `volume` and `webhook` by default so it refuses an s3 job with 403 instead of accepting one it can only fail. A project manifest or bundle with no `timeline` at all now names the field instead of leaking a bare property-read error, and a render failure's message is stripped of any stray terminal colour codes before it reaches the JSON outcome or the HTTP response.
  
  The `webhook` sink always drains its response body, so a long-running `serve` process reuses its pooled connection to an intake endpoint instead of opening a fresh one for every delivery, and it no longer follows a redirect — a 307/308 from the configured endpoint fails the delivery naming where it tried to send your render, rather than silently re-POSTing the whole file (and your headers) to a different host.
  
  The render timeout now covers the whole job, launch included: a Chromium binary that never finishes starting used to be bounded only by Playwright's own three-minute default regardless of how small a budget you configured; it now fails at your configured timeout like everything else does.
  
  The `s3` sink gets a delivery budget of its own (`config.timeoutMs`, default 5 minutes, same bound as the webhook and command sinks') — previously a stalled upload was bounded only by the AWS SDK's own defaults (no timeout, with retries), so a drain waiting on one had no bound this kit controlled at all.

## 0.4.5

### Patch Changes

- 6b44a2f: Timeouts that used to silently mean the opposite of what you asked for now refuse the bad value and bound the cases nothing used to bound.
  
  `HEADLESS_TIMEOUT_MS` and a `webhook` sink's `config.timeoutMs` now refuse any value above 2147483647 ms (2^31-1, ~24.8 days — the largest delay a timer can represent), naming the bound, instead of accepting it and letting Node's own timers silently clamp it to about 1 ms, which used to fail every render or every webhook delivery instantly. The `command` sink gets a delivery budget of its own (`config.timeoutMs`, default 5 minutes, same bound): a delivery command that outruns it is sent `SIGTERM`, then `SIGKILL` two seconds later if it is still alive, and the job fails with `command sink timed out after <n> ms` rather than holding a worker slot forever, now even for a command that backgrounds a grandchild of its own instead of exiting cleanly. `serve`'s drain is bounded accordingly — by the render timeout plus whatever the job's own delivery sink budgets for itself (`volume` and `s3` need none of their own, though `s3`'s upload is therefore only as bounded as the AWS SDK's own defaults), not by the render alone. `serve` also sets its own request/headers timeouts (30s/10s, well under Node's 300s/60s defaults) and checks them every 5s instead of Node's default 30s sweep, so a client that sends its headers too slowly — or sends them and then withholds the body — is disconnected promptly rather than held open for up to a minute. A shutdown no longer waits on a request whose body has not finished arriving — it is answered 408 (or simply disconnected) immediately instead of parking the drain on bytes that might never come.

## 0.4.4

### Patch Changes

- bdccb43: The s3 output sink no longer crashes the process when a client rejects (or resolves) an upload without reading the render's stream body.
  
  `deliver()` hands each PutObject a `createReadStream(outputPath)` whose file handle opens asynchronously, on a later tick, whether or not anything ever reads it. A client that fails fast — a validation error, a network failure before the SDK starts piping the body, or an embedder-supplied client that never touches it — left that deferred open free to fail after a caller had already removed the job's work directory (which `serve` and `render` both do unconditionally once `deliver()` settles), surfacing as an uncaught exception instead of the `{ ok: false }` result a failed render is supposed to come back as. The stream now carries its own error listener and is explicitly released as soon as `send()` settles, so a never-read body can no longer outlive the call that created it.

## 0.4.3

### Patch Changes

- 655a065: Documentation only: the README's peak-memory figure for a GIF render now says which path of the kit it describes, and the troubleshooting list and the Inputs section now cover the new `Invalid project: <reason>` failure a malformed crop, transform, or duplicate clip id now produces before any frame is drawn.

## 0.4.2

### Patch Changes

- 02f229b: A manifest source can carry `meta` (media type and dimensions) so an audio-only file renders as audio, the way a bundle source already does.

## 0.4.1

### Patch Changes

- 4c23b9b: A bundle's audio-only source renders as audio, not as a silent video
  
  Rendering a `.veditor` bundle that holds an ESCAPECRAFT audio-only take (mic alone, screen and webcam both off) now treats that source as audio, the way ESCAPEARTIST itself does, instead of decoding it as a video with nothing to show. Temp files for a WebM source also keep a `.webm` extension, including `audio/webm` and a `video/webm` MIME type carrying a `;codecs=` parameter, where they used to fall back to `.bin` or the wrong extension.

## 0.4.0

### Minor Changes

- c89cf40: Render a job as an animated GIF
  
  `options.format` now takes `"gif"` alongside `"mp4"` and `"webm"`, with a new `options.fps`
  (`10`, `15` by default, or `20`) and a new `options.resolution` of `"360p"`. The output is written,
  delivered and hashed exactly like a video — `<jobId>.gif` through the volume sink, `image/gif`
  through S3 and the webhook, and a manifest whose `format` says `gif`.
  
  `options.fps` applies to GIF only and a job that sets it on an MP4 or WebM render is rejected
  before Chromium launches, rather than quietly encoding at 30. Note that a GIF stores each frame's
  delay in hundredths of a second, so 10 and 20 fps are exact while 15 fps plays at about 14.3.
  
  Two validation messages widened and are now API surface, not just log text: a bad
  `options.format` reads `options.format must be one of "mp4", "webm", or "gif"`, and a bad
  `options.resolution` reads `options.resolution must be one of "project", "1080p", "720p", "480p",
  or "360p"`. A caller or broker that matches either message's old, two- or four-value text will
  stop matching.

## 0.3.0

### Minor Changes

- f8e9846: The export dialog's Resolution presets now show their actual output size, and the unreachable 'original' resolution is gone
  
  Every option in the export dialog's Resolution dropdown — "Project", "1080p", "720p" and "480p" — now prints its real output dimensions right in the label, e.g. "1080p — 1920×1080". Since a preset's width already followed the project's own aspect ratio, a bare "1080p" on a portrait project was misleading: it actually exported 608×1080, narrower than a full 1080p frame, with nothing in the dropdown to say so. Separately, the 'original' resolution option — never offered anywhere in the app, reachable only by hand-writing a headless render job spec — has been removed. It was the one setting that ignored the project's shape entirely and sized the export to the bottom clip's own source dimensions instead, which is exactly the surprising, inconsistent behaviour the rest of this change is about avoiding. A headless job spec that asks for `resolution: "original"` now fails with a clear validation error instead of silently doing something different from every other resolution — a breaking change for any kit consumer who was passing that value, hence the minor bump on `@escapesuite/headless-artist`.

## 0.2.1

### Patch Changes

- d5fa993: Release tooling migrated to changesets/action v2 and @changesets/cli v3. No functional change to the kit.

## 0.2.0

### Minor Changes

- b9f8928: - New `services/headless-artist` kit: a one-shot CLI for rendering ESCAPEARTIST projects server-side in headless Chromium, with pluggable output sinks and a render manifest.
  - Added an HTTP `serve` mode so the kit can render over a long-running process instead of a one-shot CLI invocation, with a `HEADLESS_SINKS` allow-list that leaves the `command` sink off by default.
  - Added Docker and Kubernetes reference deployments, running as an unprivileged `pwuser` with mounted `/in`/`/out` volumes.
  - CI now verifies rendered MP4/WebM output with ffprobe (codec, size, frame count, duration, golden-frame colour) and re-hashes delivered files against the manifest.
