# On-device caption translation (`src/components/Timeline/TranslateControl.tsx`, ESCSUITE-473)

"Translate captions" turns the caption track into a **second caption track in another
language** with the **browser's own on-device Translator API**, so a video can carry
bilingual captions. ESCAPESUITE ships no translation model and fetches none. The translation
runs inside the browser on this device. ESCAPEARTIST sends no captions, text or anything else
anywhere.

## What the browser downloads, from whom, and when

- **ESCAPEARTIST downloads nothing.** It has no translation model in its bundle and requests
  none. While it translates it makes no fetch, XHR, WebSocket or EventSource request
  (`ESCSUITE-473.spec.ts` pins this).
- **The browser may download a translation model** for one language pair. Chrome's own
  documentation says so: "the model is downloaded the first time a website uses this API". It
  does this only when
  1. `Translator.availability({ sourceLanguage, targetLanguage })` answers `downloadable`, and
  2. the user has read the notice "Your browser will download a translation model for
     *source* to *target* once. Your captions never leave this device."
     (`translationModelNotice`, the languages' English names, e.g. "English to Spanish") and
     pressed **Download translation model**.

  ESCAPEARTIST then calls `Translator.create({ sourceLanguage, targetLanguage, monitor })`
  straight from that click (the browser requires a user gesture to download), and the
  **browser** downloads the model from **its own vendor**. ESCAPEARTIST does not choose, see
  or proxy that download; the status line shows "Downloading the translation model…" and the
  `downloadprogress` percentage. **Cancel** downloads nothing and asks nothing more.
- `downloading` (the browser is already fetching it) goes straight to `create()` and waits,
  starting no download of its own. `available` downloads nothing.
- **The Language Detector never downloads.** It is only used to *suggest* the captions'
  language, and only when `LanguageDetector.availability()` answers `available` (its model is
  already installed). Otherwise the user simply picks the language.
- **Air-gapped or offline:** translation works only if the model for that pair is **already
  installed** in that browser profile. Without a network the browser cannot fetch it, so
  `create()` fails and the editor says "The translation model could not be downloaded."
  Nothing else in the feature needs a network.

## Which browsers offer it

**Opening the editor asks the browser nothing.** The control is rendered on static detection
alone (`getTranslatorCtor` in `core/translatorLocal.ts`): a global `Translator` with
`availability()` and `create()`, in a browser that is not a bare Chromium embedder. Without
these **no control is rendered** and nothing is called. Chrome's documentation lists the API
from **Chrome 138, desktop only**; every other browser has no control today. As a precaution
the speech feature's brand gate applies too (`isBareChromiumEmbedder`,
`on-device-transcription.md`): a `Chromium` brand with no `Google Chrome`, `Microsoft Edge`,
`Opera` or `Brave` brand gets no control, so an embedder that exposes the Blink half of the API
without the browser-side service behind it is never asked. (Playwright's headless shell has no
`Translator` at all.)

`availability()` and `create()` are governed by the `translator` (and the detector by
`language-detector`) Permissions-Policy feature, whose default allowlist is `self`. The hosted
`vercel.json` header does not name them, so the suite's own origin may use them. A host that
frames ARTIST **cross-origin** must delegate them with `allow="translator; language-detector"`,
or `availability()` fails, which reads as unavailable.

## What it does

- **Where:** the timeline's controls, after "Transcribe to captions": a **Translation language**
  select (its accessible name) and **Translate captions**. The select offers a short fixed
  list (`TRANSLATION_LANGUAGES` in `core/translationLanguage.ts`: Arabic, Chinese, Chinese
  (Traditional), Dutch, English, French, German, Hindi, Italian, Japanese, Korean, Polish,
  Portuguese, Russian, Spanish, Turkish, Ukrainian, Vietnamese), named in English. It starts on
  Spanish for an English browser and English for any other, and the choice is remembered in
  `localStorage` under `escapeartist-translation-language` (quietly forgotten where storage is
  blocked). Offering a language promises nothing; `availability()` answers on the press.
- **What it translates:** the **first caption track** (the one imports and transcription land
  on), its text clips as they stand at the press, in timeline order. No captions: "There are no
  captions to translate."
- **The captions' language** is the track's own `Track.language`: transcription sets it to the
  spoken language (ESCSUITE-444's select). An imported `.srt` / `.vtt` does not say, so the
  press first asks **"Which language are the captions in?"** with a **Captions language**
  select, or "These captions look like *French*. Is that the language they are in?" when the
  installed Language Detector is at least 50 % sure (`detectLanguage`, the first 2000
  characters). **Continue** goes on; **Cancel** asks the translator nothing. The confirmed
  language is written to the source track in the same write as the translation (unless the
  track is locked), so it is not asked again; a cancelled or failed run writes nothing.
- **Asked for the language alone:** `translatorLanguage` sends `en` for `en-US`, keeping only
  Chinese's script (`zh` / `zh-Hant`). A target the captions are already in is refused ("The
  captions are already in Spanish."), and so is one that already has a caption track ("There
  is already a Spanish caption track."): delete that track to translate again.
- `unavailable` for the pair says "Translating *English* to *Spanish* is not available in this
  browser." and the control stays, since another pair may work.
- **Translating:** each cue is translated as one line (its line breaks joined with a space)
  with `translator.translate(text, { signal })`, in sequence; the status reads "Translating on
  this device…" with `n / N` beside it, and the button **Stop translating** ends it, adding
  nothing. A run belongs to the project it started in (ESCSUITE-432's rule): another project
  taking its place stops it with "Translation stopped. No captions were added."
- **Where the cues land:** `addCaptionTranslation` (`store/overlaySlice.ts`) makes a new
  `kind: 'captions'` track named "Captions (*Spanish*)", `language` set to the target, placed
  **directly below the source in the timeline** (every track from the source up moves up one
  index) and appended to the track list, so the source stays the first caption track. Each new
  clip is a deep copy of its source cue (position, length, style, keyframes) holding the
  translation, wrapped with `wrapCaptionText` at `captionWrapColumns` for its font size. **The
  cues keep the source cues' start and end exactly.** One write, **one history entry**, the
  selection untouched: one undo takes the whole translation off. Notice: "Translated N
  caption(s) into Spanish on a new caption track."
- **Showing, hiding, burning in:** each caption track is an ordinary track, so its eye toggle
  shows or hides it in the preview and in every export on its own. Two visible caption tracks
  with cues up at once are **stacked** (see `captions.md`, "Two caption tracks"). The export
  dialog offers a sidecar per caption track, named with its language (`name.en.vtt`,
  `name.es.vtt`).
- **Out of scope:** a cloud fallback, a bundled model, translating other text overlays, linked
  editing of the two languages (editing one cue does not change its translation), and
  translating a caption track other than the first.

## Tests

- `core/translatorLocal.test.ts`: static detection (calls nothing), the brand gate, answers
  normalised and failures read as unavailable, `create()`'s monitor reporting clamped progress,
  and the detector never created unless its model is installed.
- `core/translationLanguage.test.ts`: the tags the API is asked for, the options, the default,
  the notice wording, the remembered target.
- `components/Timeline/TranslateControl.test.tsx`: no control and no call without the API, an
  incomplete one, or a bare Chromium brand; nothing asked on mount; the second track with exact
  times in one undo step; the notice before `create()`, Cancel creating nothing; progress and
  Stop; a project swap mid-run; unavailable pairs; the source-language question with and
  without a detector.
- `store/overlaySlice.captions.test.ts`: `addCaptionTranslation` (times, placement, one undo,
  the confirmed source language) and `addCaptionCues`'s `language`.
- `core/captionStack.test.ts`, plus a pin in `drawFrame.test.ts` and each exporter's suite
  (MP4, WebM, GIF): two caption tracks stack without overlapping, one alone draws in its place.
- `ExportDialog.captions.test.tsx`: a sidecar per track, named with its language, reading back
  through `parseCaptions` with the same cues.
- `projectStore.migration.test.ts`: two caption tracks and their languages survive a load; an
  older file opens unchanged; a malformed `language` is refused by name.
- `apps/e2e/tests/regressions/ESCSUITE-473.spec.ts` (every browser; the API stubbed by
  `apps/e2e/utils/translatorStub.ts` with a Google Chrome brand): no control without the API;
  the imported file's language suggested and confirmed; the second track; no request while
  translating; the two `.vtt` sidecars' names, text and identical timings; one undo; the
  download notice, Cancel creating nothing, and the download after the confirm.
