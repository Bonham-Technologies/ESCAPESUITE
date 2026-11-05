# On-device transcription (`src/core/transcribe.ts`, ESCSUITE-404)

"Transcribe to captions" turns the timeline's sound into caption clips with the **browser's own
on-device speech recognition**. ESCAPESUITE ships no speech model and fetches none. The
recognition runs inside the browser on this device. ESCAPEARTIST sends no audio, text or
anything else anywhere.

## What the browser downloads, from whom, and when

- **ESCAPEARTIST downloads nothing.** It has no speech model in its bundle and requests none.
  While it transcribes it makes no fetch, XHR, WebSocket or EventSource request. The only
  request the feature could ever cause is the editor loading its own transcription code from
  its own origin, and today that code is already in the page (see "Bundle" below).
  `ESCSUITE-404.spec.ts` pins this.
- **The browser may download a speech language pack**: its on-device recognition model for one
  language. It does this only when
  1. `SpeechRecognition.available({ langs: [lang], processLocally: true })` answers
     `downloadable`, and
  2. the user has read the notice "Your browser will download a speech language pack once.
     Your audio never leaves this device." and pressed **Download language pack**.

  ESCAPEARTIST then calls `SpeechRecognition.install({ langs: [lang], processLocally: true })`
  and the **browser** downloads the pack from **its own vendor**. Chrome downloads it from
  Google. ESCAPEARTIST does not choose, see or proxy that download. Where the pack is stored,
  and whether other sites can use it, is up to the browser. Cancel downloads nothing.
- When `available()` answers `downloading`, the browser is already downloading the pack
  because something else started it. The editor shows "Downloading the speech language pack…"
  and waits on `install()` for that download to finish. It starts no new download of its own.
- When `available()` answers `available`, the pack is already installed and nothing is
  downloaded.
- **Air-gapped or offline:** transcription works only if the language pack is **already
  installed** in that browser profile. Without a network the browser cannot fetch the pack,
  so `install()` fails and the editor says "The speech language pack could not be installed."
  Nothing else in the feature needs a network.

## Which browsers offer it

The control is shown only when the browser itself says it can recognise speech on this
device. That needs a `SpeechRecognition` (or `webkitSpeechRecognition`) constructor with static
`available()` and `install()` and a `processLocally` property, and `available()` must answer
anything but `unavailable` for the browser's language. Anywhere else **no control is
rendered**. MDN's compatibility data, read on 2026-11-05, lists:

| Browser | On-device recognition |
|---|---|
| Chrome desktop (Windows, macOS, Linux) | From 139. Audio-track input (`start(track)`) from 135. |
| Edge, Opera desktop | Listed as following Chrome. Not verified here. |
| Firefox desktop | Listed from 160 (in beta on the date above). Not verified here. |
| Safari (macOS, iOS), Chrome on Android, Android WebView, Firefox for Android | No. The control is hidden. |
| ChromeOS | The ticket reports `available()` answers `unavailable`, so the control is hidden. Not verified here. |

`available()` and `install()` are governed by the `on-device-speech-recognition`
Permissions-Policy feature, whose default allowlist is `self`. The hosted `vercel.json`
`Permissions-Policy` header does not name it, so the suite's own origin may use it. A host
that embeds ARTIST in a **cross-origin** iframe has to delegate it with
`allow="on-device-speech-recognition"`. Otherwise `available()` fails, which reads as
`unavailable`, and the control stays hidden. No microphone is used, so the header's
`microphone=(self)` does not matter here.

## What it does

- **Where:** the timeline's controls, after the zoom buttons: **Transcribe to captions**. The
  control is not in the Captions track's header, because that track exists only after a
  caption import and the action has to work before there is one.
- **On device only.** `createLocalRecognition` (`core/transcribe.ts`) is the only code in the
  app that constructs a `SpeechRecognition`. It sets `processLocally = true` before anything
  else, and if the browser does not read that back as `true` it aborts the recogniser and
  refuses ("This browser cannot transcribe on this device."), before any sound plays. There
  is **no cloud fallback**: the server-based mode (the API's default, which sends audio to the
  browser vendor) is never used.
- **What it hears:** the export's own mix (`extractAndMixAudio`), the whole timeline, at
  48 kHz. Muted and hidden tracks are left out, as in an export. An In/Out range does not
  limit it. The mix plays in real time into a `MediaStreamAudioDestinationNode`, never the
  speakers, and that node's audio track goes to `recognition.start(track)`. **The microphone
  is never opened.** A 10-minute timeline takes about 10 minutes. The status line reads
  "Transcribing on this device… m:ss / m:ss". **Stop transcribing** ends it and adds nothing.
  Edits made during the run do not change what is heard: the mix was taken at the start.
  One run at a time: presses while the browser is still being asked are ignored.
- **Keyboard and screen readers:** the button is one element that reads **Transcribe to
  captions** or **Stop transcribing**, so focus stays on it. When the notice closes, or a pack
  finishes installing and listening starts, focus returns to it, unless the user has moved
  focus elsewhere. The phase ("Preparing the sound…", "Transcribing on this device…",
  "Downloading the speech language pack…") is in a polite live region that is always in the
  page; the running `m:ss / m:ss` clock sits outside it, so it is not read out every second.
- **Language:** the browser's own (`navigator.language`, `en-US` if it has none). There is no
  language picker, no translation and no speaker labels.
- **Times are estimates.** The recogniser reports words, not times. A cue starts
  `HEARD_LEAD_SECONDS` (0.3 s) before the first interim result for its words and ends when
  the recogniser settled on them (their final result), both read from the playback clock.
  Cues are at least 1 s long, never overlap and never run past the timeline. A result longer
  than 84 characters (two 42-column lines) is cut at word boundaries, with its time shared out
  by length. If the recogniser ends its session early, after a long silence for example, it
  is started again on the same track while the sound still plays.
- **Where the cues land:** exactly where an imported caption file's cues land. They are
  wrapped with `wrapCaptionText` at `captionWrapColumns`, styled with `captionStyleFor`, and
  added through `addCaptionCues`: ordinary text clips on the one Captions track (created at
  the top if needed), in **one** history entry, so one undo takes the whole transcription
  off. They export through the existing `.srt` / `.vtt` sidecar and burn in like any caption
  (see `captions.md`).
- **Notices:** `Transcribed N caption(s) onto the Captions track.` (plus
  `The Captions track is hidden.` when it is); `There is no sound on the timeline to
  transcribe.`; `No speech was heard, so no captions were added.`; `The Captions track is
  locked, so no captions were added.` (checked before listening and again at the end);
  `Transcription stopped. No captions were added.`; the recogniser's errors in words
  (`describeRecognitionError`). If a fresh `available()` answers `unavailable` on the click,
  the control hides itself and says so.

## Bundle

`core/speechRecognitionLocal.ts` (the feature probe, `available()` / `install()`) and
`components/Timeline/TranscribeControl.tsx` are imported statically. `core/transcribe.ts` is a
dynamic `import()` on the first click. **Every build here sets `inlineDynamicImports: true`**
(`vite.config.ts`, see `build-configuration.md`), so today that module is inlined into the
one bundle: a few KB of code that does nothing until the click. It runs no top-level side
effects. The dynamic import keeps it separable: if the hosted build ever splits chunks, the
module becomes its own chunk with no code change. The "only same-origin scripts" allowance in
the e2e request check covers that case, and the Vite dev server already serves the module
on demand.

## Tests

- `core/speechRecognitionLocal.test.ts`: which constructors count, and that `available()` and
  `install()` are always asked with `processLocally: true`.
- `core/transcribe.test.ts`: the recogniser is refused without `processLocally === true`, is
  started on the mix's track (never with no argument), and every start, restarts included, is
  on device. Also results into cues, stop, errors and the timing rules.
- `components/Timeline/TranscribeControl.test.tsx`: hidden with no API, no on-device mode or
  `unavailable`; the notice before `install()`; cues as caption clips in one undo step; the
  sidecar text.
- `apps/e2e/tests/regressions/ESCSUITE-404.spec.ts` (Chromium, API stubbed with
  `page.addInitScript`): no control where unavailable; every `start()` on device with a live
  audio track carrying the timeline's sound; the stub's words become caption clips and appear
  in the downloaded `.srt` and `.vtt`; one Ctrl+Z removes them; no fetch or XHR while
  transcribing; a `downloadable` pack is installed only after the notice.
- **Every Chromium e2e project turns the real API off.** Playwright's Chromium headless shell
  (what `chromium.launch()` runs headless, in CI too) kills the page's renderer ("Target
  crashed") when a page calls `SpeechRecognition.available()`: it has the API in Blink but not
  the browser-side speech service. The editor asks `available()` when it opens, so every
  Chromium project in every `apps/e2e/playwright*.config.ts` passes
  `--disable-blink-features=OnDeviceWebSpeechAvailable` (`apps/e2e/utils/chromiumLaunch.ts`).
  With it the editor sees no on-device mode and shows no control. A new Chromium project or
  config must pass it too. Full Chromium (`channel: 'chromium'`) answers `downloadable` and
  does not crash.
